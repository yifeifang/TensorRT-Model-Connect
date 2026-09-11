#include "families/bert/runtime/distributed_runtime.h"

#include <stdexcept>

namespace trtmc::bert {
// The showcased Windows checkpoint is a single-device engine. Preserve the
// family's default TP=1 group and explicitly reject Linux NCCL orchestration.
DistributedRuntimeGroup initialize_tensor_parallel_group(int tp_size) {
    if (tp_size != 1)
        throw std::invalid_argument(
            "The Windows embedding demo supports tensor_parallel_size=1 only");
    return {};
}
} // namespace trtmc::bert
