"""Compare real native geometry with the pinned upstream model on CPU."""
import importlib.util
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "models" / "geometry-validation"
OUT.mkdir(parents=True, exist_ok=True)
FAMILY = ROOT / "vendor" / "ModelConnect" / "families" / "moge" / "tests"
SOURCE = ROOT / "models" / "geometry-reference" / "MoGe-74fbce054ebed49800de42d0ad0e83495065719a"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    torch.set_num_threads(8)
    reference = load_module("geometry_official_reference", FAMILY / "official_reference.py")
    reference._install_utils3d_shim(torch)
    sys.path.insert(0, str(SOURCE))
    from moge.model.v2 import MoGeModel
    checkpoint = torch.load(ROOT / "models" / "geometry-moge-2-vitl" / "model.pt", map_location="cpu", weights_only=True, mmap=True)
    model = MoGeModel(**checkpoint["model_config"])
    missing, unexpected = model.load_state_dict(checkpoint["model"], strict=False)
    if missing or unexpected:
        raise ValueError(f"Checkpoint state mismatch: {missing}, {unexpected}")
    model.onnx_compatible_mode = True
    model.eval().to("cpu")
    receipt = {"passed": False, "referenceDevice": "cpu", "referenceRepository": "microsoft/MoGe", "referenceRevision": "74fbce054ebed49800de42d0ad0e83495065719a", "checkpointSha256": "3eefd4abb2102f38f12b2d1992e5ff15e4923e5431c67dd494afe157e0111cd5", "torchVersion": torch.__version__, "numTokens": 1800, "onnxCompatibleMode": True, "useFp16": False, "results": []}
    for name in ("car", "house"):
        image = np.asarray(Image.open(ROOT / "models" / "geometry-fixtures" / (name + ".png")).convert("RGB"), dtype=np.float32).copy()
        tensor = torch.from_numpy(image / 255.0).permute(2, 0, 1)
        start = time.perf_counter()
        with torch.inference_mode(), reference._math_sdpa(torch):
            raw = model.forward(tensor.unsqueeze(0), num_tokens=1800)
            np.savez_compressed(OUT / (name + "-reference-forward.npz"), **{key: value.detach().cpu().numpy() for key, value in raw.items()})
            result = model.infer(tensor, num_tokens=1800, use_fp16=False, force_projection=True, apply_mask=True)
        elapsed = (time.perf_counter() - start) * 1000
        arrays = {key: value.detach().cpu().numpy() for key, value in result.items()}
        np.savez_compressed(OUT / (name + "-reference.npz"), **arrays)
        receipt["results"].append({"name": name, "referenceMs": elapsed, "shape": list(arrays["depth"].shape)})
        print(json.dumps(receipt["results"][-1]), flush=True)
    (OUT / "reference-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("Independent CPU reference outputs written; run compare.py after native qualification.", flush=True)


if __name__ == "__main__":
    main()
