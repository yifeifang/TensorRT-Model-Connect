# The BERT family accepts variable text lengths, but its compiled engine uses
# static 512-token buffers. Upload every mask element on every call so a shorter
# input cannot attend to tokens left by an earlier, longer input. Preserve the
# upstream implementation except for this input preparation correction.
file(READ "${TRTMC_SOURCE_DIR}/families/bert/runtime/pipeline.cpp" _pipeline_source)
set(_original_input_preparation [=[    const auto n = input_ids.size();
    std::vector<int32_t> mask_i32(n, 1);
    std::vector<float> mask_f32(n, 1.0f);

    auto ids_copy = input_ids;]=])
set(_padded_input_preparation [=[    const auto actual_count = input_ids.size();
    auto n = actual_count;
    if (!encoder_->input_is_dynamic("input_ids")) {
        const auto shape = encoder_->tensor_shape("input_ids");
        if (shape.size() != 1 || shape.front() <= 0)
            throw std::runtime_error("BERT expects a one-dimensional static token input");
        n = static_cast<std::size_t>(shape.front());
        if (actual_count > n)
            throw std::invalid_argument("BERT input exceeds the static engine sequence length");
    }
    // Full static uploads prevent stale attention-mask tails across calls.
    std::vector<int32_t> mask_i32(n, 0);
    std::vector<float> mask_f32(n, 0.0f);
    std::vector<int32_t> ids_copy(n, 0);
    for (std::size_t index = 0; index < actual_count; ++index) {
        ids_copy[index] = input_ids[index];
        mask_i32[index] = 1;
        mask_f32[index] = 1.0f;
    }]=])
string(FIND "${_pipeline_source}" "${_original_input_preparation}" _input_preparation_offset)
if(_input_preparation_offset LESS 0)
  message(FATAL_ERROR "Upstream BERT input preparation changed; review the static-padding adaptation")
endif()
string(REPLACE "${_original_input_preparation}" "${_padded_input_preparation}" _pipeline_source "${_pipeline_source}")
set(_padded_pipeline "${CMAKE_CURRENT_BINARY_DIR}/bert_pipeline_padded.cpp")
file(WRITE "${_padded_pipeline}" "${_pipeline_source}")

# The current family intentionally skips the tokenizer's full precompiled NFKC
# map. Normalize compatibility characters (including Chinese full-width
# punctuation) before retaining its whitespace/control handling.
file(READ "${TRTMC_SOURCE_DIR}/families/bert/runtime/unigram_tokenizer.cpp" _tokenizer_source)
set(_normalizer_signature "std::string precompiled_normalize(const std::string& text) {")
string(FIND "${_tokenizer_source}" "${_normalizer_signature}" _normalizer_offset)
if(_normalizer_offset LESS 0)
  message(FATAL_ERROR "Upstream Unigram normalization changed; review the Windows NFKC adaptation")
endif()
string(REPLACE "${_normalizer_signature}"
  "std::string precompiled_normalize(const std::string& input) {\n    const std::string text = windows_nfkc_normalize(input);"
  _tokenizer_source "${_tokenizer_source}")
set(_normalized_tokenizer "${CMAKE_CURRENT_BINARY_DIR}/bert_unigram_normalized.cpp")
file(WRITE "${_normalized_tokenizer}" "#include \"unicode_normalize.h\"\n${_tokenizer_source}")
