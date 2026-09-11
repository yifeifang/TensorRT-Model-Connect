"""Apply the two qualified family patches only to the known source snapshot.

Unknown source contents are rejected before any write. This never edits the
parent checkout or shared toolchain. Re-running on already patched files is safe.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re


def transform(source, patch):
    lines = source.splitlines(keepends=True)
    output, cursor = [], 0
    parts = patch.splitlines(keepends=True)
    index = 2  # unified diff file headers
    while index < len(parts):
        header = re.fullmatch(r"@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@.*\n?", parts[index])
        if not header:
            raise ValueError("Unexpected unified patch header")
        start = int(header.group(1)) - 1
        output.extend(lines[cursor:start])
        cursor, index = start, index + 1
        while index < len(parts) and not parts[index].startswith("@@"):
            action, line = parts[index][0], parts[index][1:]
            if action in " -":
                if cursor >= len(lines) or lines[cursor] != line:
                    raise ValueError("Patch context does not match the pinned source")
                cursor += 1
            if action in " +":
                output.append(line)
            if action not in " +-":
                raise ValueError("Unsupported unified patch line")
            index += 1
    return "".join(output + lines[cursor:])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    source_root = (args.workspace / "vendor/ModelConnect").resolve()
    planned = []
    for name, receipt_name in [("qwen-vl-normalization", "normalization-patch"), ("qwen-vl-result-text", "result-text-patch")]:
        receipt = json.loads((directory / f"{receipt_name}.json").read_text(encoding="utf-8-sig"))
        target = (source_root / receipt["file"]).resolve()
        if not target.is_relative_to(source_root / "families/qwen_vl"):
            raise ValueError("Patch target must remain in the isolated qwen_vl family")
        original = target.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        if digest == receipt["afterSha256"]:
            print(f"Already qualified: {receipt['file']}")
            continue
        if digest != receipt["beforeSha256"]:
            raise ValueError(f"Unknown source snapshot; refusing to overwrite {target}")
        patch = (directory / f"{name}.patch").read_text(encoding="utf-8")
        updated = transform(original.decode("utf-8"), patch).encode("utf-8")
        if hashlib.sha256(updated).hexdigest() != receipt["afterSha256"]:
            raise ValueError(f"Patched content hash differs for {target}")
        planned.append((target, updated))
    for target, updated in planned:
        target.write_bytes(updated)
        print(f"Applied qualified patch: {target.relative_to(source_root)}")


if __name__ == "__main__":
    main()
