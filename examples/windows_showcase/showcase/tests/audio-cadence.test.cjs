'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const renderer=path.resolve(__dirname,'../renderer');

// Execute the production worklet and ShowcaseAudio together. WebAudio device,
// filter and connection objects are replaced; PCM framing and resampling are not.
// This checks media-time packet cadence, not operating-system scheduling jitter.
async function capture(){
  let Processor,consumed=0;
  const messages=[],packets=[],errors=[],loaded=[];
  const track={readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const connection=()=>({connect(target){return target;},disconnect(){}});
  class Context{
    constructor({sampleRate}){this.sampleRate=sampleRate;this.state='suspended';this.destination={};this.audioWorklet={addModule:async file=>loaded.push(file)};}
    async resume(){this.state='running';}
    async close(){this.state='closed';}
    createMediaStreamSource(){return connection();}
    createBiquadFilter(){return{...connection(),frequency:{},Q:{}};}
  }
  class ProcessorBase{constructor(){this.port={};}}
  class WorkletNode{
    constructor(_context,name){
      assert.equal(name,'voice-capture');this.port={onmessage:null};this.processor=new Processor();
      this.processor.port.postMessage=(data,transfer)=>{
        const cloned=structuredClone(data,{transfer});messages.push({at:consumed,samples:cloned.length});
        this.port.onmessage?.({data:cloned});
      };
    }
    connect(target){return target;}
    disconnect(){}
  }
  const context=vm.createContext({window:{},navigator:{mediaDevices:{getUserMedia:async()=>stream}},AudioContext:Context,AudioWorkletNode:WorkletNode,
    AudioWorkletProcessor:ProcessorBase,sampleRate:48000,registerProcessor:(name,constructor)=>{assert.equal(name,'voice-capture');Processor=constructor;}});
  vm.runInContext(fs.readFileSync(path.join(renderer,'capture-worklet.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(renderer,'audio.js'),'utf8'),context);
  const audio=new context.window.ShowcaseAudio({sendAudio:packet=>packets.push({at:consumed,sampleRate:packet.sampleRate,samples:Array.from(packet.samples)})},{onError:error=>errors.push(error)});
  await audio.start();const node=audio.node;
  assert.deepEqual(loaded,['capture-worklet.js']);
  function feed(samples){
    for(let index=0;index<samples.length;index+=128){
      const input=samples.slice(index,index+128),output=new Float32Array(input.length).fill(1);consumed+=input.length;
      assert.equal(node.processor.process([[input]],[[output]]),true);
      assert(output.every(value=>value===0),'The capture worklet must never play microphone input into the speakers');
    }
  }
  return{audio,node,feed,messages,packets,errors,track};
}

test('actual capture sends ordered 20 ms packets without sample loss or inserted silent frames',async()=>{
  const c=await capture();
  try{
    c.audio.setReady(true);
    // A varying nonzero signal makes dropped, duplicated and zero-filled spans
    // observable across both 128-sample render quanta and 960-sample messages.
    const input=Float32Array.from({length:48000},(_,index)=>.1+.7*(index%997)/996);
    c.feed(input);
    assert.equal(c.messages.length,50,'One second of capture must produce fifty worklet messages');
    assert.equal(c.packets.length,50,'Every 20 ms message must reach the native transport');
    for(let index=0;index<50;index++){
      assert.equal(c.messages[index].samples,960);
      assert.equal(c.packets[index].sampleRate,16000);assert.equal(c.packets[index].samples.length,320);
      const expectedDeadline=(index+1)*960,actual=c.packets[index].at;
      assert(actual>=expectedDeadline&&actual<expectedDeadline+128,'A packet must leave within one render quantum of its 20 ms boundary');
      if(index)assert(actual-c.packets[index-1].at<=1024,'No 80 ms capture batching may race the native silence deadline');
    }
    const output=c.packets.flatMap(packet=>packet.samples);assert.equal(output.length,16000);
    // The interpolator retains one previous input sample at stream startup.
    // Its sole initial zero is expected; every subsequent sample is real PCM.
    assert.equal(output[0],0);
    for(let index=1;index<output.length;index++)assert.equal(output[index],input[index*3-1],`PCM continuity at output sample ${index}`);
    assert.deepEqual(c.errors,[]);
  }finally{await c.audio.stop();}
  assert.equal(c.track.readyState,'ended');
});

test('muting preserves the 20 ms input clock and unmuting resumes real samples',async()=>{
  const c=await capture();
  try{
    c.audio.setReady(true);c.audio.setMuted(true);c.feed(new Float32Array(4800).fill(.4));
    assert.equal(c.packets.length,5);assert(c.packets.every(packet=>packet.samples.length===320&&packet.samples.every(value=>value===0)));
    c.audio.setMuted(false);c.feed(new Float32Array(4800).fill(.4));
    assert.equal(c.packets.length,10);assert(c.packets.slice(5).every(packet=>packet.samples.every(value=>value===Math.fround(.4))));
    c.audio.setReady(false);c.feed(new Float32Array(4800).fill(.4));assert.equal(c.packets.length,10,'Disconnected inference receives no audio');
    assert.deepEqual(c.errors,[]);
  }finally{await c.audio.stop();}
});
