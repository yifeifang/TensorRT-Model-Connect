'use strict';
function parseThinking(text,enabled,reachedTokenLimit=false){
  const end=text.indexOf('</think>');
  if(end>=0)return{reasoning:text.slice(0,end).replace(/^\s*<think>\s*/,'' ).trim(),answer:text.slice(end+8).trim(),complete:!!text.slice(end+8).trim()&&!reachedTokenLimit};
  if(enabled)return{reasoning:text.replace(/^\s*<think>\s*/,'' ).trim(),answer:'',complete:false};
  return{reasoning:'',answer:text.trim(),complete:!reachedTokenLimit};
}
function cosine(a,b){if(a.length!==b.length||!a.length)throw new Error('Inconsistent embedding dimensions.');let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw new Error('Invalid embedding value.');dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}if(!aa||!bb)throw new Error('The model returned a zero vector.');return Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb)));}
function pcmWave(samples){
  if(!Array.isArray(samples)||samples.length<1600||samples.length>480000||samples.some(v=>!Number.isFinite(v)||Math.abs(v)>1))throw new Error('Audio must contain 0.1–30 seconds of 16 kHz mono PCM.');
  const b=Buffer.alloc(44+samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);samples.forEach((v,i)=>b.writeInt16LE(Math.round(v*(v<0?32768:32767)),44+i*2));return b;
}
module.exports={parseThinking,cosine,pcmWave};
