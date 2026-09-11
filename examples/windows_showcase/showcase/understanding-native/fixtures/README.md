# Frozen source inputs for patch regression tests

These two text fixtures preserve the qualified source bytes for
`families/qwen_vl/model.py` and `families/qwen_vl/runtime/pipeline.cpp`.
They derive from ModelConnect revision
`7458623963a038fa1ae1f1bac28eee6a5c792514`, with the adjacent
`qwen-vl-normalization.patch` and `qwen-vl-result-text.patch` changes applied.
The source retains its Apache-2.0 copyright and SPDX notices; the root
`LICENSE` supplies the full license. These are modified source snapshots,
not unmodified upstream files.

The tests verify each fixture's exact `afterSha256`, reverse the actual patch,
verify the original `beforeSha256`, and exercise patch application,
idempotence and rejection of an unknown source without partial modification.
The adjacent JSON receipts pin both versions. This allows the source-only
test suite to run before downloading the SDK. These files are test inputs;
do not format or execute them.
