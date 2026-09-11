#include "unicode_normalize.h"
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <limits>
#include <stdexcept>
#include <vector>
#include <windows.h>

namespace trtmc {
std::string windows_nfkc_normalize(const std::string& text) {
    if (text.empty())
        return {};
    if (text.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
        throw std::invalid_argument("Text exceeds the Windows Unicode length limit");
    const int bytes = static_cast<int>(text.size());
    const int units =
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), bytes, nullptr, 0);
    if (units <= 0)
        throw std::invalid_argument("Text is not valid UTF-8");
    std::vector<wchar_t> wide(static_cast<std::size_t>(units));
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), bytes, wide.data(),
                            units) != units)
        throw std::runtime_error("UTF-8 conversion failed");
    int capacity = NormalizeString(NormalizationKC, wide.data(), units, nullptr, 0);
    if (capacity <= 0)
        throw std::runtime_error("Unable to determine Unicode normalization size");
    std::vector<wchar_t> normalized(static_cast<std::size_t>(capacity));
    int written = NormalizeString(NormalizationKC, wide.data(), units, normalized.data(), capacity);
    if (written < 0 && GetLastError() == ERROR_INSUFFICIENT_BUFFER) {
        capacity = -written;
        normalized.resize(static_cast<std::size_t>(capacity));
        written = NormalizeString(NormalizationKC, wide.data(), units, normalized.data(), capacity);
    }
    if (written <= 0)
        throw std::runtime_error("Unicode normalization failed");
    const int result_bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, normalized.data(),
                                                 written, nullptr, 0, nullptr, nullptr);
    if (result_bytes <= 0)
        throw std::runtime_error("Unable to encode normalized Unicode");
    std::string result(static_cast<std::size_t>(result_bytes), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, normalized.data(), written,
                            result.data(), result_bytes, nullptr, nullptr) != result_bytes)
        throw std::runtime_error("Normalized Unicode encoding failed");
    return result;
}
} // namespace trtmc
