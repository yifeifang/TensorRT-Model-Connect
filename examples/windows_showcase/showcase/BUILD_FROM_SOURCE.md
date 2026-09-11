# Build the Windows ModelConnect showcase

The source example contains seven independent model operations: speech recognition,
reasoning, embeddings, segmentation, image understanding, image-to-depth geometry,
and realtime voice. It contains the desktop UI, native bridge source, a Windows
process guardian, source patches, acquisition/build scripts, and tests. Model
weights, compiled GPU bundles, proprietary SDKs, DLLs, caches, and local sample
recordings are not part of the source release.

Run these commands from the example root (the directory containing `showcase/`
and `Start Showcase.ps1`). When integrated into ModelConnect this directory is
`examples/windows_showcase/`.

## Preview the desktop shell

```powershell
.\showcase\scripts\install-shell.ps1 -Plan
.\showcase\scripts\install-shell.ps1
.\showcase\scripts\package.ps1
& '.\Start Showcase.ps1'
```

The installer downloads the pinned official Electron Windows archive and verifies
its SHA-256. To install offline, pass `-ArchivePath` with the same official archive.
The package retains Electron's license and Chromium's third-party notices. This
opens the capability gallery without requiring a GPU model installation. Native
capabilities become available when their runtime and local model bundle exist.
No Node production dependency installation is needed.

The supplied photograph works immediately. Record/import your own audio or images
as needed. Optional speech samples can be generated with the user's installed
Windows desktop voice by running `prepare-asr-audio.ps1` and
`prepare-asr-correction-audio.ps1` from `showcase/scripts/`, then packaging with
`-IncludeLocalSamples`. These scripts require the installed Zira desktop voice.
They do not establish redistribution rights for synthesized audio. The reference
indoor photograph is omitted; use **Import image** for an indoor image you can use.

## Install local build prerequisites

Use Windows x64 and an NVIDIA GPU supported by your installed TensorRT-RTX SDK.
The existing seven-capability qualification used Windows, an RTX 5090 with 32 GB
VRAM, CUDA 13.4, TensorRT-RTX 1.6.1.120, MSVC 14.44, and Windows SDK 10.0.26100.0.
This is a tested configuration, not a minimum requirement for every model. Image
understanding's compiled bundle alone is about 9 GB; checkpoint downloads,
compilation workspace, and caches require additional disk space and memory.

Install or obtain the following from their vendors under the relevant terms:

- Python 3.12, Git, and an x64 Visual Studio C++ build environment.
- CUDA Toolkit 13.4 and TensorRT-RTX 1.6.1.120, including native headers/libraries.
- CMake, Ninja, and an installed `nlohmann_json` CMake package (3.11 or later).
- A compatible NVIDIA display driver. The script does not install a driver.

Use an **x64 Developer PowerShell for Visual Studio**. Copy and edit
`showcase/scripts/toolchain.example.json` as
`showcase/scripts/toolchain.local.json`. All paths are explicit; relative paths
resolve relative to the JSON file. Point `PythonExe` to an existing Python 3.12
interpreter initially. `SourceRoot` should remain `../../vendor/ModelConnect`.

```powershell
$config = "$PWD/showcase/scripts/toolchain.local.json"
$caps = @('vision', 'understanding', 'geometry')
.\showcase\scripts\bootstrap.ps1 -Action Source -ToolchainFile $config -Plan
```

Every action supports `-Plan`: it reports the operation without changing files,
the process environment, licenses, or downloads. `-Action Check` performs a
read-only preflight of tool paths and source patch hashes. A missing prerequisite
is reported as an error, rather than appearing as a successful setup.

If using a standalone portable MSVC installation, optional JSON properties
`MsvcRoot`, `WindowsSdkRoot`, `WindowsSdkLibRoot`, and `CrtRoot` configure its
compiler, include, library, and local CRT paths. A normal Developer PowerShell
already supplies the compiler environment. The optional `-DependencyRoot` layout
exists for the original qualification machine; no machine path is hardcoded.

## Acquire the isolated SDK and authoring environment

```powershell
.\showcase\scripts\bootstrap.ps1 -Action Source -ToolchainFile $config
.\showcase\scripts\bootstrap.ps1 -Action Python -Capabilities $caps -ToolchainFile $config -AcknowledgeDependencyTerms
```

The source action fetches the exact qualified SDK commit
`7458623963a038fa1ae1f1bac28eee6a5c792514` from
`https://github.com/yifeif-nv/TensorRT-Model-Connect-fork.git` into this example's
`vendor/ModelConnect/`. It applies a complete, reviewable 20-file delta recorded in
`scripts/source-patches/manifest.json`, including the core loader/bundle/backend,
model-family portability, and numerical fixes used in local qualification. Every
target must match its normalized before/after SHA-256; all targets are checked
before writing. Unknown source is rejected. Patches cannot modify a checkout
outside this example's `vendor/` directory. The parent repository is untouched.

The voice bridge was added after that SDK commit, so its source is included in
`showcase/voice-native/`; its build does not assume an untracked voice example
exists in the downloaded SDK.

The Python action creates `.venv/`, installs the pinned CPU PyTorch wheels and
the direct requirements in `scripts/requirements-build.txt`, then creates the
selected ASR/understanding package overlays. TensorRT-RTX and CUDA Python packages
have their own license terms. Review these and the other dependency licenses
before supplying `-AcknowledgeDependencyTerms`. Nothing is installed globally.

Afterward, update `PythonExe` in the JSON configuration to the absolute path of
`.venv/Scripts/python.exe`, then run:

```powershell
.\showcase\scripts\bootstrap.ps1 -Action Check -ToolchainFile $config
```

## Select and install model capabilities

Select only the capabilities you want. Valid IDs are `text`, `asr`, `embedding`,
`vision`, `understanding`, `geometry`, and `voice`. Speech transcription followed
by refinement needs both `asr` and `text`. Voice is optional and is not selected
by default.

```powershell
.\showcase\scripts\bootstrap.ps1 -Action Download -Capabilities $caps -ToolchainFile $config -Plan
# Read the printed terms and showcase/distribution/MODEL_LICENSE_AUDIT.md first.
.\showcase\scripts\bootstrap.ps1 -Action Download -Capabilities $caps -ToolchainFile $config -AcknowledgeModelTerms
.\showcase\scripts\bootstrap.ps1 -Action Native -Capabilities $caps -ToolchainFile $config
.\showcase\scripts\bootstrap.ps1 -Action Models -Capabilities $caps -ToolchainFile $config
& '.\Start Showcase.ps1'
```

The download action uses exact model revisions. Before acquiring weights it saves
the pinned model cards, available license/notice files, and additional reviewed
agreements under `models/licenses/`, including URL/date/SHA-256 receipts. Whisper
retains both the converted checkpoint's Apache declaration and the original MIT
notice. Voice includes separate OpenMDW-1.1 weights and NVIDIA Open Model License
tokenizer terms, including the incorporated Trustworthy AI agreement. The
acknowledgment records the installer's intent to proceed after reviewing terms;
it is not a redistribution grant or an automated acceptance of another website's
terms. Authentication or gated access, if introduced upstream, must be handled
by the user through that service.

The native action builds the process guardian and selected bridges, then stages
their locally installed runtime dependencies under `runtime-*/`. These directories
are marked `LOCAL-ONLY.txt`. The models action compiles selected bundles on your
GPU under `models/`. It runs sequentially; close the showcase's running model
before starting to avoid GPU contention. Realtime voice builds its bundle locally
at `models/nemotron-voicechat-rtx.bundle`; it does not require an adjacent shared
model directory or a copied private runtime.

## Verify and distribute

The source checks require Node 22 or later and Python; they do not require model
weights or GPU access:

```powershell
node --test showcase/tests/*.test.cjs
python showcase/scripts/test-bootstrap.py
node --test showcase/distribution/source-release.test.cjs
node showcase/distribution/source-release.cjs
```

Desktop integration tests use Playwright and the actual compiled models. Run them
only after building the corresponding capabilities; missing models must not be
reported as a passed native qualification. See `showcase/distribution/REVIEW_VALIDATION.md`
for the exact source-installation checks and remaining qualification gaps.

The portable installer has been checked with all seven read-only plans, PowerShell
syntax validation, an exact fresh SDK checkout comparison, patch application/hash
verification, acquisition of all eight model/license notice sets, and a clean
process-guardian build, and a clean voice bridge build with protocol and startup
tests. The local seven-model desktop
application was previously qualified, but **a fresh machine download, Python
dependency resolution, all seven GPU rebuilds, and the new voice bundle recipe have
not been rerun end to end**. Direct Python dependencies are pinned; transitive
dependencies are not a complete hash-locked environment. Keep the PR in draft
until the fresh Windows/GPU qualification is completed. A successful preflight
does not establish numerical equivalence on another GPU or SDK version.

Use the source-release exporter and review its explicit allowlist. The PR/source
artifact excludes `vendor/`, `.venv/`, `dependencies/`, `models/`, `runtime-*/`,
`dist/`, caches, generated recordings, and unapproved photographs. Do not upload a
developer's populated example folder or `dist/` as the source distribution.
Publishing a compiled binary image requires a separate review of every included
runtime component and each model's conditions.

Docker does not remove redistribution obligations. A Linux container also does
not reproduce this Windows desktop, native microphone stack, and Windows GPU
toolchain. The supported setup here is the local Windows script; no unqualified
container image is advertised as a working alternative.
