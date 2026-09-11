#include "examples/windows_voicechat/native/stdio_transport.h"
#include "trtmc/bundle.h"
#include "trtmc/runtime/family_loader.h"
#include "vision_contract.h"

#include <chrono>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;
using trtmc::examples::windows_voicechat::CommandInput;
using trtmc::examples::windows_voicechat::ProtocolOutput;

int bridge_main(const std::vector<std::string>& args) {
    std::unique_ptr<ProtocolOutput> output;
    try {
        std::string bundle, runtime, cache;
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == "--help") {
                std::cout << "Usage: trtmc_vision_bridge --bundle PATH --runtime-root DIR "
                             "[--runtime-cache PATH]\n"
                             "NDJSON: {id,type:segment,imagePath,points:[{x,y,label:1}]}; RGB P6 "
                             "PPM, one original-pixel point. stop exits.\n";
                return 0;
            }
            const auto option = args[i];
            if (++i == args.size())
                throw std::invalid_argument("Missing argument value");
            if (option == "--bundle")
                bundle = args[i];
            else if (option == "--runtime-root")
                runtime = args[i];
            else if (option == "--runtime-cache")
                cache = args[i];
            else
                throw std::invalid_argument("Unknown option: " + option);
        }
        if (bundle.empty() || runtime.empty())
            throw std::invalid_argument("Bundle and runtime root are required");
        output = std::make_unique<ProtocolOutput>();
        const auto info = trtmc::InspectBundle(bundle);
        if (info.family != "sam" || info.backend != "trt_rtx" ||
            info.task != "prompted_segmentation")
            throw std::invalid_argument(
                "Select a sam prompted_segmentation bundle compiled for trt_rtx");
        output->write(
            Json{{"type", "loading"}, {"family", info.family}, {"backend", info.backend}}.dump());
        const auto load_start = Clock::now();
        auto task = trtmc::load_task(bundle, runtime, 0, cache);
        auto* segmenter = dynamic_cast<trtmc::IPointPromptedSegmentation*>(task.get());
        if (!segmenter)
            throw std::runtime_error("Bundle does not expose IPointPromptedSegmentation");
        output->write(
            Json{{"type", "ready"},
                 {"protocolVersion", 1},
                 {"family", info.family},
                 {"backend", info.backend},
                 {"model", "facebook/sam-vit-base"},
                 {"maxPoints", 1},
                 {"maxPixels", showcase::vision::kMaxPixels},
                 {"loadTimeMs",
                  std::chrono::duration<double, std::milli>(Clock::now() - load_start).count()}}
                .dump());
        CommandInput input;
        std::string line;
        while (!input.eof()) {
            if (!input.next(line) || line.empty())
                continue;
            Json id = nullptr;
            try {
                const auto request = Json::parse(line);
                if (!request.is_object())
                    throw std::invalid_argument("Request must be an object");
                if (request.contains("id"))
                    id = request.at("id");
                if (!id.is_null() && !id.is_string() && !id.is_number_integer())
                    throw std::invalid_argument("id must be a string or integer");
                const auto type = request.at("type").get<std::string>();
                if (type == "stop")
                    break;
                if (type == "ping") {
                    output->write(Json{{"type", "pong"}, {"id", id}}.dump());
                    continue;
                }
                if (type != "segment")
                    throw std::invalid_argument("Unknown request type");
                const auto total_start = Clock::now();
                const auto image =
                    showcase::vision::read_ppm_file(request.at("imagePath").get<std::string>());
                const auto point =
                    showcase::vision::parse_point(request.at("points"), image.width, image.height);
                const auto inference_start = Clock::now();
                const auto result =
                    segmenter->segment_prompted(image.pixels.data(), image.height, image.width,
                                                point.x, point.y, point.foreground);
                const auto elapsed =
                    std::chrono::duration<double, std::milli>(Clock::now() - inference_start)
                        .count();
                auto response = showcase::vision::select_mask(result, image.width, image.height);
                response.update({{"type", "result"},
                                 {"id", id},
                                 {"elapsedMs", elapsed},
                                 {"totalMs", std::chrono::duration<double, std::milli>(
                                                 Clock::now() - total_start)
                                                 .count()},
                                 {"model", "facebook/sam-vit-base"},
                                 {"family", info.family},
                                 {"backend", info.backend}});
                output->write(response.dump());
            } catch (const std::exception& error) {
                output->write(
                    Json{{"type", "error"}, {"id", id}, {"message", error.what()}, {"fatal", false}}
                        .dump());
            }
        }
        output->write(Json{{"type", "stopped"}}.dump());
        return 0;
    } catch (const std::exception& error) {
        if (output) {
            try {
                output->write(
                    Json{{"type", "error"}, {"message", error.what()}, {"fatal", true}}.dump());
            } catch (...) {
            }
        }
        std::cerr << "Vision bridge: " << error.what() << '\n';
        return 1;
    }
}
int wmain(int argc, wchar_t** argv) {
    try {
        std::vector<std::string> args;
        for (int i = 0; i < argc; ++i) {
            const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1,
                                                 nullptr, 0, nullptr, nullptr);
            if (size <= 0)
                throw std::invalid_argument("Invalid Unicode command argument");
            std::string value(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, value.data(), size,
                                nullptr, nullptr);
            value.pop_back();
            args.push_back(std::move(value));
        }
        return bridge_main(args);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
