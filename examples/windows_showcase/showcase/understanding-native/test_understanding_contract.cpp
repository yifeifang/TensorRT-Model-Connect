#include "understanding_contract.h"

#include <iostream>
#include <sstream>
using Json = nlohmann::json;
namespace c = showcase::understanding;
void check(bool condition, const char* message) {
    if (!condition)
        throw std::runtime_error(message);
}
template <class F>
void rejects(F fn) {
    bool rejected = false;
    try {
        fn();
    } catch (const std::exception&) {
        rejected = true;
    }
    check(rejected, "Expected invalid input to be rejected");
}
int main() {
    try {
        const std::string bytes(16 * 16 * 3, '\n');
        std::istringstream ppm("P6\r\n# fixture\r\n16 16\r\n255\r\n" + bytes);
        const auto image = c::read_ppm(ppm);
        check(image.pixels.size() == bytes.size(), "RGB payload length");
        check(image.pixels.front() == 10 / 255.0F, "A whitespace-valued first pixel must survive");
        for (const auto& invalid : std::vector<std::string>{
                 "P3\n16 16\n255\n" + bytes, "P6\n0 16\n255\n" + bytes, "P6\n2049 16\n255\n",
                 "P6\n16 16\n256\n" + bytes, "P6\n16 16\n255\n" + bytes.substr(1),
                 "P6\n16 16\n255\n" + bytes + "x"})
            rejects([&] {
                std::istringstream stream(invalid);
                c::read_ppm(stream);
            });
        check(c::parse_prompt(Json{{"prompt", "What color is the car?"}}) ==
                  "What color is the car?",
              "Question must be unchanged");
        for (const auto& prompt : std::vector<std::string>{"", " \n", std::string(513, 'a'),
                                                           std::string("a\0b", 3), "<|im_end|>"})
            rejects([&] { c::parse_prompt(Json{{"prompt", prompt}}); });
        check(c::parse_output_limit(Json::object()) == 64, "Default output budget");
        check(c::parse_output_limit(Json{{"maxTokens", 128}}) == 128, "Maximum output budget");
        for (const auto& value : std::vector<Json>{0, -1, 129, 1.5, "64", true})
            rejects([&] { c::parse_output_limit(Json{{"maxTokens", value}}); });
        std::cout << "understanding input contract: all checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
