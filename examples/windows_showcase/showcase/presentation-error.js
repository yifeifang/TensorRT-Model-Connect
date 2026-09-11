'use strict';
// Keep low-level diagnostics in the developer log, outside the presentation UI.
function presentationError(error){
  const message=String(error?.message||error||'The operation could not be completed.');
  if(/(?:token|context|sequence).*(?:exceed|too long|capacity|limit)/i.test(message))return 'This input exceeds the model context limit. Shorten it and try again.';
  if(/out of memory|insufficient.*memory|memory allocation.*fail/i.test(message))return 'There is not enough available GPU memory. End the current session and try again.';
  if(/\p{Script=Han}|\b(?:Whisper|Qwen\w*|E5|SAM|MoGe|Nemotron|TensorRT|NVIDIA|CUDA|Wispr|Clipto|Dograh|Hugging\s*Face)\b|[a-z]:[\\/]|https?:\/\//iu.test(message)||message.length>400)return 'The local model could not complete this operation. Cancel the session and try again. Technical details are saved in the local diagnostics log.';
  return message;
}
module.exports={presentationError};
