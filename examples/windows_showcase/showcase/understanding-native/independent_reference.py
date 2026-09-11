"""Independent official-checkpoint reference, explicitly on CPU.

No ModelConnect builder, runtime, tokenizer, prompt formatter or vision encoder
is imported. Images are resized to the compiled 448-square input contract before
the checkpoint's official processor. Generated text is never a demo fallback.
"""
from __future__ import annotations
import hashlib
import importlib.metadata
import json
from pathlib import Path
import time
import torch
from PIL import Image, ImageDraw
from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT = ROOT / "models/understanding-qwen3-vl-2b"
ASSETS = ROOT / "models/understanding-fixtures"
OUTPUT = ROOT / "showcase/understanding-native/independent-reference.json"

def prepare():
    ASSETS.mkdir(parents=True, exist_ok=True)
    photo = ROOT / "showcase/renderer/fixtures/vision-car.jpeg"
    Image.open(photo).convert("RGB").save(ASSETS / "car.ppm")
    for color in ["red", "blue"]:
        image = Image.new("RGB", (448, 448), "white")
        ImageDraw.Draw(image).ellipse((88, 88, 360, 360), fill=color)
        image.save(ASSETS / f"{color}-circle.ppm")
    return [
        {"name": "car-color", "file": "car.ppm", "prompt": "What color is the vehicle in this image? Answer in one word.", "expectedConcept": "white"},
        {"name": "car-object", "file": "car.ppm", "prompt": "What type of vehicle is shown? Answer in one word.", "expectedConcept": "car"},
        {"name": "red-circle", "file": "red-circle.ppm", "prompt": "What color is the large shape? Answer in one word.", "expectedConcept": "red"},
        {"name": "blue-circle", "file": "blue-circle.ppm", "prompt": "What color is the large shape? Answer in one word.", "expectedConcept": "blue"},
        {"name": "blue-shape", "file": "blue-circle.ppm", "prompt": "What simple shape is shown? Answer in one word.", "expectedConcept": "circle"},
    ]

def main():
    torch.set_num_threads(8)
    torch.set_num_interop_threads(4)
    cases = prepare()
    processor = AutoProcessor.from_pretrained(CHECKPOINT, local_files_only=True, use_fast=False, trust_remote_code=False)
    started = time.monotonic()
    model = Qwen3VLForConditionalGeneration.from_pretrained(CHECKPOINT, local_files_only=True, trust_remote_code=False,
        torch_dtype=torch.float32, attn_implementation="eager").to("cpu").eval()
    receipt = {"complete": False, "device": "cpu", "dtype": "float32", "model": "Qwen/Qwen3-VL-2B-Instruct",
        "revision": "89644892e4d85e24eaac8bacfd4f463576704203", "loadSeconds": time.monotonic() - started,
        "versions": {name: importlib.metadata.version(name) for name in ["torch", "transformers", "Pillow", "numpy"]},
        "scope": "Independent official Transformers model and processor, greedy decoding; fixed 448x448 profile alignment; no runtime-generated outputs reused.",
        "processorMean": processor.image_processor.image_mean, "processorStd": processor.image_processor.image_std, "cases": []}
    print(f"CPU reference loaded in {receipt['loadSeconds']:.2f}s", flush=True)
    for case in cases:
        image_path = ASSETS / case["file"]
        source_image = Image.open(image_path).convert("RGB")
        image = source_image.resize((448, 448), Image.Resampling.BICUBIC)
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": case["prompt"]}]}]
        prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=[prompt], images=[image], return_tensors="pt")
        assert inputs["image_grid_thw"].tolist() == [[1, 28, 28]]
        started = time.monotonic()
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=32, do_sample=False)
        ids = generated[0, inputs["input_ids"].shape[1]:].tolist()
        text = processor.decode(ids, skip_special_tokens=True)
        entry = {**case, "imageSha256": hashlib.sha256(image_path.read_bytes()).hexdigest(), "width": source_image.width,
                 "height": source_image.height, "visionWidth": 448, "visionHeight": 448, "text": text, "tokenIds": ids,
                 "promptTokens": inputs["input_ids"].shape[1], "elapsedMs": (time.monotonic() - started) * 1000}
        receipt["cases"].append(entry)
        OUTPUT.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps(entry), flush=True)
    receipt["complete"] = True
    OUTPUT.write_text(json.dumps(receipt, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
