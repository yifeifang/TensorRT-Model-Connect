"""Save reviewed model notices locally before fetching weights; never grant redistribution rights."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request


EXTRA_NOTICES = {
    "asr": [
        ("ORIGINAL-WHISPER-MIT.txt", "https://raw.githubusercontent.com/openai/whisper/main/LICENSE"),
        ("APACHE-2.0.txt", "https://www.apache.org/licenses/LICENSE-2.0.txt"),
    ],
    "embedding": [("REFERENCE-SOURCE-UNILM-MIT.txt", "https://raw.githubusercontent.com/microsoft/unilm/master/LICENSE")],
    "vision": [("APACHE-2.0.txt", "https://www.apache.org/licenses/LICENSE-2.0.txt")],
    "understanding": [("APACHE-2.0.txt", "https://www.apache.org/licenses/LICENSE-2.0.txt")],
    "geometry": [("REFERENCE-SOURCE-MIT-AND-APACHE.txt", "https://raw.githubusercontent.com/microsoft/MoGe/74fbce054ebed49800de42d0ad0e83495065719a/LICENSE")],
    "voice": [("OPENMDW-1.1.txt", "https://raw.githubusercontent.com/OpenMDW/OpenMDW/main/1.1/LICENSE.OpenMDW-1.1")],
    "voice-tokenizer": [
        ("NVIDIA-OPEN-MODEL-LICENSE.html", "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/"),
        ("TRUSTWORTHY-AI-TERMS.html", "https://www.nvidia.com/en-us/agreements/trustworthy-ai/terms/"),
    ],
}


def read_url(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ModelConnect-Showcase-License-Acquisition/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        result = response.read(8 * 1024 * 1024 + 1)
    if not result or len(result) > 8 * 1024 * 1024:
        raise ValueError("Unexpected license document size")
    return result


def acquire(workspace, selected):
    inventory = json.loads((workspace / "showcase/distribution/model-licenses.json").read_text(encoding="utf-8-sig"))
    if "voice" in selected:
        selected = [*selected, "voice-tokenizer"]
    available = {model["id"]: model for model in inventory["models"]}
    if not selected or any(model_id not in available for model_id in selected):
        raise ValueError("Choose model IDs from the reviewed inventory")
    for model_id in dict.fromkeys(selected):
        model = available[model_id]
        destination = workspace / "models/licenses" / model_id
        destination.mkdir(parents=True, exist_ok=True)
        receipt = {"model": model, "complete": False, "documents": [], "retrievedAt": datetime.now(timezone.utc).isoformat(),
                   "externalTerms": "External agreement URLs may change independently of the model revision; exact downloaded bytes are recorded below."}
        receipt_path = destination / "receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        metadata = json.loads(read_url(f"https://huggingface.co/api/models/{model['repository']}/revision/{model['revision']}"))
        if metadata["sha"] != model["revision"]:
            raise ValueError("Model hub revision differs from the reviewed pin")
        documents = []
        for sibling in metadata["siblings"]:
            name = sibling["rfilename"]
            basename = Path(name).name.upper()
            if name == "README.md" or basename.startswith(("LICENSE", "NOTICE")):
                documents.append(("MODEL-" + name.replace("/", "__"), f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{name}"))
        if not any(name == "MODEL-README.md" for name, _ in documents):
            raise ValueError("Pinned model card is absent")
        documents.extend(EXTRA_NOTICES.get(model_id, []))
        for filename, url in documents:
            data = read_url(url)
            (destination / filename).write_bytes(data)
            receipt["documents"].append({"path": filename, "url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        if model_id == "voice-tokenizer":
            (destination / "NOTICE.txt").write_text("Licensed by NVIDIA Corporation under the NVIDIA Open Model License\n", encoding="utf-8")
        if model_id == "embedding":
            (destination / "NOTICE-SCOPE.txt").write_text("The pinned model card declares MIT. The UNILM notice is reference-source attribution; it does not independently establish checkpoint copyright ownership.\n", encoding="utf-8")
        receipt["complete"] = True
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        print(f"Preserved model notices: {model_id}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--acknowledge-model-terms", action="store_true")
    args = parser.parse_args()
    if not args.acknowledge_model_terms:
        parser.error("Review the inventory's license conditions and pass --acknowledge-model-terms before downloading")
    acquire(args.workspace.resolve(), args.models)
