'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {presentationError}=require('../presentation-error');
test('native model names, paths and non-English diagnostics stay out of presentation errors',()=>{
  for(const raw of ['Whisper decoder initialization failed','Qwen3-4B failed','SAM inference failed','TensorRT-RTX load error',String.fromCodePoint(0x9519,0x8bef),'Cannot open D:\\models\\private.bundle']){
    const message=presentationError(new Error(raw));assert.match(message,/local model/);assert(!/Whisper|Qwen|SAM|TensorRT|[a-z]:[\\/]|\p{Script=Han}/iu.test(message));
  }
});
test('actionable context and memory errors stay useful in English',()=>{
  assert.match(presentationError('Qwen token count exceeds context limit'),/Shorten it/);
  assert.match(presentationError('CUDA out of memory'),/available GPU memory/);
  assert.equal(presentationError('Record at least 0.1 seconds of audio.'),'Record at least 0.1 seconds of audio.');
});
