'use strict';
const {BridgeClient}=require('./bridge-client');
const path=require('node:path'),fs=require('node:fs');
const {EventEmitter}=require('node:events');
class CapabilityRuntime extends EventEmitter {
  constructor(root){
    super();this.root=root;this.serial=0;this.busy=false;this.client=null;this.kind=null;this.pendingKind=null;this.state='idle';this.retiring=new Set();
    const entry=(model,family,task,folder,exe,bundle,cache)=>({model,family,task,bridge:path.join(root,folder,exe),bundle:path.join(root,'models',bundle),cache:path.join(root,'models',cache)});
    this.models={
      asr:entry('Whisper Small','whisper','ITranscription','runtime-asr','trtmc_asr_bridge.exe','whisper-small-rtx.bundle','whisper-small.rtx.cache'),
      reasoning:entry('Qwen3-4B','qwen','ITextGeneration','runtime-text','trtmc_text_bridge.exe','qwen3-4b-rtx.bundle','qwen3-4b.rtx.cache'),
      embedding:entry('Multilingual E5 Small','bert','IEmbedding','runtime-embedding','trtmc_embedding_bridge.exe','multilingual-e5-small-rtx.bundle','multilingual-e5-small.rtx.cache'),
      vision:entry('SAM ViT-Base','sam','IPointPromptedSegmentation','runtime-vision','trtmc_vision_bridge.exe','sam-vit-base-rtx.bundle','sam-vit-base.rtx.cache'),
      understanding:entry('Qwen3-VL-2B-Instruct','qwen_vl','IVisionLanguageGeneration','runtime-understanding','trtmc_understanding_bridge.exe','understanding-qwen3-vl-2b-rtx.bundle','understanding.rtx.cache'),
      geometry:entry('MoGe-2 ViT-L','moge','IMonocularGeometry','runtime-geometry','trtmc_geometry_bridge.exe','geometry-moge-2-vitl-rtx.bundle','geometry-moge-2-vitl.rtx.cache'),
      voice:entry('Nemotron VoiceChat 11B','nemotron_voicechat','ISpeechSessionProvider','runtime-voice','trtmc_voicechat_bridge.exe','nemotron-voicechat-rtx.bundle','voicechat.rtx.cache')
    };
    const labels={asr:'Speech Recognition Model',reasoning:'Reasoning Model',embedding:'Embedding Model',vision:'Segmentation Model',understanding:'Image Understanding Model',geometry:'Depth Model',voice:'Speech Model'};
    for(const [kind,model]of Object.entries(this.models))model.displayName=labels[kind];
    // Preserve the original local installation while new builds own their bundle.
    const legacyVoice=path.join(path.dirname(root),'models/nemotron-voicechat-rtx.bundle');
    if(!fs.statSync(this.models.voice.bundle,{throwIfNoEntry:false})?.isFile()&&fs.statSync(legacyVoice,{throwIfNoEntry:false})?.isFile())this.models.voice.bundle=legacyVoice;
    this.guardian=path.join(root,'runtime-host/modelconnect_process_host.exe');
  }
  setState(state,detail=''){this.state=state;this.emit('state',{state,detail,kind:this.kind});}
  status(){const exists=p=>fs.statSync(p,{throwIfNoEntry:false})?.isFile()===true;return{state:this.state,busy:this.busy,loadedModel:this.kind,models:Object.entries(this.models).map(([key,m])=>({key,...m,installed:exists(this.guardian)&&exists(m.bridge)&&exists(m.bundle)}))};}
  async stopClient(){
    const client=this.client;if(!client)return;
    this.retiring.add(client);await client.stop();this.retiring.delete(client);
    if(this.client===client){this.client=null;this.kind=null;}
  }
  async cancel(){const token=++this.serial;this.busy=true;this.pendingKind=null;await this.stopClient();if(token===this.serial){this.busy=false;this.setState('idle');}}
  async stopVoice(){if(this.pendingKind==='voice'||(!this.busy&&this.kind==='voice'))await this.cancel();}
  async ensure(kind,token){
    if(this.kind!==kind)await this.stopClient();
    if(token!==this.serial)throw new Error('Operation cancelled.');
    if(!this.client){
      const model=this.models[kind];if(!model)throw new Error('Unknown model capability.');
      if(!this.status().models.find(m=>m.key===kind)?.installed)throw new Error(`${model.displayName} or its runtime is not installed.`);
      const args=['--bundle',model.bundle,'--runtime-root',path.dirname(model.bridge),'--runtime-cache',model.cache];
      if(kind==='voice')args.push('--system-prompt','You are a concise, friendly voice assistant. Respond naturally in one or two short sentences. Use plain English. Be honest about what you know. Do not claim to have taken actions outside this conversation.');
      const client=new BridgeClient({executable:model.bridge,guardian:this.guardian,args,timeout:240000});
      this.client=client;this.kind=kind;
      client.on('packet',packet=>{if(this.client===client&&!this.retiring.has(client))this.emit('packet',{kind,packet});});
      client.on('failure',detail=>{if(this.client===client&&!this.retiring.has(client)){this.emit('failure',{kind,detail});void this.cancel();}});
      client.on('closed',()=>{if(this.client===client){this.client=null;this.kind=null;if(!this.busy)this.setState('idle');this.emit('closed',kind);}});
      this.setState('loading',model.displayName);
    }
    const ready=await this.client.start();
    if(token!==this.serial)throw new Error('Operation cancelled.');
    if(ready.protocolVersion!==1||ready.backend!=='trt_rtx'||ready.family!==this.models[kind].family){await this.stopClient();throw new Error('The ModelConnect runtime returned a different capability than requested.');}
    return ready;
  }
  async run(kind,request){
    if(this.busy)throw new Error('Finish or cancel the current inference first.');
    this.busy=true;this.pendingKind=kind;const token=++this.serial,started=Date.now();
    try{
      const ready=await this.ensure(kind,token);this.setState('generating',this.models[kind].displayName);
      const result=await this.client.request(request);
      if(token!==this.serial)throw new Error('Operation cancelled.');
      if(result.backend!=='trt_rtx'||result.family!==this.models[kind].family){await this.stopClient();throw new Error('Unexpected inference backend.');}
      return{...result,loadMs:ready.loadTimeMs??ready.loadMs,wallMs:Date.now()-started};
    }finally{if(token===this.serial){this.busy=false;this.pendingKind=null;this.setState(this.client?'ready':'idle');}}
  }
  async startVoice(){
    if(this.busy)throw new Error('Finish or cancel the current inference first.');
    this.busy=true;this.pendingKind='voice';const token=++this.serial;
    try{const ready=await this.ensure('voice',token);this.setState('voice');return ready;}
    catch(error){if(token===this.serial)await this.stopClient();throw error;}
    finally{if(token===this.serial){this.busy=false;this.pendingKind=null;if(!this.client)this.setState('idle');}}
  }
  sendVoice(packet){if(this.kind==='voice'&&this.state==='voice')this.client.send(packet);}
  resetVoice(){if(this.kind==='voice')this.client.send({type:'reset'});}
}
module.exports={CapabilityRuntime};
