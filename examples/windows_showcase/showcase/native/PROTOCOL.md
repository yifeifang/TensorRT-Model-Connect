# ModelConnect text bridge

Launch `runtime-text/trtmc_text_bridge.exe --bundle models/qwen3-4b-rtx.bundle --runtime-root runtime-text --runtime-cache models/qwen3-4b.rtx.cache`, using absolute paths. The capability demos use hybrid Qwen3-4B, which supports the actual thinking-mode switch. The cache stores TensorRT-RTX runtime specialization. `--help` never loads a model. Earlier Qwen bundles remain usable by explicitly selecting their distinct filenames and caches.

The bridge accepts UTF-8 newline-delimited JSON on stdin and emits the same on stdout. Native/vendor diagnostics use stderr. Wait for `ready` before generating. One persistent process owns one ModelConnect `ITextGeneration` task. Requests run sequentially; output is delivered when actual inference finishes.

```json
{"id":"reason-1","type":"generate","prompt":"Solve this constraint problem…","maxTokens":1536,"enableThinking":true}
```

`prompt` must contain 1–20000 UTF-8 bytes; `maxTokens` is 1–2048 (default 700). The Qwen runtime checks the real tokenized prompt plus requested output against the compiled 4096-token capacity and rejects overflow. It never silently truncates. `id` may be a string or integer. `enableThinking` is a Boolean, default false; the bridge passes it to the ModelConnect generation configuration and the checkpoint's actual chat template. Thinking mode uses temperature 0.6, top-p 0.95, top-k 20; direct mode uses 0.7, 0.8, 20. Both use seed 0 and a neutral repetition penalty. Application instructions belong in `prompt`.

Responses are `loading`, `ready` (with `backend`, `family`, `protocolVersion`, `loadTimeMs`), `result` (with `id`, `text`, `tokens`, `setupMs`, `prefillMs`, `decodeMs`, `totalMs`, `tokensPerSecond`, `backend`, `family`, `enableThinking`, `reachedTokenLimit`), or `error` (with `message`, `fatal`, and request `id` when available). All timing values come from the native runtime and wall clock. `tokensPerSecond` measures output token count divided by decode time. Raw `text` retains the model's actual thinking delimiter. The UI separates this output from the final answer; a missing closing delimiter is displayed as incomplete, never as a fabricated final answer.

`{"type":"ping","id":"health"}` returns `pong`. `{"type":"stop"}` exits cleanly once any running generation returns. For immediate cancellation or shutdown during GPU work, the parent may terminate this dedicated child process after a bounded grace period. Closing stdin ends the request loop.

Run `node showcase/tests/verify-thinking.cjs` from the worktree for actual-model mode verification, or `node showcase/tests/desktop-capabilities.cjs` for the packaged UI and ASR-to-thinking chain. Results are written under the isolated worktree's `logs` directory. Earlier Python text/catalog verification scripts are available in v1 Git history.
