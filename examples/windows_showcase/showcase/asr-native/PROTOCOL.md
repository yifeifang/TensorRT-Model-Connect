# Independent Whisper ASR bridge

The executable loads ModelConnect's `ITranscription` task from the separate Whisper bundle. It uses the model's audio encoder and autoregressive transcription decoder. It never calls the text LLM.

Launch with absolute paths:

```text
runtime-asr/trtmc_asr_bridge.exe --bundle models/whisper-small-rtx.bundle --runtime-root runtime-asr --runtime-cache models/whisper-small.rtx.cache
```

UTF-8 NDJSON travels over stdin/stdout; diagnostics use stderr. Wait for `ready` with `family: "whisper"`, `backend: "trt_rtx"`, and `protocolVersion: 1` before submitting audio. The process holds one persistent ASR task and handles requests sequentially.

```json
{"id":"recording-1","type":"transcribe","wavPath":"D:/absolute/path/recording.wav","language":"zh","maxTokens":224}
```

The bridge accepts only existing absolute WAV paths. The file must be RIFF WAV, signed PCM16 little-endian, 16000 Hz, one channel, and 0.1–30 seconds. WAV chunk sizes and format fields are validated; malformed, silent, oversized and incompatible files return request errors. The application owns the file and should remove a private temporary recording after inference. `language` is required and must be `zh` or `en`. `maxTokens` is optional, defaults to 224, and supports 1–224.

A result contains the unmodified model `text`, `segments`, output `tokens`, `language`, `audioSeconds`, `truncated`, and actual timings. `setupMs` measures feature extraction, `prefillMs` measures encoder and cross-attention setup, `decodeMs` measures the transcription decoder, and `totalMs` measures the entire ModelConnect call. `realTimeFactor` is inference time divided by audio duration; values below one mean faster than the input duration. The current family does not emit timestamp segments, so `segments` is an empty array and `ready.timestamps` is false. No artificial timestamps are generated.

Errors contain `type: "error"`, `message`, `fatal`, and the request `id` when available. Request errors are recoverable; startup errors are fatal. `truncated: true` means the token limit was reached before the checkpoint's end token, so the application should show an incomplete-transcription notice.

`{"type":"ping","id":"health"}` returns `pong`. `{"type":"stop"}` returns `stopped` and exits after the current synchronous request. The host may terminate its dedicated guarded child for immediate cancellation. Closing stdin ends the request loop. Use the application's process guardian so cancellation or application exit also reclaims GPU resources.
