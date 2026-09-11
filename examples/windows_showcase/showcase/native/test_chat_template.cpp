#include "families/qwen/runtime/chat_templates.h"

#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <stdexcept>

int main(int argc, char** argv) {
    try {
        if (argc != 2)
            throw std::invalid_argument("Pass the template fixture JSON file");
        std::ifstream input(argv[1]);
        const auto fixtures = nlohmann::json::parse(input);
        for (const auto& fixture : fixtures) {
            const auto format =
                trtmc::qwen_detect_chat_template_format(fixture.at("template").get<std::string>());
            const auto actual = trtmc::qwen_apply_chat_template(
                format, fixture.at("prompt").get<std::string>(), false);
            if (actual != fixture.at("expected").get<std::string>())
                throw std::runtime_error(
                    "Native template differs from checkpoint Jinja rendering: " +
                    fixture.at("model").get<std::string>());
            std::cout << fixture.at("model").get<std::string>()
                      << ": matched checkpoint Jinja template\n";
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
