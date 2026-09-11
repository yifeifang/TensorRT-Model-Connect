# Source installation review: 2026-09-11

This contribution publishes source and installation recipes. The configured-machine
application previously ran all seven real model pipelines; that historical
qualification is not a fresh-machine build result.

## Checks performed

Commands run from the example root unless noted otherwise.

| Check | Result |
| --- | --- |
| `node --test showcase/tests/*.test.cjs` | 69 passed, including sample visibility without installed assets and existing lifecycle/data/UI contracts. |
| `node --test showcase/distribution/source-release.test.cjs` | 4 passed; explicit file selection, traversal/credential rejection, licensed-photo digest enforcement and normalized text hashes. |
| `python showcase/scripts/test-bootstrap.py` | 4 passed, covering all seven read-only plans, patch context, pinned paths and write boundaries. |
| `python showcase/understanding-native/test_apply_patches.py` | 2 passed. |
| Ruff with the parent configuration | All 25 selected Python files passed. |
| clang-format with the parent configuration | All 24 selected C++/header files passed. |
| PowerShell parser | All selected scripts parsed. |
| `install-shell.ps1 -ArchivePath <official archive>` | Fresh installation of Electron 44.3.0 verified the pinned official SHA-256 and preserved notices. |
| `package.ps1`, then `node showcase/tests/desktop-english.cjs` | Fresh source export with no model bundles passed seven pages, dialogs, runtime inventory, presentation mode and minimum-window layout. |
| `bootstrap.ps1 -Action Source -DependencyRoot <installed tools>` | Actual pinned SDK fetch, detached checkout and all 20 patches passed in a fresh example directory. |
| `build-process-host.ps1 -DependencyRoot <installed tools>` | Process guardian configured, compiled and installed in a new build directory. |
| `build-voice-native.ps1 -DependencyRoot <installed tools>` | Tracked voice bridge configured, compiled and installed against the fresh patched SDK. |
| `ctest --test-dir showcase/build-voice-isolated --output-on-failure` | Voice audio protocol: 1/1 passed. |
| `python -m pytest -q showcase/voice-native/test_native_startup.py`, with the new bridge and SDK configured | 4 passed without model allocation. |
| `acquire-model-licenses.py --models text asr embedding vision understanding geometry voice --acknowledge-model-terms` | Official pinned metadata and full legal documents acquired for eight assets, including the voice tokenizer; no weights downloaded. |
| Direct dependency availability | All 12 pins exist on official PyPI; both specified CPU PyTorch/TorchVision Windows Python 3.12 wheels exist. This was metadata verification, not installation. |

The review host used Windows x64, Node 24.19.0, Python 3.12, MSVC 19.44,
CUDA 13.4 and TensorRT-RTX 1.6.1.120. Compilation reused installed licensed
toolchains; it did not redistribute them. The SDK source pin is
`7458623963a038fa1ae1f1bac28eee6a5c792514` from the public repository recorded in
`showcase/scripts/source-patches/manifest.json`. Every patch's before/after
digest was independently checked against that commit.

## Distribution boundary and remaining qualification

The source exporter records final LF-normalized text and exact photo bytes in
`SOURCE_MANIFEST.json`. Checkpoints, bundles, downloaded source, DLLs, caches,
local configurations, generated recordings, uncertain-photo assets and historical
machine logs are excluded. The one included photograph has an explicit grant
and a pinned digest. Model and component audits explain the applicable terms.

A complete installation of the new Python environment, all model downloads,
all seven GPU bundle rebuilds and live inference on those rebuilt bundles were
not performed in this source-review pass. The new voice bridge compiles and
passes host tests; its bundle recipe has not been qualified end to end. Other
GPUs, operating systems and containers were not qualified. Direct Python
dependencies are pinned; transitive resolutions are not fully hash-locked.

Keep the PR in draft until fresh Windows/GPU qualification is completed. Read
remote CI for the submitted head; these local results do not claim a passing
repository premerge gate. The contribution adds this self-contained example
and its focused workflow. Its explicitly pinned SDK is installed separately;
the parent repository's runtime is not replaced.
