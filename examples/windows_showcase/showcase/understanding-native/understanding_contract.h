#pragma once
#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <istream>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>
#include <vector>

namespace showcase::understanding {
constexpr std::size_t kMaxPixels = 4 * 1024 * 1024;
constexpr std::size_t kMaxPromptBytes = 512;
constexpr int kMaxOutputTokens = 128;
constexpr int kContextLength = 1024;
struct Image {
    int width{0};
    int height{0};
    std::vector<float> pixels;
};
inline std::string header_token(std::istream& input) {
    std::string value;
    while (input) {
        const int ch = input.peek();
        if (ch == '#') {
            input.ignore(1024, '\n');
            continue;
        }
        if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            input.get();
            continue;
        }
        break;
    }
    while (input) {
        const int ch = input.peek();
        if (ch == std::char_traits<char>::eof() || ch == ' ' || ch == '\t' || ch == '\r' ||
            ch == '\n')
            break;
        if (value.size() >= 20)
            throw std::invalid_argument("Invalid PPM header token");
        value.push_back(static_cast<char>(input.get()));
    }
    if (value.empty())
        throw std::invalid_argument("Incomplete PPM header");
    return value;
}
inline int dimension(const std::string& text) {
    if (text.empty() ||
        !std::all_of(text.begin(), text.end(), [](char ch) { return ch >= '0' && ch <= '9'; }))
        throw std::invalid_argument("Image dimensions must be positive integers");
    const auto value = std::stoull(text);
    if (value < 16 || value > 2048)
        throw std::invalid_argument("Image dimensions must be 16 to 2048 pixels");
    return static_cast<int>(value);
}
inline Image read_ppm(std::istream& input) {
    if (header_token(input) != "P6")
        throw std::invalid_argument("Use a binary RGB P6 PPM image");
    Image image;
    image.width = dimension(header_token(input));
    image.height = dimension(header_token(input));
    if (header_token(input) != "255")
        throw std::invalid_argument("PPM max value must be 255");
    const auto count = static_cast<std::size_t>(image.width) * image.height;
    if (count > kMaxPixels)
        throw std::invalid_argument("Image exceeds the pixel limit");
    const int delimiter = input.get();
    if (delimiter != ' ' && delimiter != '\t' && delimiter != '\r' && delimiter != '\n')
        throw std::invalid_argument("Invalid PPM pixel delimiter");
    if (delimiter == '\r' && input.peek() == '\n')
        input.get();
    std::vector<std::uint8_t> bytes(count * 3);
    input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (input.gcount() != static_cast<std::streamsize>(bytes.size()) ||
        input.peek() != std::char_traits<char>::eof())
        throw std::invalid_argument("PPM payload does not match its dimensions");
    image.pixels.resize(bytes.size());
    for (std::size_t index = 0; index < bytes.size(); index++)
        image.pixels[index] = bytes[index] / 255.0F;
    return image;
}
inline Image read_ppm_file(const std::string& path) {
    if (path.empty() || path.find('\0') != std::string::npos)
        throw std::invalid_argument("Invalid imagePath");
    std::ifstream input(std::filesystem::u8path(path), std::ios::binary | std::ios::ate);
    if (!input)
        throw std::invalid_argument("Cannot open the input image");
    const auto size = input.tellg();
    if (size < 0 || size > static_cast<std::streamoff>(kMaxPixels * 3 + 1024))
        throw std::invalid_argument("Image file exceeds the size limit");
    input.seekg(0);
    return read_ppm(input);
}
inline std::string parse_prompt(const nlohmann::json& request) {
    const auto prompt = request.at("prompt").get<std::string>();
    if (prompt.empty() || prompt.size() > kMaxPromptBytes ||
        prompt.find('\0') != std::string::npos ||
        std::all_of(prompt.begin(), prompt.end(),
                    [](char ch) { return ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t'; }))
        throw std::invalid_argument("Enter a question using 1 to 512 UTF-8 bytes");
    if (prompt.find("<|") != std::string::npos)
        throw std::invalid_argument("Question must not contain reserved model control markers");
    return prompt;
}
inline int parse_output_limit(const nlohmann::json& request) {
    if (request.contains("maxTokens") && !request.at("maxTokens").is_number_integer())
        throw std::invalid_argument("maxTokens must be an integer");
    const auto value = request.value("maxTokens", 64);
    if (value < 1 || value > kMaxOutputTokens)
        throw std::invalid_argument("maxTokens must be 1 to 128");
    return value;
}
} // namespace showcase::understanding
