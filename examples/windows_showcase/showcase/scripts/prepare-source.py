"""Verify or apply the complete qualified SDK delta to the pinned isolated checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def transform(text, patch):
    lines = text.splitlines(keepends=True)
    pieces, cursor = [], 0
    parts = patch.splitlines(keepends=True)
    index = 2
    while index < len(parts):
        header = re.fullmatch(r"@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@.*\n?", parts[index])
        if not header:
            raise ValueError("Invalid patch header")
        start = int(header.group(1)) - 1
        pieces.extend(lines[cursor:start])
        cursor, index = start, index + 1
        while index < len(parts) and not parts[index].startswith("@@"):
            action, line = parts[index][0], parts[index][1:]
            if action in " -":
                if cursor >= len(lines) or lines[cursor] != line:
                    raise ValueError("Source patch context mismatch")
                cursor += 1
            if action in " +":
                pieces.append(line)
            if action not in " +-":
                raise ValueError("Unsupported patch line")
            index += 1
    return "".join(pieces + lines[cursor:])


def prepare(source, workspace, check=False):
    directory = Path(__file__).resolve().parent / "source-patches"
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    source = source.resolve()
    if not check and not source.is_relative_to((workspace / "vendor").resolve()):
        raise ValueError("Patches may only modify a private SDK checkout inside this example's vendor directory")
    planned = []
    for item in manifest["files"]:
        target = (source / item["path"]).resolve()
        if not target.is_relative_to(source):
            raise ValueError("Source patch path escapes the checkout")
        text = target.read_text(encoding="utf-8")
        actual = digest(text)
        if actual == item["afterSha256"]:
            continue
        if check:
            raise ValueError(f"SDK source is not qualified: {item['path']}. Run bootstrap.ps1 -Action Source first.")
        if actual != item["beforeSha256"]:
            raise ValueError(f"Unknown SDK source; no files changed: {item['path']}")
        updated = transform(text, (directory / item["patch"]).read_text(encoding="utf-8"))
        if digest(updated) != item["afterSha256"]:
            raise ValueError(f"Patch digest mismatch: {item['path']}")
        planned.append((target, updated))
    # Validate every target before modifying any file.
    for target, updated in planned:
        target.write_text(updated, encoding="utf-8", newline="\n")
    return {"passed": True, "baseRevision": manifest["revision"], "verifiedFiles": len(manifest["files"]), "patchedFiles": len(planned)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--source", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.source or args.workspace / "vendor/ModelConnect", args.workspace, args.check)))
