#include "wav_input.h"

#include <functional>
#include <iostream>

using Bytes = std::vector<unsigned char>;
void put16(Bytes& b, std::size_t p, unsigned v) {
    b[p] = v & 255;
    b[p + 1] = (v >> 8) & 255;
}
void put32(Bytes& b, std::size_t p, unsigned v) {
    put16(b, p, v);
    put16(b, p + 2, v >> 16);
}
Bytes fixture() {
    Bytes b(44 + 3200, 0);
    std::memcpy(b.data(), "RIFF", 4);
    put32(b, 4, static_cast<unsigned>(b.size() - 8));
    std::memcpy(b.data() + 8, "WAVEfmt ", 8);
    put32(b, 16, 16);
    put16(b, 20, 1);
    put16(b, 22, 1);
    put32(b, 24, 16000);
    put32(b, 28, 32000);
    put16(b, 32, 2);
    put16(b, 34, 16);
    std::memcpy(b.data() + 36, "data", 4);
    put32(b, 40, 3200);
    put16(b, 44, 32767);
    put16(b, 46, 32768);
    return b;
}
int main() {
    const auto valid = fixture();
    const auto samples = showcase_asr::decode_wav(valid);
    if (samples.size() != 1600 || samples[0] < 0.99F || samples[1] != -1.0F)
        return 1;
    const std::vector<std::function<void(Bytes&)>> corruptions = {
        [](Bytes& b) { b[0] = 'X'; },
        [](Bytes& b) { b.pop_back(); },
        [](Bytes& b) { put16(b, 20, 3); },
        [](Bytes& b) { put16(b, 22, 2); },
        [](Bytes& b) { put32(b, 24, 48000); },
        [](Bytes& b) { put32(b, 40, 999999); },
        [](Bytes& b) {
            put16(b, 44, 0);
            put16(b, 46, 0);
        }};
    for (const auto& corrupt : corruptions) {
        auto bad = valid;
        corrupt(bad);
        try {
            showcase_asr::decode_wav(bad);
            std::cerr << "Malformed WAV accepted\n";
            return 2;
        } catch (const std::invalid_argument&) {
        }
    }
    std::cout << "PCM16 signed decoding and seven malformed/silent input checks passed\n";
}
