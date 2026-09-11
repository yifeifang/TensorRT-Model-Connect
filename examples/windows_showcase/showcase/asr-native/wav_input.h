#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace showcase_asr {
inline std::uint16_t u16(const std::vector<unsigned char>& bytes, std::size_t offset) {
    if (offset + 2 > bytes.size())
        throw std::invalid_argument("Truncated WAV field");
    return static_cast<std::uint16_t>(bytes[offset] | (bytes[offset + 1] << 8));
}
inline std::uint32_t u32(const std::vector<unsigned char>& bytes, std::size_t offset) {
    if (offset + 4 > bytes.size())
        throw std::invalid_argument("Truncated WAV field");
    return static_cast<std::uint32_t>(bytes[offset]) |
           (static_cast<std::uint32_t>(bytes[offset + 1]) << 8) |
           (static_cast<std::uint32_t>(bytes[offset + 2]) << 16) |
           (static_cast<std::uint32_t>(bytes[offset + 3]) << 24);
}
inline bool tag(const std::vector<unsigned char>& bytes, std::size_t offset, const char* value) {
    return offset + 4 <= bytes.size() && std::memcmp(bytes.data() + offset, value, 4) == 0;
}
inline std::vector<float> decode_wav(const std::vector<unsigned char>& bytes) {
    if (bytes.size() < 44 || bytes.size() > 1024 * 1024 || !tag(bytes, 0, "RIFF") ||
        !tag(bytes, 8, "WAVE"))
        throw std::invalid_argument("Expected a RIFF WAV file of at most 1 MiB");
    if (static_cast<std::uint64_t>(u32(bytes, 4)) + 8 != bytes.size())
        throw std::invalid_argument("WAV RIFF length does not match file size");
    bool format = false;
    std::size_t data_start = 0, data_size = 0;
    for (std::size_t cursor = 12; cursor < bytes.size();) {
        if (cursor + 8 > bytes.size())
            throw std::invalid_argument("Truncated WAV chunk header");
        const std::size_t size = u32(bytes, cursor + 4);
        const std::size_t start = cursor + 8;
        if (size > bytes.size() - start)
            throw std::invalid_argument("Truncated WAV chunk");
        if (tag(bytes, cursor, "fmt ")) {
            if (format || size < 16 || u16(bytes, start) != 1 || u16(bytes, start + 2) != 1 ||
                u32(bytes, start + 4) != 16000 || u32(bytes, start + 8) != 32000 ||
                u16(bytes, start + 12) != 2 || u16(bytes, start + 14) != 16)
                throw std::invalid_argument(
                    "WAV must be 16000 Hz, mono, signed PCM16 little-endian");
            format = true;
        } else if (tag(bytes, cursor, "data")) {
            if (data_start)
                throw std::invalid_argument("Multiple WAV data chunks are unsupported");
            data_start = start;
            data_size = size;
        }
        cursor = start + size + (size & 1);
        if (cursor > bytes.size())
            throw std::invalid_argument("Missing WAV chunk padding");
    }
    if (!format || !data_start || data_size % 2 || data_size < 3200 || data_size > 960000)
        throw std::invalid_argument("WAV must contain 0.1 to 30 seconds of PCM16 audio");
    std::vector<float> samples(data_size / 2);
    double square_sum = 0;
    for (std::size_t i = 0; i < samples.size(); ++i) {
        const auto value = u16(bytes, data_start + 2 * i);
        const auto signed_value =
            value < 32768 ? static_cast<int>(value) : static_cast<int>(value) - 65536;
        samples[i] = signed_value / 32768.0F;
        square_sum += samples[i] * samples[i];
    }
    if (std::sqrt(square_sum / samples.size()) < 0.00001)
        throw std::invalid_argument("Audio contains no measurable signal");
    return samples;
}
inline std::vector<float> load_wav(const std::string& path_utf8) {
    if (path_utf8.empty() || path_utf8.find('\0') != std::string::npos)
        throw std::invalid_argument("wavPath is empty or contains NUL");
    const auto path = std::filesystem::u8path(path_utf8);
    if (!path.is_absolute() || !std::filesystem::is_regular_file(path))
        throw std::invalid_argument("wavPath must identify an existing absolute file");
    const auto size = std::filesystem::file_size(path);
    if (size > 1024 * 1024)
        throw std::invalid_argument("WAV exceeds 1 MiB");
    std::ifstream stream(path, std::ios::binary);
    std::vector<unsigned char> bytes(static_cast<std::size_t>(size));
    if (!stream.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(size)))
        throw std::runtime_error("Failed to read WAV file");
    return decode_wav(bytes);
}
} // namespace showcase_asr
