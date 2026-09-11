#pragma once
#include <string>

namespace trtmc {
// Windows Unicode compatibility normalization for the E5 SentencePiece input.
std::string windows_nfkc_normalize(const std::string& text);
} // namespace trtmc
