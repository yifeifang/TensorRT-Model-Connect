#include "examples/windows_voicechat/native/stdio_transport.h"
#include "families/qwen_vl/runtime/image_preprocessor.h"
#include "families/qwen_vl/runtime/tokenizer.h"
#include "trtmc/bundle.h"
#include "trtmc/runtime/family_loader.h"
#include "trtmc/task.h"
#include "understanding_contract.h"

#include <chrono>
#include <iostream>
#include <memory>

using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;
using trtmc::examples::windows_voicechat::CommandInput;
using trtmc::examples::windows_voicechat::ProtocolOutput;
namespace contract = showcase::understanding;
constexpr auto kModel = "Qwen/Qwen3-VL-2B-Instruct";
constexpr auto kRevision = "89644892e4d85e24eaac8bacfd4f463576704203";

int bridge_main(const std::vector<std::string>& args) {
    std::unique_ptr<ProtocolOutput> output;
    try {
        std::string bundle, runtime, cache;
        for (std::size_t index = 1; index < args.size(); index++) {
            if (args[index] == "--help") {
                std::cout << "Usage: trtmc_understanding_bridge --bundle PATH --runtime-root DIR "
                             "[--runtime-cache PATH]\n"
                             "NDJSON: {id,type:understand,imagePath,prompt,maxTokens}; RGB P6 PPM, "
                             "short question, 1-128 output tokens. stop exits.\n";
                return 0;
            }
            const auto option = args[index];
            if (++index == args.size())
                throw std::invalid_argument("Missing argument value");
            if (option == "--bundle")
                bundle = args[index];
            else if (option == "--runtime-root")
                runtime = args[index];
            else if (option == "--runtime-cache")
                cache = args[index];
            else
                throw std::invalid_argument("Unknown argument: " + option);
        }
        if (bundle.empty() || runtime.empty())
            throw std::invalid_argument("Bundle and runtime root are required");
        output = std::make_unique<ProtocolOutput>();
        const trtmc::BundleReader reader(bundle);
        const auto info = reader.info();
        if (info.family != "qwen_vl" || info.backend != "trt_rtx" ||
            info.task != "vision_language_generation")
            throw std::invalid_argument(
                "Select a qwen_vl vision_language_generation bundle built for trt_rtx");
        const auto runtime_bytes = reader.read_section("runtime.json");
        const std::string runtime_text(runtime_bytes.begin(), runtime_bytes.end());
        const auto metadata = Json::parse(runtime_text);
        const auto preprocessing = trtmc::qwen_vl_parse_preprocess_config(runtime_text);
        const auto context_length = metadata.at("max_cache_length").get<int>();
        if (context_length != contract::kContextLength ||
            metadata.at("tensor_parallel_size") != 1 || preprocessing.fixed_image_height != 448 ||
            preprocessing.fixed_image_width != 448 || preprocessing.num_image_pad_tokens != 196 ||
            preprocessing.dynamic_image_resolution)
            throw std::invalid_argument("The image-understanding bridge requires its qualified "
                                        "1024-token, 448x448 single-device profile");
        const auto tokenizer_bytes = reader.read_section("tokenizer.json");
        const auto tokenizer =
            trtmc::CreateBpeTokenizer(tokenizer_bytes.data(), tokenizer_bytes.size());
        output->write(
            Json{{"type", "loading"}, {"family", info.family}, {"backend", info.backend}}.dump());
        const auto load_started = Clock::now();
        auto task = trtmc::load_task(bundle, runtime, 0, cache);
        auto* model = dynamic_cast<trtmc::IVisionLanguageGeneration*>(task.get());
        if (!model)
            throw std::runtime_error("The bundle does not expose IVisionLanguageGeneration");
        output->write(
            Json{{"type", "ready"},
                 {"protocolVersion", 1},
                 {"family", info.family},
                 {"backend", info.backend},
                 {"model", kModel},
                 {"revision", kRevision},
                 {"maxSequenceLength", context_length},
                 {"maxPromptBytes", contract::kMaxPromptBytes},
                 {"maxTokens", contract::kMaxOutputTokens},
                 {"maxPixels", contract::kMaxPixels},
                 {"minImageSide", 16},
                 {"maxImageSide", 2048},
                 {"visionWidth", 448},
                 {"visionHeight", 448},
                 {"imageTokens", 196},
                 {"preprocessing", "family-owned bicubic resize to 448x448, RGB normalization and "
                                   "merge-group patch ordering"},
                 {"loadTimeMs",
                  std::chrono::duration<double, std::milli>(Clock::now() - load_started).count()}}
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
                if (type != "understand")
                    throw std::invalid_argument("Unknown request type");
                const auto prompt = contract::parse_prompt(request);
                const auto max_tokens = contract::parse_output_limit(request);
                const auto prompt_ids =
                    tokenizer->encode(trtmc::qwen_vl_format_prompt(prompt, preprocessing, 196));
                if (prompt_ids.size() + max_tokens > static_cast<std::size_t>(context_length))
                    throw std::invalid_argument(
                        "Question and requested output exceed the model context limit");
                const auto image =
                    contract::read_ppm_file(request.at("imagePath").get<std::string>());
                trtmc::TextGenerationConfig config;
                config.max_new_tokens = max_tokens;
                config.temperature = 1.0F;
                config.top_k = 1;
                config.top_p = 1.0F;
                config.seed = 0;
                config.repetition_penalty = 1.0F;
                config.enable_thinking = false;
                const auto started = Clock::now();
                const auto result =
                    model->generate(prompt, image.pixels.data(), image.height, image.width, config);
                const auto elapsed =
                    std::chrono::duration<double, std::milli>(Clock::now() - started).count();
                output->write(
                    Json{{"type", "result"},
                         {"id", id},
                         {"text", result.text},
                         {"tokenIds", result.token_ids},
                         {"tokens", result.token_ids.size()},
                         {"promptTokens", prompt_ids.size()},
                         {"maxTokens", max_tokens},
                         {"reachedTokenLimit",
                          result.token_ids.size() >= static_cast<std::size_t>(max_tokens)},
                         {"totalMs", elapsed},
                         {"setupMs", result.setup_ms},
                         {"width", image.width},
                         {"height", image.height},
                         {"visionWidth", 448},
                         {"visionHeight", 448},
                         {"imageTokens", 196},
                         {"model", kModel},
                         {"revision", kRevision},
                         {"family", info.family},
                         {"backend", info.backend},
                         {"sampling", "greedy top_k=1"},
                         {"preprocessing", "family-owned bicubic resize to 448x448; RGB mean/std "
                                           "normalization; merge-group patch ordering"}}
                        .dump());
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
        std::cerr << "Image-understanding bridge: " << error.what() << '\n';
        return 1;
    }
}
int wmain(int argc, wchar_t** argv) {
    try {
        std::vector<std::string> args;
        for (int index = 0; index < argc; index++) {
            const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[index], -1,
                                                 nullptr, 0, nullptr, nullptr);
            if (size <= 0)
                throw std::invalid_argument("Invalid Unicode command argument");
            std::string value(static_cast<std::size_t>(size), '\0');
            if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[index], -1, value.data(),
                                    size, nullptr, nullptr) != size)
                throw std::invalid_argument("Cannot decode command argument");
            value.pop_back();
            args.push_back(std::move(value));
        }
        return bridge_main(args);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
