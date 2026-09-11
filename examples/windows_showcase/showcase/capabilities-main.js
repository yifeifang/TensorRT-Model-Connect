'use strict';
const {app,BrowserWindow,ipcMain,session,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const catalog=require('./capabilities');
const {CapabilityRuntime}=require('./capability-runtime');
const {parseThinking,cosine,pcmWave}=require('./capability-data');
const {png}=require('./png');
const {TranscriptStore}=require('./transcript-store');
const {normalizeEvent,validateInputAudio}=require('./voice-protocol');
const {presentationError}=require('./presentation-error');
const {geometryPresentation,geometryPly}=require('./geometry-data');
function locate(){for(let p=__dirname;;p=path.dirname(p)){if(fs.existsSync(path.join(p,'showcase/package.json')))return p;if(p===path.dirname(p))throw new Error('Place the app in its ModelConnect example directory.');}}
const root=locate(),runtime=new CapabilityRuntime(root),records=new Map(),assets=new Map(),voiceTranscript=new TranscriptStore();
const page=path.join(__dirname,'renderer/capabilities.html'),pageUrl=pathToFileURL(page).href,tmp=path.join(root,'.showcase/capability-inputs');
let window,gpu=null,gpuPollBusy=false,voiceEpoch=-1,voiceSequence=-1;
const emit=event=>{if(window&&!window.isDestroyed())window.webContents.send('showcase:event',event);};
const removeTemp=p=>{try{fs.unlinkSync(p);}catch(error){if(error.code!=='ENOENT')throw error;}};
const nonempty=(v,max=3500)=>typeof v==='string'&&v.trim()&&v.length<=max;
function visibleFailure(error){const original=String(error?.message||error),message=presentationError(error);if(message!==original){try{fs.mkdirSync(path.join(root,'logs'),{recursive:true});fs.appendFileSync(path.join(root,'logs/capability-diagnostics.ndjson'),JSON.stringify({time:new Date().toISOString(),error:original})+'\n');}catch{}}return message;}
function record(key,kind,input,result,extra={}){
  const model=runtime.models[kind];
  const receipt={id:crypto.randomUUID(),key,kind,model:model.model,family:model.family,task:model.task,backend:'TensorRT-RTX',runtime:'TensorRT-Model-Connect',inference:'live-local',bundle:model.bundle,createdAt:new Date().toISOString(),input,result,...extra};
  for(const [id,prior]of records)if(prior.key===key)records.delete(id);records.set(receipt.id,receipt);return receipt;
}
runtime.on('state',event=>emit({type:'engine',...event}));
runtime.on('failure',event=>emit({type:'runtime-error',...event,detail:visibleFailure(event.detail)}));
runtime.on('closed',kind=>{if(kind==='voice'){emit({type:'voice',event:{type:'flush'}});emit({type:'voice',event:{type:'state',state:'disconnected'}});}});
runtime.on('packet',({kind,packet})=>{
  if(kind!=='voice')return;
  try{
    if(packet.type==='event'){
      if(!Number.isSafeInteger(packet.epoch)||packet.epoch<0||!Number.isSafeInteger(packet.sequence)||packet.sequence<0)throw new Error('Invalid voice event identity.');
      if(packet.epoch<voiceEpoch||(packet.epoch===voiceEpoch&&packet.sequence<=voiceSequence))return;
      voiceEpoch=packet.epoch;voiceSequence=packet.sequence;
    }
    for(const event of normalizeEvent(packet)){voiceTranscript.append(event);emit({type:'voice',event:event.type==='error'?{...event,message:visibleFailure(event.message)}:event});}
  }catch(error){emit({type:'voice',event:{type:'error',fatal:true,message:visibleFailure(error)}});void runtime.cancel();}
});
async function transcribe(request){
  if(!request||request.sampleRate!==16000||request.language!=='en')throw new Error('Use English audio at 16 kHz.');
  const wav=pcmWave(request.samples),file=path.join(tmp,`${crypto.randomUUID()}.wav`);fs.writeFileSync(file,wav);
  try{const result=await runtime.run('asr',{type:'transcribe',wavPath:file,language:request.language,maxTokens:224});
    if(typeof result.text!=='string'||!result.text.trim())throw new Error('No speech was recognized. Record a clearer sample and try again.');
    return record('asr','asr',{language:request.language,sampleRate:16000,samples:request.samples.length,audioSeconds:request.samples.length/16000,audioSha256:crypto.createHash('sha256').update(wav).digest('hex')},result);
  }finally{removeTemp(file);}
}
async function reason(request){
  if(!nonempty(request?.input)||typeof request.thinking!=='boolean')throw new Error('Enter a question using 1–3500 characters.');
  const prompt=`Reason and answer in English.\n\nQuestion:\n${request.input.trim()}`;
  const result=await runtime.run('reasoning',{type:'generate',prompt,maxTokens:1536,enableThinking:request.thinking});
  return record(`reasoning:${request.thinking}`,'reasoning',request.input,result,{thinking:request.thinking,...parseThinking(result.text,request.thinking,result.reachedTokenLimit)});
}
async function refine(request){
  const asr=records.get(request?.asrId);if(!asr||asr.key!=='asr')throw new Error('Run speech recognition to obtain an original transcript first.');
  if(!nonempty(request.context,500))throw new Error('Describe the intended use in 1–500 characters.');
  const prompt=`Refine the speech transcript below for the intended use. Preserve its meaning and all explicit facts, names, numbers and times. Remove spoken filler words. When the speaker explicitly corrects an earlier statement, keep the corrected version. Add natural punctuation. Do not invent details. Reason in English and write the final answer in English. Return only the refined text as the final answer.\nIntended use: ${request.context}\nOriginal transcript: ${asr.result.text}`;
  const result=await runtime.run('reasoning',{type:'generate',prompt,maxTokens:1536,enableThinking:true});
  return record('refine','reasoning',{asrId:asr.id,asrModel:asr.model,transcript:asr.result.text,context:request.context},result,{thinking:true,...parseThinking(result.text,true,result.reachedTokenLimit)});
}
async function embed(request){
  if(!nonempty(request?.query,1000)||!Array.isArray(request.documents)||request.documents.length<2||request.documents.length>10||request.documents.some(d=>!nonempty(d,1000)))throw new Error('Enter a query and 2–10 candidate passages, each up to 1000 characters.');
  const texts=[request.query,...request.documents],roles=texts.map((_,i)=>i?'passage':'query');
  const result=await runtime.run('embedding',{type:'embed',texts,roles});
  if(!Array.isArray(result.vectors)||result.vectors.length!==texts.length||result.dimension!==384||result.vectors.some(v=>!Array.isArray(v)||v.length!==384))throw new Error('The embedding model returned an invalid vector structure.');
  const matrix=result.vectors.map(a=>result.vectors.map(b=>cosine(a,b)));
  const ranking=request.documents.map((text,index)=>({index,text,score:matrix[0][index+1]})).sort((a,b)=>b.score-a.score);
  return record('embedding','embedding',{query:request.query,documents:request.documents},result,{matrix,ranking});
}
function imageAsset(request){
  const status=runtime.status();
  if(status.busy||status.state==='voice')throw new Error('Finish or cancel inference and end the voice session before replacing the image.');
  const {width,height,rgbaBase64,slot='vision'}=request||{};
  if(!['vision','understanding','geometry'].includes(slot))throw new Error('Choose an image capability before importing.');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>2048||height>2048||typeof rgbaBase64!=='string'||rgbaBase64.length>24*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(rgbaBase64))throw new Error('Choose an image between 16 and 2048 pixels on each side.');
  const rgba=Buffer.from(rgbaBase64,'base64');if(rgba.length!==width*height*4)throw new Error('Invalid image byte count.');
  if(slot==='geometry'&&(width<64||height<64||width>512||height>512||width/height<.5||width/height>2))throw new Error('Depth images need sides from 64 to 512 pixels and an aspect ratio between 1:2 and 2:1.');
  if(slot==='understanding'&&(width<64||height<64||width>448||height>448))throw new Error('Image understanding accepts sides from 64 to 448 pixels.');
  for(const [id,asset]of assets)if(asset.slot===slot){removeTemp(asset.file);assets.delete(id);}
  const id=crypto.randomUUID(),file=path.join(tmp,`${id}.ppm`),rgb=Buffer.alloc(width*height*3);
  for(let p=0;p<width*height;p++){const a=rgba[p*4+3]/255;for(let c=0;c<3;c++)rgb[p*3+c]=Math.round(rgba[p*4+c]*a+255*(1-a));}
  fs.writeFileSync(file,Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));
  const dataUrl=`data:image/png;base64,${png(width,height,rgba).toString('base64')}`;
  assets.set(id,{id,slot,file,width,height,rgba,dataUrl});return{id,width,height,dataUrl};
}
async function segment(request){
  const asset=assets.get(request?.assetId),x=request?.x,y=request?.y;
  if(!asset||asset.slot!=='vision'||!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=asset.width||y>=asset.height)throw new Error('Import an image, then click an object inside it.');
  const result=await runtime.run('vision',{type:'segment',imagePath:asset.file,points:[{x,y,label:1}]});
  const mask=Buffer.from(result.maskBase64||'','base64');
  if(result.width!==asset.width||result.height!==asset.height||mask.length!==asset.width*asset.height)throw new Error('The model mask dimensions do not match the input image.');
  const cutout=Buffer.from(asset.rgba),overlay=Buffer.alloc(mask.length*4),gray=Buffer.alloc(mask.length*4);
  for(let i=0;i<mask.length;i++){const v=mask[i]?255:0;cutout[i*4+3]=Math.round(cutout[i*4+3]*v/255);overlay.set([145,195,60,v?150:0],i*4);gray.set([v,v,v,255],i*4);}
  const url=b=>`data:image/png;base64,${png(asset.width,asset.height,b).toString('base64')}`;
  return record('vision','vision',{assetId:asset.id,width:asset.width,height:asset.height,point:{x,y,label:1},imageSha256:crypto.createHash('sha256').update(asset.rgba).digest('hex')},result,{maskDataUrl:url(overlay),cutoutDataUrl:url(cutout),rawMaskDataUrl:url(gray)});
}
async function understand(request){
  const asset=assets.get(request?.assetId);
  if(!asset||asset.slot!=='understanding')throw new Error('Choose an image in Image Understanding first.');
  if(!nonempty(request.prompt,320)||Buffer.byteLength(request.prompt,'utf8')>360)throw new Error('Enter a short question, up to 320 English characters.');
  const prompt=`Answer in English. Use the image to answer briefly. If the image does not show the answer, say so.\n\n${request.prompt.trim()}`;
  const result=await runtime.run('understanding',{type:'understand',imagePath:asset.file,prompt,maxTokens:128});
  if(!nonempty(result.text,12000))throw new Error('The model returned no image answer. Try a shorter question.');
  return record('understanding','understanding',{assetId:asset.id,prompt:request.prompt,width:asset.width,height:asset.height,imageSha256:crypto.createHash('sha256').update(asset.rgba).digest('hex')},result,parseThinking(result.text,false,result.reachedTokenLimit));
}
async function geometry(request){
  const asset=assets.get(request?.assetId);
  if(!asset||asset.slot!=='geometry')throw new Error('Choose an image in Image to Depth first.');
  const result=await runtime.run('geometry',{type:'geometry',imagePath:asset.file});
  const receipt=record('geometry','geometry',{assetId:asset.id,width:asset.width,height:asset.height,imageSha256:crypto.createHash('sha256').update(asset.rgba).digest('hex')},result,geometryPresentation(result,asset));
  // Keep the colors with the receipt so a later image import cannot alter PLY export.
  Object.defineProperty(receipt,'geometryRgba',{value:Buffer.from(asset.rgba),enumerable:false});
  return receipt;
}
async function exportResult(request){
  let receipt=records.get(request?.id);
  if(request?.kind==='voice'){const text=voiceTranscript.text();if(!text.trim())throw new Error('There is no transcript to export yet.');receipt={model:runtime.models.voice.model,inference:'live-local',runtime:'TensorRT-Model-Connect',backend:'TensorRT-RTX',text};}
  if(!receipt)throw new Error('Run a model to create a result first.');
  if(!['json','text','cutout','mask','depth','points'].includes(request.format))throw new Error('Unknown export format.');
  const isImage=['cutout','mask','depth'].includes(request.format),extension=isImage?'png':request.format==='points'?'ply':request.format==='json'?'json':'txt';
  if(['cutout','mask'].includes(request.format)&&receipt.kind!=='vision')throw new Error('This PNG export requires an image segmentation result.');
  if(['depth','points'].includes(request.format)&&receipt.kind!=='geometry')throw new Error('This export requires an image depth result.');
  const filenameKey=(receipt.key||'voice').replace(/[^a-z0-9_-]/gi,'-');
  const output=await dialog.showSaveDialog(window,{title:'Export model result',buttonLabel:'Save',defaultPath:path.join(root,`modelconnect-${filenameKey}.${extension}`),filters:[{name:extension.toUpperCase(),extensions:[extension]}]});
  if(output.canceled||!output.filePath)return{cancelled:true};
  const content=isImage?Buffer.from((request.format==='depth'?receipt.depthDataUrl:request.format==='cutout'?receipt.cutoutDataUrl:receipt.rawMaskDataUrl).split(',')[1],'base64'):request.format==='points'?geometryPly(receipt.result,{...receipt.input,rgba:receipt.geometryRgba}):request.format==='json'?JSON.stringify(receipt,null,2):receipt.answer||receipt.text||receipt.result?.text||JSON.stringify(receipt.ranking,null,2);
  fs.writeFileSync(output.filePath,content);return{path:output.filePath};
}
function pollGpu(){if(gpuPollBusy)return;gpuPollBusy=true;const p=spawn('nvidia-smi',['--query-gpu=name,memory.used,memory.total,utilization.gpu','--format=csv,noheader,nounits'],{windowsHide:true});let out='';const timer=setTimeout(()=>p.kill(),3000);p.stdout.on('data',d=>out+=d);p.on('error',()=>{});p.on('close',code=>{clearTimeout(timer);gpuPollBusy=false;if(!code){const [name,used,total,use]=out.trim().split('\n')[0].split(',').map(v=>v.trim());gpu={name,usedMb:+used,totalMb:+total,utilization:+use};emit({type:'gpu',...gpu});}});}
app.commandLine.appendSwitch('lang','en-US');
app.setName('ModelConnect Showcase');app.setPath('userData',path.join(root,'.showcase'));
if(!app.requestSingleInstanceLock())app.quit();else app.whenReady().then(()=>{
  fs.mkdirSync(tmp,{recursive:true});
  for(const entry of fs.readdirSync(tmp,{withFileTypes:true}))if(entry.isFile()&&/\.(wav|ppm)$/i.test(entry.name))removeTemp(path.join(tmp,entry.name));
  window=new BrowserWindow({width:1500,height:980,minWidth:1080,minHeight:720,title:catalog.title,backgroundColor:'#f6f6ef',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'capabilities-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.setMenu(null);
  app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.focus();});
  const trusted=(contents,details={})=>contents===window?.webContents&&contents.getURL()===pageUrl&&details.isMainFrame!==false&&(!details.requestingUrl||details.requestingUrl===pageUrl);
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(trusted(contents,details)&&permission==='media'&&details.mediaTypes?.length>0&&details.mediaTypes.every(t=>t==='audio')));
  session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>trusted(contents,details)&&permission==='media'&&details.mediaType==='audio');
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(url!==pageUrl)event.preventDefault();});
  const assertSender=event=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==pageUrl)throw new Error('Untrusted sender.');};
  const samples=()=>Object.fromEntries(['dictation-en.wav','dictation-correction.wav','geometry-house.jpg'].map(name=>[name,fs.existsSync(path.join(__dirname,'renderer/fixtures',name))]));
  const handlers={catalog:()=>catalog,status:()=>({...runtime.status(),gpu,samples:samples()}),transcribe,reason,refine,embed,'image-asset':imageAsset,segment,understand,geometry,cancel:()=>runtime.cancel(),export:exportResult,
    'voice-start':async()=>{voiceEpoch=-1;voiceSequence=-1;voiceTranscript.reset();return runtime.startVoice();},'voice-stop':()=>runtime.stopVoice(),'voice-reset':()=>{voiceTranscript.reset();runtime.resetVoice();},
    fullscreen:value=>window.setFullScreen(Boolean(value))};
  for(const [name,handler]of Object.entries(handlers))ipcMain.handle(`showcase:${name}`,(event,...args)=>{assertSender(event);try{const value=handler(...args);return value?.then?value.catch(error=>{throw new Error(visibleFailure(error));}):value;}catch(error){throw new Error(visibleFailure(error));}});
  ipcMain.on('showcase:audio',(event,packet)=>{try{assertSender(event);runtime.sendVoice(validateInputAudio(packet));}catch(error){emit({type:'voice',event:{type:'error',message:visibleFailure(error),fatal:true}});void runtime.stopVoice();}});
  window.loadFile(page);window.webContents.on('did-finish-load',pollGpu);const timer=setInterval(pollGpu,3000);let closing=false;
  window.on('close',event=>{if(!closing){event.preventDefault();closing=true;void runtime.cancel().finally(()=>window?.destroy());}});
  window.on('closed',()=>{clearInterval(timer);window=null;for(const asset of assets.values())removeTemp(asset.file);assets.clear();});
});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(runtime.client?.child){event.preventDefault();runtime.cancel().then(()=>app.quit());}});
