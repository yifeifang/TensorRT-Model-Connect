#include "examples/windows_voicechat/native/stdio_transport.h"
#include "trtmc/bundle.h"
#include "trtmc/runtime/family_loader.h"
#include "trtmc/task.h"
#include "wav_input.h"

#include <chrono>
#include <iostream>
#include <memory>
#include <nlohmann/json.hpp>
#include <stdexcept>
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
                std::cout
                    << "Usage: trtmc_asr_bridge --bundle PATH --runtime-root DIR [--runtime-cache "
                       "PATH]\n"
                       "NDJSON transcribe: "
                       "{id,type:transcribe,wavPath,language:en|zh,maxTokens:224}; stop exits.\n";
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
        if (info.family != "whisper" || info.backend != "trt_rtx")
            throw std::invalid_argument("Select a whisper bundle compiled for trt_rtx");
        output->write(
            Json{{"type", "loading"}, {"backend", info.backend}, {"family", info.family}}.dump());
        const auto load_start = Clock::now();
        auto task = trtmc::load_task(bundle, runtime, 0, cache);
        auto* asr = dynamic_cast<trtmc::ITranscription*>(task.get());
        if (!asr)
            throw std::runtime_error("Bundle does not expose ITranscription");
        output->write(
            Json{{"type", "ready"},
                 {"backend", info.backend},
                 {"family", info.family},
                 {"protocolVersion", 1},
                 {"inputFormat", "wav_pcm16_mono_16000"},
                 {"maxAudioSeconds", 30},
                 {"languages", {"en", "zh"}},
                 {"timestamps", false},
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
                if (type != "transcribe")
                    throw std::invalid_argument("Unknown request type");
                const auto language = request.at("language").get<std::string>();
                if (language != "en" && language != "zh")
                    throw std::invalid_argument("language must be en or zh");
                const int max_tokens = request.value("maxTokens", 224);
                if (max_tokens < 1 || max_tokens > 224)
                    throw std::invalid_argument("maxTokens must be 1 to 224");
                const auto samples =
                    showcase_asr::load_wav(request.at("wavPath").get<std::string>());
                trtmc::TranscriptionConfig config;
                config.input_sample_rate = 16000;
                config.source_language = language;
                config.target_language = language;
                config.max_output_tokens = max_tokens;
                config.task = trtmc::TranscriptionTask::kTranscribe;
                config.timestamps = false;
                const auto started = Clock::now();
                const auto result = asr->transcribe(
                    samples.data(), static_cast<std::int32_t>(samples.size()), config);
                const auto elapsed =
                    std::chrono::duration<double, std::milli>(Clock::now() - started).count();
                if (result.text == "[mel extraction failed]")
                    throw std::runtime_error("Whisper mel extraction failed");
                Json segments = Json::array();
                for (const auto& segment : result.segments)
                    segments.push_back({{"startSeconds", segment.start_seconds},
                                        {"endSeconds", segment.end_seconds},
                                        {"text", segment.text}});
                const double seconds = samples.size() / 16000.0;
                output->write(Json{
                    {"type", "result"},
                    {"id", id},
                    {"text", result.text},
                    {"segments", segments},
                    {"tokens", result.token_ids.size()},
                    {"setupMs", result.setup_ms},
                    {"prefillMs", result.prefill_ms},
                    {"decodeMs", result.decode_ms},
                    {"totalMs", elapsed},
                    {"audioSeconds", seconds},
                    {"realTimeFactor", elapsed / (seconds * 1000.0)},
                    {"language", language},
                    {"truncated", result.token_ids.size() >= static_cast<std::size_t>(max_tokens) &&
                                      !result.token_ids.empty() &&
                                      result.token_ids.back() != 50257},
                    {"backend", info.backend},
                    {"family",
                     info.family}}.dump());
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
        std::cerr << "ASR bridge: " << error.what() << '\n';
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
