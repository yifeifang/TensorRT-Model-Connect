"""Apply only the tracked geometry precision patch, once, before bundling."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATCH = Path(__file__).resolve().with_name("moge-rtx-fp32-attention.patch")
COMMAND = ["git", "apply", "--directory=vendor/ModelConnect"]


def invoke(arguments):
    return subprocess.run(COMMAND + arguments + [str(PATCH)], cwd=ROOT, capture_output=True, text=True)


if invoke(["--reverse", "--check"]).returncode == 0:
    print("Geometry FP32 attention precision patch is already applied.")
else:
    checked = invoke(["--check"])
    if checked.returncode:
        raise SystemExit("The geometry precision patch does not match the isolated source; inspect before rebuilding.\n" + checked.stderr)
    applied = invoke([])
    if applied.returncode:
        raise SystemExit("Could not apply the geometry precision patch.\n" + applied.stderr)
    print("Applied the tracked MoGe-only FP32 attention precision patch.")
