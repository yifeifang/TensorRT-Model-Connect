"""Device-free tests for the source installer boundary; no network or GPU work."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "showcase/scripts"
spec = importlib.util.spec_from_file_location("prepare_source", SCRIPTS / "prepare-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class BootstrapTests(unittest.TestCase):
    def test_patch_context_rejects_unknown_source(self):
        patch = "--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma\n"
        self.assertEqual(source.transform("alpha\nbeta\n", patch), "alpha\ngamma\n")
        with self.assertRaises(ValueError):
            source.transform("alpha\nunknown\n", patch)

    def test_write_boundary_rejects_external_checkout_before_reading(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp) / "example"
            with self.assertRaisesRegex(ValueError, "private SDK checkout"):
                source.prepare(Path(temp) / "upstream", workspace)

    def test_source_manifest_is_pinned_and_paths_are_relative(self):
        manifest = json.loads((SCRIPTS / "source-patches/manifest.json").read_text())
        self.assertRegex(manifest["revision"], r"^[0-9a-f]{40}$")
        self.assertEqual(len(manifest["files"]), len({item["path"] for item in manifest["files"]}))
        for item in manifest["files"]:
            self.assertNotIn("..", Path(item["path"]).parts)
            self.assertFalse(Path(item["path"]).is_absolute())
            self.assertRegex(item["beforeSha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(item["afterSha256"], r"^[0-9a-f]{64}$")
            self.assertTrue((SCRIPTS / "source-patches" / item["patch"]).is_file())

    def test_every_action_plan_is_read_only_without_dependencies(self):
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if not shell:
            self.skipTest("PowerShell is required for Windows installer plan tests")
        for action in ("Check", "Source", "Python", "Download", "Native", "Models", "Shell"):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as temp:
                before = set(Path(temp).iterdir())
                # Real scripts and inventory are read, while outputs would go to a fresh workspace.
                result = subprocess.run([shell, "-NoProfile", "-File", str(SCRIPTS / "bootstrap.ps1"), "-Action", action,
                                         "-Plan"], cwd=temp, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Plan only:", result.stdout)
                self.assertEqual(set(Path(temp).iterdir()), before)


if __name__ == "__main__":
    unittest.main()
