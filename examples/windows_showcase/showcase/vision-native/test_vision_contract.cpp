#include "vision_contract.h"

#include <iostream>
using namespace showcase::vision;
using Json = nlohmann::json;
void require(bool condition, const char* message) {
    if (!condition)
        throw std::runtime_error(message);
}
template <typename F>
void rejects(F callback) {
    bool rejected = false;
    try {
        callback();
    } catch (const std::exception&) {
        rejected = true;
    }
    require(rejected, "Invalid input accepted");
}
int main() {
    try {
        std::string ppm = "P6\n# original RGB pixels\n2 1\n255\n";
        ppm += std::string("\x0a\x20\x00\xff\x80\x01", 6);
        std::istringstream stream(ppm);
        const auto image = read_ppm(stream);
        require(image.width == 2 && image.height == 1 && image.pixels.size() == 6,
                "Image shape changed");
        require(std::abs(image.pixels[0] - 10.0F / 255.0F) < 1e-6F && image.pixels[3] == 1.0F,
                "RGB normalization or first whitespace byte changed");
        const auto point = parse_point(Json::array({{{"x", 1}, {"y", 0}, {"label", 1}}}), 2, 1);
        require(point.x == 0.5F && point.y == 0 && point.foreground,
                "Pixel coordinate conversion changed");
        rejects([&] { parse_point(Json::array({{{"x", 2}, {"y", 0}, {"label", 1}}}), 2, 1); });
        rejects([&] { parse_point(Json::array({{{"x", 1}, {"y", 0}, {"label", 2}}}), 2, 1); });
        rejects([&] {
            parse_point(Json::array({{{"x", 0}, {"y", 0}, {"label", 1}},
                                     {{"x", 1}, {"y", 0}, {"label", 1}}}),
                        2, 1);
        });
        rejects([&] {
            std::istringstream truncated(ppm.substr(0, ppm.size() - 1));
            read_ppm(truncated);
        });
        rejects([&] {
            std::istringstream oversized("P6\n4194304 2\n255\n");
            read_ppm(oversized);
        });
        trtmc::PromptedSegmentationResult masks;
        masks.width = 2;
        masks.height = 1;
        masks.num_masks = 3;
        masks.iou_scores = {0.2F, 0.9F, 0.5F};
        masks.masks = {4.0F, 3.0F, -7.0F, 2.0F, 0.0F, -2.0F};
        const auto chosen = select_mask(masks, 2, 1);
        require(chosen.at("maskIndex") == 1 && chosen.at("maskBase64") == "AP8=" &&
                    chosen.at("foregroundPixels") == 1,
                "Highest predicted IoU mask must threshold logits at zero");
        require(base64({255}) == "/w==" && base64({0, 255, 0}) == "AP8A", "Base64 tail changed");
        masks.masks[2] = std::numeric_limits<float>::quiet_NaN();
        rejects([&] { select_mask(masks, 2, 1); });
        std::cout << "Vision contract: PPM RGB normalization, point bounds, malformed payloads, "
                     "mask selection and binary serialization passed.\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
