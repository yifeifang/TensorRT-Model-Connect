"""Acquire pinned public geometry weights and reference source, with digests."""
import hashlib
import json
import tarfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "models" / "geometry-moge-2-vitl"
REF = ROOT / "models" / "geometry-reference"
MODEL = "Ruicheng/moge-2-vitl"
REVISION = "39c4d5e957afe587e04eec59dc2bcc3be5ecd968"
SOURCE_REVISION = "74fbce054ebed49800de42d0ad0e83495065719a"


def fetch(url, target):
    request = urllib.request.Request(url, headers={"User-Agent": "ModelConnect-Showcase-Qualification/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as destination:
        while chunk := response.read(8 * 1024 * 1024):
            destination.write(chunk)


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    REF.mkdir(parents=True, exist_ok=True)
    metadata_url = f"https://huggingface.co/api/models/{MODEL}/tree/{REVISION}?recursive=true&expand=false"
    metadata_path = OUT / "tree.json"
    fetch(metadata_url, metadata_path)
    metadata = json.loads(metadata_path.read_text())
    record = {"model": MODEL, "revision": REVISION, "complete": False, "metadataUrl": metadata_url, "files": []}
    for name in ("README.md", "model.pt"):
        entry = next(item for item in metadata if item["path"] == name)
        target = OUT / name
        expected = entry.get("lfs", {}).get("oid")
        if not target.exists() or target.stat().st_size != entry["size"] or (expected and digest(target) != expected):
            partial = OUT / (name + ".partial")
            fetch(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}?download=true", partial)
            if partial.stat().st_size != entry["size"]:
                raise ValueError(f"Unexpected download size: {name}")
            if expected and digest(partial) != expected:
                raise ValueError(f"SHA-256 mismatch: {name}")
            partial.replace(target)
        record["files"].append({"path": str(target.relative_to(ROOT)), "bytes": target.stat().st_size, "sha256": digest(target), "expectedLfsSha256": expected})
        print(f"Verified {name}: {target.stat().st_size} bytes", flush=True)
    archive = REF / "source.tar.gz"
    source_url = f"https://codeload.github.com/microsoft/MoGe/tar.gz/{SOURCE_REVISION}"
    if not archive.exists():
        fetch(source_url, archive)
    extraction_root = REF.resolve()
    with tarfile.open(archive, "r:gz") as source:
        for item in source.getmembers():
            target = (REF / item.name).resolve()
            if not target.is_relative_to(extraction_root) or item.issym() or item.islnk():
                raise ValueError("Unsafe source archive member")
        source.extractall(REF, filter="data")
    source_root = REF / ("MoGe-" + SOURCE_REVISION)
    license_path = source_root / "LICENSE"
    if not license_path.is_file():
        raise ValueError("Reference source license missing")
    (OUT / "SOURCE-LICENSE.txt").write_bytes(license_path.read_bytes())
    record.update({"complete": True, "license": "MIT (model card and pinned reference source)", "reference": {"repository": "microsoft/MoGe", "revision": SOURCE_REVISION, "url": source_url, "archiveSha256": digest(archive), "sourceRoot": str(source_root.relative_to(ROOT))}, "verifiedAtUnix": time.time()})
    (ROOT / "models" / "geometry-download.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, indent=2), flush=True)


if __name__ == "__main__":
    main()
