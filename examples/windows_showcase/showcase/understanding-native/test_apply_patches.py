"""CPU-only regression for hash-pinned, transactional source patching."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

from apply_patches import transform

HERE = Path(__file__).resolve().parent
PATCHES = [
    ("qwen-vl-normalization", "normalization-patch", "qualified-model.py.txt"),
    ("qwen-vl-result-text", "result-text-patch", "qualified-pipeline.cpp.txt"),
]


def reverse_patch(patch):
    lines = patch.splitlines(keepends=True)
    result = [lines[1], lines[0]]
    for line in lines[2:]:
        if line.startswith("@@"):
            line = re.sub(r"@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@", r"@@ -\2 +\1 @@", line)
        elif line.startswith("+"):
            line = "-" + line[1:]
        elif line.startswith("-"):
            line = "+" + line[1:]
        result.append(line)
    return "".join(result)


class PatchTests(unittest.TestCase):
    def fixture(self, directory):
        targets = []
        for name, receipt_name, fixture_name in PATCHES:
            receipt = json.loads((HERE / f"{receipt_name}.json").read_text(encoding="utf-8-sig"))
            qualified = (HERE / "fixtures" / fixture_name).read_bytes()
            self.assertEqual(hashlib.sha256(qualified).hexdigest(), receipt["afterSha256"])
            original = transform(qualified.decode("utf-8"), reverse_patch((HERE / f"{name}.patch").read_text(encoding="utf-8"))).encode("utf-8")
            self.assertEqual(hashlib.sha256(original).hexdigest(), receipt["beforeSha256"])
            target = Path(directory) / "vendor/ModelConnect" / receipt["file"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(original)
            targets.append((target, original, receipt))
        return targets

    def apply(self, directory):
        return subprocess.run([sys.executable, str(HERE / "apply_patches.py"), "--workspace", directory], capture_output=True, text=True)

    def test_pinned_snapshot_and_idempotence(self):
        with tempfile.TemporaryDirectory(prefix="understanding-patches-") as directory:
            targets = self.fixture(directory)
            self.assertEqual(self.apply(directory).returncode, 0)
            for target, _, receipt in targets:
                self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), receipt["afterSha256"])
            self.assertEqual(self.apply(directory).returncode, 0)

    def test_unknown_second_source_does_not_modify_first(self):
        with tempfile.TemporaryDirectory(prefix="understanding-patches-") as directory:
            targets = self.fixture(directory)
            targets[1][0].write_bytes(b"unknown source snapshot\n")
            result = self.apply(directory)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Unknown source snapshot", result.stderr)
            self.assertEqual(targets[0][0].read_bytes(), targets[0][1])
            self.assertEqual(targets[1][0].read_bytes(), b"unknown source snapshot\n")


if __name__ == "__main__":
    unittest.main()
