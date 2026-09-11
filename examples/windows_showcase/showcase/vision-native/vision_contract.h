#pragma once
#include "trtmc/task.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <nlohmann/json.hpp>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace showcase::vision {
constexpr std::size_t kMaxPixels = 4 * 1024 * 1024;
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
inline int positive_integer(const std::string& text) {
    if (text.empty() ||
        !std::all_of(text.begin(), text.end(), [](char ch) { return ch >= '0' && ch <= '9'; }))
        throw std::invalid_argument("PPM dimensions must be positive integers");
    const auto value = std::stoull(text);
    if (!value || value > kMaxPixels)
        throw std::invalid_argument("PPM dimension exceeds image limit");
    return static_cast<int>(value);
}
inline Image read_ppm(std::istream& input) {
    if (header_token(input) != "P6")
        throw std::invalid_argument("imagePath must contain a binary RGB P6 PPM");
    Image image;
    image.width = positive_integer(header_token(input));
    image.height = positive_integer(header_token(input));
    if (header_token(input) != "255")
        throw std::invalid_argument("PPM max value must be 255");
    const auto count = static_cast<std::size_t>(image.width) * image.height;
    if (count > kMaxPixels)
        throw std::invalid_argument("Image exceeds 4194304 pixels");
    // Consume the mandatory header delimiter only: a first pixel byte may itself
    // be whitespace and must never be skipped. Accept the Windows CRLF pair.
    const int delimiter = input.get();
    if (delimiter != ' ' && delimiter != '\t' && delimiter != '\r' && delimiter != '\n')
        throw std::invalid_argument("Invalid PPM pixel delimiter");
    if (delimiter == '\r' && input.peek() == '\n')
        input.get();
    std::vector<std::uint8_t> bytes(count * 3);
    input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (input.gcount() != static_cast<std::streamsize>(bytes.size()) ||
        input.peek() != std::char_traits<char>::eof())
        throw std::invalid_argument("PPM pixel payload length does not match dimensions");
    image.pixels.resize(bytes.size());
    for (std::size_t i = 0; i < bytes.size(); ++i)
        image.pixels[i] = bytes[i] / 255.0F;
    return image;
}
inline Image read_ppm_file(const std::string& path) {
    if (path.empty() || path.find('\0') != std::string::npos)
        throw std::invalid_argument("Invalid imagePath");
    std::ifstream input(std::filesystem::u8path(path), std::ios::binary | std::ios::ate);
    if (!input)
        throw std::invalid_argument("Cannot open PPM imagePath");
    const auto size = input.tellg();
    if (size < 0 || size > static_cast<std::streamoff>(kMaxPixels * 3 + 1024))
        throw std::invalid_argument("PPM file exceeds size limit");
    input.seekg(0);
    return read_ppm(input);
}
struct Point {
    float x;
    float y;
    bool foreground;
};
inline Point parse_point(const nlohmann::json& points, int width, int height) {
    if (!points.is_array() || points.size() != 1)
        throw std::invalid_argument("SAM Task API supports exactly one point per request");
    const auto& point = points.at(0);
    const auto x = point.at("x").get<double>();
    const auto y = point.at("y").get<double>();
    const auto& label = point.at("label");
    if (!label.is_number_integer() || (label != 0 && label != 1))
        throw std::invalid_argument("Point label must be 0 or 1");
    if (!std::isfinite(x) || !std::isfinite(y) || x < 0 || y < 0 || x >= width || y >= height)
        throw std::invalid_argument("Point is outside the original image");
    return {static_cast<float>(x / width), static_cast<float>(y / height), label == 1};
}
inline std::string base64(const std::vector<std::uint8_t>& bytes) {
    constexpr char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string text;
    text.reserve((bytes.size() + 2) / 3 * 4);
    for (std::size_t i = 0; i < bytes.size(); i += 3) {
        const auto remaining = bytes.size() - i;
        const std::uint32_t value =
            (static_cast<std::uint32_t>(bytes[i]) << 16) |
            (remaining > 1 ? static_cast<std::uint32_t>(bytes[i + 1]) << 8 : 0) |
            (remaining > 2 ? bytes[i + 2] : 0);
        text.push_back(table[(value >> 18) & 63]);
        text.push_back(table[(value >> 12) & 63]);
        text.push_back(remaining > 1 ? table[(value >> 6) & 63] : '=');
        text.push_back(remaining > 2 ? table[value & 63] : '=');
    }
    return text;
}
inline nlohmann::json select_mask(const trtmc::PromptedSegmentationResult& result, int width,
                                  int height) {
    const auto count = static_cast<std::size_t>(width) * height;
    if (result.width != width || result.height != height || result.num_masks < 1 ||
        result.num_masks > 16 ||
        result.iou_scores.size() != static_cast<std::size_t>(result.num_masks) ||
        result.masks.size() != count * result.num_masks)
        throw std::runtime_error("SAM returned an invalid mask shape");
    for (const auto value : result.iou_scores)
        if (!std::isfinite(value))
            throw std::runtime_error("SAM returned a nonfinite score");
    const auto best = static_cast<std::size_t>(
        std::max_element(result.iou_scores.begin(), result.iou_scores.end()) -
        result.iou_scores.begin());
    std::vector<std::uint8_t> mask(count);
    std::size_t foreground_count = 0;
    for (std::size_t i = 0; i < count; ++i) {
        const auto logit = result.masks[best * count + i];
        if (!std::isfinite(logit))
            throw std::runtime_error("SAM returned a nonfinite mask logit");
        mask[i] = logit > 0.0F ? 255 : 0;
        if (mask[i])
            ++foreground_count;
    }
    return {{"width", width},
            {"height", height},
            {"maskBase64", base64(mask)},
            {"maskEncoding", "u8"},
            {"maskIndex", best},
            {"score", result.iou_scores[best]},
            {"scores", result.iou_scores},
            {"foregroundPixels", foreground_count}};
}
} // namespace showcase::vision
