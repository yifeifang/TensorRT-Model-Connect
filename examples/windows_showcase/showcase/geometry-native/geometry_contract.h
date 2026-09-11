#pragma once
#include "trtmc/task.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>
#include <vector>

namespace showcase::geometry {
constexpr int kMinSide = 64;
constexpr int kMaxSide = 512;
constexpr std::size_t kMaxPixels = kMaxSide * kMaxSide;
struct Image {
    int width{0};
    int height{0};
    std::vector<float> pixels;
};

inline std::string token(std::istream& input) {
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
inline int dimension(const std::string& value) {
    if (value.empty() ||
        !std::all_of(value.begin(), value.end(), [](char ch) { return ch >= '0' && ch <= '9'; }))
        throw std::invalid_argument("PPM dimensions must be positive integers");
    const auto number = std::stoull(value);
    if (number < kMinSide || number > kMaxSide)
        throw std::invalid_argument("Geometry images require each side between 64 and 512 pixels");
    return static_cast<int>(number);
}
inline Image read_ppm_file(const std::string& path) {
    if (path.empty() || path.find('\0') != std::string::npos)
        throw std::invalid_argument("Invalid imagePath");
    const auto image_path = std::filesystem::u8path(path);
    if (!image_path.is_absolute())
        throw std::invalid_argument("imagePath must be absolute");
    std::ifstream input(image_path, std::ios::binary | std::ios::ate);
    if (!input)
        throw std::invalid_argument("Cannot open PPM imagePath");
    const auto size = input.tellg();
    if (size < 0 || size > static_cast<std::streamoff>(kMaxPixels * 3 + 1024))
        throw std::invalid_argument("PPM file exceeds geometry image limit");
    input.seekg(0);
    if (token(input) != "P6")
        throw std::invalid_argument("imagePath must contain a binary RGB P6 PPM");
    Image image;
    image.width = dimension(token(input));
    image.height = dimension(token(input));
    const double aspect = static_cast<double>(image.width) / image.height;
    if (aspect < 0.5 || aspect > 2.0)
        throw std::invalid_argument("Geometry image aspect ratio must be between 0.5 and 2.0");
    if (token(input) != "255")
        throw std::invalid_argument("PPM max value must be 255");
    const int delimiter = input.get();
    if (delimiter != ' ' && delimiter != '\t' && delimiter != '\r' && delimiter != '\n')
        throw std::invalid_argument("Invalid PPM pixel delimiter");
    if (delimiter == '\r' && input.peek() == '\n')
        input.get();
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(image.width) * image.height * 3);
    input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (input.gcount() != static_cast<std::streamsize>(bytes.size()) ||
        input.peek() != std::char_traits<char>::eof())
        throw std::invalid_argument("PPM pixel payload length does not match dimensions");
    image.pixels.resize(bytes.size());
    for (std::size_t i = 0; i < bytes.size(); ++i)
        image.pixels[i] = bytes[i] / 255.0F;
    return image;
}
inline std::string base64(const std::uint8_t* bytes, std::size_t length) {
    constexpr char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string text;
    text.reserve((length + 2) / 3 * 4);
    for (std::size_t i = 0; i < length; i += 3) {
        const auto remaining = length - i;
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
inline std::string floats_base64(const std::vector<float>& values) {
    static_assert(sizeof(float) == 4, "Geometry protocol requires IEEE754 float32");
    return base64(reinterpret_cast<const std::uint8_t*>(values.data()),
                  values.size() * sizeof(float));
}
inline nlohmann::json encode_geometry(const trtmc::GeometryResult& result, int width, int height) {
    const auto area = static_cast<std::size_t>(width) * height;
    if (result.width != width || result.height != height || result.depth.size() != area ||
        result.points.size() != area * 3 || result.mask.size() != area)
        throw std::runtime_error("Geometry model returned invalid output dimensions");
    std::size_t valid = 0;
    float minimum = std::numeric_limits<float>::infinity();
    float maximum = 0;
    for (std::size_t i = 0; i < area; ++i) {
        if (result.mask[i] > 1)
            throw std::runtime_error("Geometry model returned a nonbinary validity mask");
        if (result.mask[i]) {
            ++valid;
            if (!std::isfinite(result.depth[i]) || result.depth[i] <= 0)
                throw std::runtime_error("Geometry model returned invalid visible depth");
            for (std::size_t c = 0; c < 3; ++c)
                if (!std::isfinite(result.points[3 * i + c]))
                    throw std::runtime_error("Geometry model returned invalid visible points");
            if (result.points[3 * i + 2] != result.depth[i])
                throw std::runtime_error("Geometry depth and point Z disagree");
            minimum = std::min(minimum, result.depth[i]);
            maximum = std::max(maximum, result.depth[i]);
        } else {
            if (result.depth[i] != std::numeric_limits<float>::infinity())
                throw std::runtime_error(
                    "Invalid geometry pixels must preserve positive-infinity depth");
            for (std::size_t c = 0; c < 3; ++c)
                if (result.points[3 * i + c] != std::numeric_limits<float>::infinity())
                    throw std::runtime_error(
                        "Invalid geometry pixels must preserve positive-infinity points");
        }
    }
    if (!valid)
        throw std::runtime_error("Geometry model returned no valid geometry");
    for (const auto value : result.intrinsics)
        if (!std::isfinite(value))
            throw std::runtime_error("Geometry model returned invalid intrinsics");
    return {{"width", width},
            {"height", height},
            {"depthBase64", floats_base64(result.depth)},
            {"pointsBase64", floats_base64(result.points)},
            {"maskBase64", base64(result.mask.data(), result.mask.size())},
            {"depthEncoding", "float32le"},
            {"pointsEncoding", "float32le-xyz"},
            {"maskEncoding", "u8-validity"},
            {"invalidValue", "+Infinity"},
            {"intrinsics", result.intrinsics},
            {"intrinsicsConvention", "normalized-image-coordinates"},
            {"validPixelCount", valid},
            {"depthMin", minimum},
            {"depthMax", maximum}};
}
} // namespace showcase::geometry
