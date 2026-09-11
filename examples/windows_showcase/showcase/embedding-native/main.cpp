#include "examples/windows_voicechat/native/stdio_transport.h"
#include "families/bert/runtime/plugin_helpers.h"
#include "trtmc/bundle.h"
#include "trtmc/runtime/family_loader.h"
#include "trtmc/task.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
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
namespace {
constexpr const char* kModel = "intfloat/multilingual-e5-small";
constexpr const char* kRevision = "614241f622f53c4eeff9890bdc4f31cfecc418b3";
constexpr int kDimension = 384;
constexpr std::size_t kMaxTokens = 512;
constexpr std::size_t kMaxTexts = 24;

double elapsed_ms(Clock::time_point started) {
    return std::chrono::duration<double, std::milli>(Clock::now() - started).count();
}
Json identity() {
    return {{"backend", "trt_rtx"},    {"family", "bert"},
            {"model", kModel},         {"revision", kRevision},
            {"dimension", kDimension}, {"pooling", "mean"},
            {"normalization", "l2"},   {"maxSequenceLength", kMaxTokens}};
}

int run(const std::vector<std::string>& args) {
    std::unique_ptr<ProtocolOutput> output;
    try {
        std::string bundle, runtime, cache;
        for (std::size_t index = 1; index < args.size(); ++index) {
            if (args[index] == "--help") {
                std::cout << "Usage: trtmc_embedding_bridge --bundle PATH --runtime-root DIR "
                             "[--runtime-cache PATH]\n"
                             "NDJSON: {id,type:embed,texts:[...],roles:[query|passage,...]}; stop "
                             "exits.\n"
                             "Uses IEmbedding with multilingual-e5-small; 384 dimensions, 512 "
                             "tokens, at most 24 texts.\n";
                return 0;
            }
            const std::string option = args[index];
            if (++index == args.size())
                throw std::invalid_argument("Missing argument value");
            if (option == "--bundle")
                bundle = args[index];
            else if (option == "--runtime-root")
                runtime = args[index];
            else if (option == "--runtime-cache")
                cache = args[index];
            else
                throw std::invalid_argument("Unknown option: " + option);
        }
        if (bundle.empty() || runtime.empty())
            throw std::invalid_argument("Bundle and runtime root are required");
        output = std::make_unique<ProtocolOutput>();
        const trtmc::BundleReader reader(bundle);
        const auto& info = reader.info();
        if (info.family != "bert" || info.task != "embedding" || info.backend != "trt_rtx")
            throw std::invalid_argument("Select a BERT embedding bundle compiled for TensorRT-RTX");
        auto loading = identity();
        loading["type"] = "loading";
        output->write(loading.dump());
        const auto load_started = Clock::now();
        // Use the family's identical tokenizer to validate exact sequence length
        // before any encoder call. No input truncation or fallback embeddings.
        const auto tokenizer = trtmc::create_tokenizer_from_bundle(reader);
        if (!tokenizer)
            throw std::runtime_error("The embedding bundle has no tokenizer");
        auto task = trtmc::load_task(bundle, runtime, 0, cache);
        auto* embedding = dynamic_cast<trtmc::IEmbedding*>(task.get());
        if (!embedding)
            throw std::runtime_error("Bundle does not expose IEmbedding");
        auto ready = identity();
        ready["type"] = "ready";
        ready["protocolVersion"] = 1;
        ready["loadTimeMs"] = elapsed_ms(load_started);
        ready["maxTexts"] = kMaxTexts;
        output->write(ready.dump());
        CommandInput input;
        std::string line;
        while (!input.eof()) {
            if (!input.next(line) || line.empty())
                continue;
            Json id = nullptr;
            try {
                if (line.size() > 256 * 1024)
                    throw std::invalid_argument("Request exceeds 256 KiB");
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
                if (type != "embed")
                    throw std::invalid_argument("Unknown request type");
                const auto& values = request.at("texts");
                if (!values.is_array() || values.empty() || values.size() > kMaxTexts)
                    throw std::invalid_argument("texts must contain 1 to 24 strings");
                const auto texts = values.get<std::vector<std::string>>();
                auto roles = request.contains("roles")
                                 ? request.at("roles").get<std::vector<std::string>>()
                                 : std::vector<std::string>(texts.size(), "passage");
                if (roles.size() != texts.size())
                    throw std::invalid_argument("roles must match texts length");
                std::vector<std::string> model_inputs;
                std::vector<std::size_t> token_counts;
                const auto request_started = Clock::now();
                for (std::size_t index = 0; index < texts.size(); ++index) {
                    const auto& text = texts[index];
                    if (text.empty() || text.size() > 8192 ||
                        text.find('\0') != std::string::npos ||
                        std::all_of(text.begin(), text.end(),
                                    [](unsigned char c) { return std::isspace(c) != 0; }))
                        throw std::invalid_argument(
                            "Each text must contain 1 to 8192 UTF-8 bytes without NUL");
                    if (roles[index] != "query" && roles[index] != "passage")
                        throw std::invalid_argument("Each role must be query or passage");
                    model_inputs.push_back(roles[index] + ": " + text);
                    const auto token_count = tokenizer->encode(model_inputs.back()).size();
                    if (!token_count || token_count > kMaxTokens)
                        throw std::invalid_argument(
                            "Text " + std::to_string(index + 1) + " has " +
                            std::to_string(token_count) +
                            " tokens including prefix; maximum is 512. Input was not truncated.");
                    token_counts.push_back(token_count);
                }
                std::vector<std::vector<float>> vectors;
                std::vector<double> norms, per_text_ms;
                for (const auto& model_input : model_inputs) {
                    const auto started = Clock::now();
                    const auto result = embedding->embed(model_input);
                    per_text_ms.push_back(elapsed_ms(started));
                    if (result.dim != kDimension || result.data.size() != kDimension)
                        throw std::runtime_error(
                            "Model did not produce the expected 384-dimensional embedding");
                    double squared_norm = 0.0;
                    for (const float value : result.data) {
                        if (!std::isfinite(value))
                            throw std::runtime_error("Model produced a non-finite embedding");
                        squared_norm += static_cast<double>(value) * value;
                    }
                    const double norm = std::sqrt(squared_norm);
                    if (!std::isfinite(norm) || std::abs(norm - 1.0) > 0.001)
                        throw std::runtime_error("Model family returned an embedding without the "
                                                 "expected L2 normalization");
                    norms.push_back(norm);
                    vectors.push_back(result.data);
                }
                auto result = identity();
                result["type"] = "result";
                result["id"] = id;
                result["texts"] = texts;
                result["roles"] = roles;
                result["modelInputs"] = model_inputs;
                result["tokenCounts"] = token_counts;
                result["vectors"] = vectors;
                result["normalized"] = true;
                result["norms"] = norms;
                result["perTextMs"] = per_text_ms;
                result["totalMs"] = elapsed_ms(request_started);
                result["inference"] = "live-local";
                output->write(result.dump());
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
        std::cerr << "Embedding bridge: " << error.what() << '\n';
        return 1;
    }
}
} // namespace

int wmain(int argc, wchar_t** argv) {
    try {
        std::vector<std::string> args;
        for (int index = 0; index < argc; ++index) {
            const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[index], -1,
                                                  nullptr, 0, nullptr, nullptr);
            if (count <= 0)
                throw std::invalid_argument("Invalid Unicode command argument");
            std::string value(static_cast<std::size_t>(count), '\0');
            if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[index], -1, value.data(),
                                     count, nullptr, nullptr))
                throw std::invalid_argument("Unable to decode Unicode command argument");
            value.pop_back();
            args.push_back(std::move(value));
        }
        return run(args);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
