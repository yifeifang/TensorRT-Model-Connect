"""Acquire one pinned public checkpoint without changing a shared model cache."""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "models/understanding-qwen3-vl-2b"
REPOSITORY = "Qwen/Qwen3-VL-2B-Instruct"
REVISION = "89644892e4d85e24eaac8bacfd4f463576704203"
EXPECTED_WEIGHTS = "7de1838c87a5349b016c26a1c3f7d2bc400a3d485f95ef39a7059ffd734977a0"

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ModelConnect-capability-build/1.0"}), timeout=180)

def acquire(entry):
    name = entry["rfilename"]
    target = DESTINATION / name
    url = f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}"
    expected = entry.get("lfs", {}).get("sha256")
    def verify(path):
        sha = hashlib.sha256()
        git = hashlib.sha1(f"blob {entry['size']}\0".encode())
        with path.open("rb") as handle:
            while block := handle.read(8 * 1024 * 1024):
                sha.update(block)
                git.update(block)
        if path.stat().st_size != entry["size"]:
            raise ValueError(f"Wrong byte count: {name}")
        if expected and sha.hexdigest() != expected:
            raise ValueError(f"Wrong LFS SHA-256: {name}")
        if not expected and git.hexdigest() != entry["blobId"]:
            raise ValueError(f"Wrong Git blob SHA-1: {name}")
        return {"file": name, "url": url, "bytes": path.stat().st_size,
                "sha256": sha.hexdigest(), "gitBlob": entry["blobId"], "officialLfsSha256": expected}
    if target.exists():
        result = verify(target)
        print(f"Verified existing {name}", flush=True)
        return result
    temporary = target.with_name(target.name + ".partial")
    for attempt in range(3):
        try:
            with get(url) as response, temporary.open("wb") as output:
                total = 0
                while block := response.read(8 * 1024 * 1024):
                    output.write(block)
                    total += len(block)
                    if total % (256 * 1024 * 1024) == 0:
                        print(f"{name}: {total / 1024**3:.2f} GiB", flush=True)
            result = verify(temporary)
            temporary.replace(target)
            print(f"Acquired {name}: {result['bytes']} bytes", flush=True)
            return result
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))

def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with get(f"https://huggingface.co/api/models/{REPOSITORY}/revision/{REVISION}?blobs=true") as response:
        metadata = json.load(response)
    assert metadata["sha"] == REVISION
    assert metadata["cardData"]["license"] == "apache-2.0"
    weights = next(entry for entry in metadata["siblings"] if entry["rfilename"] == "model.safetensors")
    assert weights["lfs"]["sha256"] == EXPECTED_WEIGHTS
    (DESTINATION / "official-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    entries = [entry for entry in metadata["siblings"] if entry["rfilename"] != ".gitattributes"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        files = list(executor.map(acquire, entries))
    license_url = "https://www.apache.org/licenses/LICENSE-2.0.txt"
    with get(license_url) as response:
        license_bytes = response.read()
    (DESTINATION / "LICENSE-APACHE-2.0.txt").write_bytes(license_bytes)
    receipt = {"repository": REPOSITORY, "revision": REVISION, "license": "Apache-2.0", "licenseUrl": license_url,
               "licenseSha256": hashlib.sha256(license_bytes).hexdigest(), "complete": True, "files": files,
               "acquiredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "verification": "Pinned official Git object identity for all small assets and official LFS SHA-256 for weights; measured SHA-256 and byte counts for all files."}
    (ROOT / "showcase/understanding-native/checkpoint-provenance.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"complete": True, "directory": str(DESTINATION), "files": len(files)}), flush=True)

if __name__ == "__main__":
    main()
