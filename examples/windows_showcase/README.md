# ModelConnect capability showcase for Windows

A Windows desktop example with seven independent demonstrations of local model inference. Each page isolates a reusable model capability so a developer can see what ModelConnect could contribute to their own application.

| Demonstration | Input and visible result |
| --- | --- |
| Speech Recognition | Recorded or imported speech becomes a transcript; an independent thinking model can refine it. |
| Reasoning | Compare direct and thinking-enabled generation with output and timing side by side. |
| Semantic Search | Inspect real embedding dimensions, cosine rankings and a similarity matrix. |
| Image Segmentation | Click a point in a photograph and inspect or export the predicted mask and cutout. |
| Image Understanding | Ask a question about a photograph and inspect the generated answer. |
| Image to Depth | Inspect predicted depth and rotate a point cloud made from the model's XYZ output. |
| Realtime Voice | Use a microphone for live speech input and model-generated speech output. |

The interface is English and uses capability names. Technical model identities and required license notices remain available in source and legal records. Inference requires locally installed model bundles and native runtimes. A source checkout can display the interface before models are installed; it does not substitute canned inference results.

Follow [BUILD_FROM_SOURCE.md](BUILD_FROM_SOURCE.md) to install the Windows toolchain, select model capabilities, build native bridges and model bundles, and launch the application. Models are compiled on the user's own supported NVIDIA GPU. The source example does not promise that a bundle compiled on another GPU or SDK version will work unchanged.

This is a source distribution. It includes application and bridge source, build scripts, tests, license records, and one expressly licensed vehicle photograph. It excludes model weights, compiled engines, SDKs, runtimes, generated audio, other photographs, caches and machine-specific qualification logs. Install dependencies from their official publishers under their own terms. Import media you have rights to use, or explicitly generate optional local speech samples.

See the [component audit](showcase/distribution/COMPONENT_LICENSE_AUDIT.md) and [model audit](showcase/distribution/MODEL_LICENSE_AUDIT.md) for the distribution decisions. These records do not grant additional rights to third-party components. A Dockerfile or download script does not remove their terms, and a locally assembled application is not automatically a cleared redistributable release.

`SOURCE_MANIFEST.json`, produced by the source export tool, records every exported file's SHA-256. The release uses the repository's [Apache-2.0 license](LICENSE) and preserves [third-party notices](NOTICE).
