#include "families/qwen_vl/runtime/distributed_runtime.h"

#include <stdexcept>
namespace trtmc::qwen_vl {
DistributedRuntimeGroup initialize_tensor_parallel_group(int tp_size) {
    if (tp_size != 1)
        throw std::invalid_argument(
            "The Windows image-understanding demo supports tensor_parallel_size=1 only");
    return {};
}
} // namespace trtmc::qwen_vl
