#include "geometry_contract.h"
#include "trtmc/bundle.h"
#include "trtmc/runtime/trt_backend.h"

#include <filesystem>
#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
    try {
        if (argc != 2)
            throw std::invalid_argument("Usage: geometry_engine_probe WORKTREE_ROOT");
        const auto root = std::filesystem::absolute(std::filesystem::u8path(argv[1]));
        const auto output = root / "models" / "geometry-validation";
        std::filesystem::create_directories(output);
        const trtmc::BundleReader reader(
            (root / "models" / "geometry-moge-2-vitl-rtx.bundle").u8string());
        auto plan = reader.read_section("engine.plan");
        std::unique_ptr<trtmc::IBackend, decltype(&trtmc_destroy_backend)> backend(
            trtmc_create_backend(), trtmc_destroy_backend);
        if (!backend)
            throw std::runtime_error("Missing RTX backend");
        const auto cache = (root / "models" / "geometry-moge-2-vitl.rtx.cache").u8string();
        trtmc::ModuleCreateOptions options{};
        options.runtime_cache_path = cache.c_str();
        auto module = backend->create_module(plan.data(), plan.size(), options);
        if (!module || !module->ok())
            throw std::runtime_error("Geometry engine did not load");
        for (const std::string name : {"car", "house"}) {
            auto image = showcase::geometry::read_ppm_file(
                (root / "models" / "geometry-fixtures" / (name + ".ppm")).u8string());
            trtmc::Tensor tensor{
                image.pixels.data(), {1, image.height, image.width, 3}, trtmc::DType::kFloat32};
            auto results = module->forward({{"image", tensor}});
            nlohmann::json metadata = nlohmann::json::object();
            for (const auto& [key, value] : results) {
                const auto bytes = static_cast<std::size_t>(value.numel()) *
                                   (value.dtype == trtmc::DType::kFloat16 ? 2 : 4);
                if (value.dtype != trtmc::DType::kFloat16 && value.dtype != trtmc::DType::kFloat32)
                    throw std::runtime_error("Unexpected raw output type");
                const auto target = output / (name + "-engine-" + key + ".bin");
                std::ofstream file(target, std::ios::binary);
                file.write(static_cast<const char*>(value.data),
                           static_cast<std::streamsize>(bytes));
                metadata[key] = {
                    {"shape", value.shape},
                    {"dtype", value.dtype == trtmc::DType::kFloat16 ? "float16" : "float32"},
                    {"file", target.filename().u8string()}};
            }
            std::ofstream file(output / (name + "-engine.json"));
            file << metadata.dump(2) << '\n';
            std::cout << "Saved raw engine outputs for " << name << '\n';
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
