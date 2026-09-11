# Geometry bridge protocol, version 1

The bridge exposes the real `IMonocularGeometry` task through NDJSON on standard input/output. Runtime diagnostics go to standard error. The desktop uses its existing process guardian; stopping the bridge releases its GPU state.

Launch from the isolated worktree:

```powershell
.\runtime-geometry\trtmc_geometry_bridge.exe --bundle .\models\geometry-moge-2-vitl-rtx.bundle --runtime-root .\runtime-geometry --runtime-cache .\models\geometry-moge-2-vitl.rtx.cache
```

Standard input must be a pipe. The production desktop resolves all paths to absolute paths.

After `loading`, the bridge emits `ready` with `protocolVersion: 1`, `family: "moge"`, `backend: "trt_rtx"`, `model`, `revision`, `loadTimeMs`, `minImageSize: 64`, `maxImageSize: 512`, `minAspectRatio: 0.5`, `maxAspectRatio: 2.0`, and `inputRange: [0, 1]`. Model identities are retained as technical evidence; public UI labels should remain generic.

## Requests

```json
{"id":"image-1","type":"geometry","imagePath":"D:/absolute/path/input.ppm"}
```

`imagePath` must be an absolute path to a binary RGB P6 PPM with max value 255. Each side must be 64-512 pixels, and width/height must lie between 0.5 and 2.0. The bridge rejects truncated or oversized payloads, invalid dimensions, and extra pixel bytes. It converts input bytes to finite HWC float samples in `[0, 1]` for the native task.

The desktop may decode and resize an uploaded image before writing this PPM. Output dimensions always match the supplied PPM. The bridge does not resize or crop it silently.

`{"id":"ping-1","type":"ping"}` returns `pong`. `{"type":"stop"}` stops the loop and emits `stopped`. EOF closes the process. An individual invalid request returns `{type:"error",id,message,fatal:false}`; startup failures return a fatal error and exit.

## Results

A successful result includes `type: "result"`, the same `id`, `width`, `height`, `family`, `backend`, `model`, `task: "monocular_geometry"`, `elapsedMs`, and `totalMs`. `elapsedMs` is the real model-task call; `totalMs` also includes input reading, validation, and output encoding before JSON serialization.

| Field | Encoding and shape |
| --- | --- |
| `depthBase64` | Exactly `width * height * 4` bytes of row-major IEEE-754 little-endian float32 depth |
| `pointsBase64` | Exactly `width * height * 3 * 4` bytes of row-major little-endian float32 XYZ points |
| `maskBase64` | Exactly `width * height` bytes, each 0 for invalid or 1 for valid |
| `depthEncoding` | `float32le` |
| `pointsEncoding` | `float32le-xyz` |
| `maskEncoding` | `u8-validity` |
| `intrinsics` | Nine finite numbers forming a row-major 3x3 camera matrix |
| `intrinsicsConvention` | `normalized-image-coordinates`: principal point is `(0.5, 0.5)`, focal values use normalized image coordinates |
| `invalidValue` | `+Infinity`; invalid raw depth and XYZ values retain this exact model convention |
| `validPixelCount` | Count of mask values equal to 1 |
| `depthMin`, `depthMax` | Minimum and maximum actual valid predicted depth |

Only validity-mask-selected points belong in a point-cloud preview or PLY export. Invalid float values are preserved through binary encoding rather than converted to null or fabricated zero-depth points. For every valid pixel, depth is finite and positive, XYZ is finite, and point Z equals depth. The bridge validates those invariants before reporting success.

Depth is the model's prediction. Its metric scale is inferred from the image; it is not a calibrated physical measurement. A depth color map and a point-cloud viewport are visualizations of these actual outputs, not additional learned outputs.

At the 512x512 limit, the raw geometry uses 4,456,448 bytes; base64 plus small metadata stays below 6 MB and the desktop's 12 MiB protocol limit. The tested car and interior images produce approximately 3.55 MB and 3.96 MB of JSON, respectively.
