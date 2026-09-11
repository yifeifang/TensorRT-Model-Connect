#include "examples/windows_voicechat/native/stdio_transport.h"
#include "trtmc/bundle.h"
#include "trtmc/runtime/family_loader.h"
#include "trtmc/task.h"

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
                std::cout << "Usage: trtmc_text_bridge --bundle PATH --runtime-root DIR "
                             "[--runtime-cache PATH]\n"
                             "NDJSON: {id,type:generate,prompt,maxTokens,enableThinking}; stop "
                             "exits. Requires Qwen on TensorRT-RTX.\n";
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
        if (info.family != "qwen" || info.backend != "trt_rtx")
            throw std::invalid_argument("Select a qwen bundle compiled for trt_rtx");
        output->write(
            Json{{"type", "loading"}, {"backend", info.backend}, {"family", info.family}}.dump());
        const auto load_start = Clock::now();
        auto task = trtmc::load_task(bundle, runtime, 0, cache);
        auto* text = dynamic_cast<trtmc::ITextGeneration*>(task.get());
        if (!text)
            throw std::runtime_error("Bundle does not expose ITextGeneration");
        output->write(
            Json{{"type", "ready"},
                 {"backend", info.backend},
                 {"family", info.family},
                 {"protocolVersion", 1},
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
                if (type != "generate")
                    throw std::invalid_argument("Unknown request type");
                const auto prompt = request.at("prompt").get<std::string>();
                if (prompt.empty() || prompt.size() > 20000 ||
                    prompt.find('\0') != std::string::npos)
                    throw std::invalid_argument(
                        "Prompt must contain 1 to 20000 UTF-8 bytes without NUL");
                const auto max_tokens = request.value("maxTokens", 700);
                if (max_tokens < 1 || max_tokens > 2048)
                    throw std::invalid_argument("maxTokens must be 1 to 2048");
                const bool thinking = request.value("enableThinking", false);
                trtmc::TextGenerationConfig config;
                config.max_new_tokens = max_tokens;
                config.use_chat_template = true;
                config.enable_thinking = thinking;
                // Qwen's model card recommends separate sampling settings.
                // A fixed seed keeps each demonstration reproducible.
                config.temperature = thinking ? 0.6F : 0.7F;
                config.top_k = 20;
                config.top_p = thinking ? 0.95F : 0.8F;
                config.seed = 0;
                // Preserve the model API's neutral repetition policy. JSON and
                // fact-preserving extraction legitimately repeat keys and names.
                config.repetition_penalty = 1.0F;
                const auto started = Clock::now();
                // The family validates the tokenized prompt plus requested output
                // against its fixed cache capacity before inference; no truncation.
                const auto result = text->generate(prompt, config);
                const auto elapsed =
                    std::chrono::duration<double, std::milli>(Clock::now() - started).count();
                output->write(Json{
                    {"type", "result"},
                    {"id", id},
                    {"text", result.text},
                    {"tokens", result.token_ids.size()},
                    {"setupMs", result.setup_ms},
                    {"prefillMs", result.prefill_ms},
                    {"decodeMs", result.decode_ms},
                    {"totalMs", elapsed},
                    {"tokensPerSecond", result.decode_ms > 0
                                            ? result.token_ids.size() * 1000.0 / result.decode_ms
                                            : 0.0},
                    {"enableThinking", thinking},
                    {"reachedTokenLimit",
                     result.token_ids.size() >= static_cast<std::size_t>(max_tokens)},
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
        std::cerr << "Text bridge: " << error.what() << '\n';
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
