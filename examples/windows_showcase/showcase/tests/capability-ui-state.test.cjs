'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const catalog=require('../capabilities');
const source=fs.readFileSync(path.join(__dirname,'../renderer/capabilities.js'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
function receipt(input,answer,id=answer){return{id,input,answer,complete:true,model:'Qwen',result:{totalMs:1}};}

// Execute the actual frontend functions and event handlers. Only browser nodes,
// audio acquisition and IPC are replaced; no window, process or GPU is started.
function createUi(overrides={},browser={}){
  const nodes=new Map(),listeners={},calls=[];
  const node=key=>{
    if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',hidden:false,style:{},classList:{toggle(){}},focus(){},setAttribute(){},
      getBoundingClientRect(){return{left:0,top:0,width:640,height:382}}});
    return nodes.get(key);
  };
  const api={getStatus:async()=>({state:'ready',models:[]}),cancel:async()=>{},stopVoice:async()=>{},
    reason:async request=>receipt(request.input,'NEW ANSWER'),
    transcribe:async request=>{calls.push({type:'transcribe',request});return{id:'fresh-asr',model:'Whisper',result:{text:'NEW TRANSCRIPT',totalMs:1}};},
    refine:async request=>{calls.push({type:'refine',request});return receipt(request,'REFINED');},...overrides};
  const canvas=()=>{const value={width:0,height:0};value.getContext=()=>({drawImage:bitmap=>value.marker=bitmap.marker,
    getImageData:()=>({data:Uint8ClampedArray.from({length:value.width*value.height*4},()=>value.marker)})});return value;};
  const DictationAudio=browser.DictationAudio||class{constructor(){throw new Error('Unexpected microphone acquisition')}};
  DictationAudio.decodeFile=browser.decodeFile||(async()=>{throw new Error('Unexpected audio decode')});
  const GeometryView=browser.GeometryView||class{getView(){return{yaw:0,pitch:0,zoom:1}}dispose(){}reset(){}zoom(){}};
  const context=vm.createContext({window:{showcase:api,scrollTo(){},DictationAudio,GeometryView},
    document:{querySelector:node,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,createElement:name=>{assert.equal(name,'canvas');return canvas();}},
    createImageBitmap:browser.createImageBitmap||(async()=>{throw new Error('Unexpected image decode')}),fetch:browser.fetch,
    setTimeout:()=>1,clearTimeout(){},Blob,File,btoa,URL:{createObjectURL:()=> 'blob:audio',revokeObjectURL(){}},console});
  vm.runInContext(source.replace(/\nvoid init\(\)\.catch[\s\S]*$/,'')+
    '\nglobalThis.testUi={state,run,cancel,navigate,render,renderReasoning,renderDictation,renderEmbedding,renderUnderstanding,renderGeometry,understandImage,predictGeometry,loadAudio,loadImage,toggleRecord,finishRecording,transcribe,setRecorder(value){recorder=value},getRecorder(){return recorder}};',context);
  const ui=context.testUi;ui.state.catalog=catalog;
  const click=(action,extra={})=>listeners.click({target:{closest:selector=>selector==='#vision-input'?null:{dataset:{action,...extra},disabled:false}}});
  const input=value=>listeners.input({target:{id:'reasoning-input',value}});
  const inputField=(id,value)=>listeners.input({target:{id,value}});
  return{...ui,node,listeners,calls,api,click,input,inputField};
}

test('reasoning columns hide mismatched inputs and invalidate both answers when the question changes',async()=>{
  const ui=createUi();ui.state.route='reasoning';ui.state.reasoning.input='question A';
  ui.state.reasoning.direct=receipt('question A','OLD DIRECT');ui.state.reasoning.thinking=receipt('question A','OLD THINKING');
  ui.input('question B');
  assert.equal(ui.state.reasoning.direct,null);assert.equal(ui.state.reasoning.thinking,null);
  await ui.click('reason',{thinking:'true'});
  assert.equal(ui.state.reasoning.thinking.input,'question B');
  assert.doesNotMatch(ui.node('#main').innerHTML,/OLD DIRECT|OLD THINKING/);
  assert.match(ui.node('#main').innerHTML,/NEW ANSWER/);
  // Also guard rendering against a receipt restored with stale input metadata.
  ui.state.reasoning.direct=receipt('question A','STALE RESTORED ANSWER');
  assert.doesNotMatch(ui.renderReasoning(),/STALE RESTORED ANSWER/);
  await ui.click('reason-sample');
  assert.equal(ui.state.reasoning.direct,null);assert.equal(ui.state.reasoning.thinking,null);
});

test('a reasoning response cannot populate a comparison after its input changed in flight',async()=>{
  const pending=deferred(),ui=createUi({reason:()=>pending.promise});ui.state.route='reasoning';ui.state.reasoning.input='question A';
  const running=ui.click('reason',{thinking:'true'});
  ui.input('question B');pending.resolve(receipt('question A','LATE OLD ANSWER'));await running;
  assert.equal(ui.state.reasoning.thinking,null);
  assert.doesNotMatch(ui.node('#main').innerHTML,/LATE OLD ANSWER/);
});

test('a new SAM click removes the old mask even when the replacement is cancelled',async()=>{
  const pending=deferred(),ui=createUi({segment:()=>pending.promise});ui.state.route='vision';
  ui.state.vision.asset={id:'asset',width:640,height:382,dataUrl:'data:original'};
  ui.state.vision.point={x:430,y:225};
  ui.state.vision.receipt={id:'old',maskDataUrl:'data:OLD-CAR-MASK',cutoutDataUrl:'data:OLD-CAR-CUTOUT',result:{score:.9,maskIndex:0,totalMs:1}};
  const running=ui.listeners.click({clientX:120,clientY:55,target:{closest:()=>ui.node('#vision-input')}});
  assert.equal(ui.state.vision.receipt,null);await ui.cancel();pending.resolve({id:'cancelled'});await running;
  assert.equal(ui.state.vision.receipt,null);assert.equal(ui.state.vision.point.x,120);
  assert.doesNotMatch(ui.node('#main').innerHTML,/OLD-CAR-MASK|OLD-CAR-CUTOUT/);
});

test('recording blocks previous ASR and refinement while stop and audio import remain enabled',async()=>{
  const ui=createUi();ui.state.route='dictation';
  const oldAsr={id:'old-asr',model:'Whisper',result:{text:'OLD TRANSCRIPT',totalMs:1}};
  ui.state.dictation.asr=oldAsr;ui.state.dictation.recording=true;
  ui.state.dictation.audio={samples:Array(1600).fill(.1),sampleRate:16000,audioSeconds:.1};ui.state.dictation.url='blob:previous';
  const html=ui.renderDictation();
  assert.match(html,/<button[^>]*data-action="refine"[^>]*disabled/);
  assert.match(html,/<button[^>]*data-action="transcribe"[^>]*disabled/);
  assert.match(html,/<button[^>]*data-action="sample-audio"[^>]*disabled/);
  assert.doesNotMatch(html.match(/<button[^>]*data-action="record"[^>]*>/)[0],/disabled/);
  assert.doesNotMatch(html.match(/<input[^>]*id="audio-file"[^>]*>/)[0],/disabled/);
  await ui.click('refine');await ui.transcribe();
  assert.equal(ui.calls.length,0);assert.equal(ui.state.dictation.asr,oldAsr);
  ui.setRecorder({finish:async()=>({samples:Array(3200).fill(.2),sampleRate:16000,audioSeconds:.2})});
  await ui.finishRecording();
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].type,'transcribe');
  assert.equal(ui.calls[0].request.samples.length,3200);
  assert.equal(ui.state.dictation.asr.result.text,'NEW TRANSCRIPT');assert.equal(ui.state.dictation.recording,false);
});

test('stopping realtime voice reserves the inference slot before a second click can enter',async()=>{
  const stopping=deferred(),ui=createUi({stopVoice:()=>stopping.promise});ui.state.route='reasoning';ui.state.voice.active=true;
  const calls=[];
  const first=ui.run('reasoning','first',async()=>{calls.push('first');return'first'},r=>calls.push(`accepted:${r}`));
  assert.equal(ui.state.busy.label,'first');
  await ui.run('reasoning','second',async()=>calls.push('second'),()=>calls.push('accepted:second'));
  assert.equal(calls.length,0);stopping.resolve();await first;
  assert.deepEqual(calls,['first','accepted:first']);assert.equal(ui.state.busy,null);
});

function embeddingReceipt(query,documents){return{id:'e5',model:'E5',input:{query,documents},
  result:{totalMs:1,vectors:[Array(384).fill(1/Math.sqrt(384))]},matrix:[[1,.8,.1],[.8,1,.2],[.1,.2,1]],
  ranking:documents.map((text,index)=>({index,text,score:index?.1:.8}))};}

test('editing E5 inputs clears only output nodes and hides stale restored receipts',()=>{
  const ui=createUi();ui.state.route='embedding';ui.state.embedding.query='query A';ui.state.embedding.documents='DOC A\nDOC B';
  const old=embeddingReceipt('query A',['DOC A','DOC B']);ui.state.embedding.receipt=old;ui.render();
  const inputNode=ui.node('#embedding-query'),page=ui.node('#main').innerHTML;
  ui.node('#embedding-vectors').innerHTML='OLD VECTOR';ui.node('#embedding-results').innerHTML='OLD RANKING';
  ui.inputField('embedding-query','query B');
  assert.equal(ui.state.embedding.receipt,null);assert.equal(ui.node('#embedding-query'),inputNode);
  assert.equal(ui.node('#main').innerHTML,page,'Typing must not replace the page or its focused input');
  assert.equal(ui.node('#embedding-vectors').innerHTML,'');assert.doesNotMatch(ui.node('#embedding-results').innerHTML,/OLD RANKING/);
  ui.state.embedding.receipt=old;assert.doesNotMatch(ui.renderEmbedding(),/id="embedding-ranking"/);
});

test('an E5 response cannot be published after candidate text changes in flight',async()=>{
  const pending=deferred(),ui=createUi({embed:()=>pending.promise});ui.state.route='embedding';
  ui.state.embedding.query='query';ui.state.embedding.documents='DOC A\nDOC B';
  const running=ui.click('embed');ui.inputField('embedding-documents','NEW DOC\nDOC B');
  pending.resolve(embeddingReceipt('query',['DOC A','DOC B']));await running;
  assert.equal(ui.state.embedding.receipt,null);assert.doesNotMatch(ui.node('#main').innerHTML,/id="embedding-ranking"/);
});

function decoded(value){return{samples:Array(1600).fill(value),sampleRate:16000,audioSeconds:.1};}
test('selecting an audio sample clears old ASR before file fetch or decode completes',async()=>{
  const fetchPending=deferred(),ui=createUi({}, {fetch:()=>fetchPending.promise,decodeFile:async()=>decoded(.3)});ui.state.route='dictation';
  ui.state.dictation.asr={id:'old',result:{text:'STALE ASR'}};ui.state.dictation.refined={answer:'STALE REFINE'};
  const loading=ui.click('sample-audio',{language:'en'});
  assert.equal(ui.state.dictation.asr,null);assert.equal(ui.state.dictation.refined,null);assert.equal(ui.state.busy.phase,'input');
  let called=false;await ui.run('reasoning','blocked',async()=>called=true,()=>{});assert.equal(called,false);
  const html=ui.renderDictation();
  assert.doesNotMatch(html.match(/<input[^>]*id="audio-file"[^>]*>/)[0],/disabled/,'A newer audio selection may replace decoding input');
  fetchPending.resolve({ok:true,blob:async()=>new Blob(['audio'])});await loading;
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].request.language,'en');assert.equal(ui.state.dictation.asr.result.text,'NEW TRANSCRIPT');
});

test('out-of-order audio decoding transcribes only the latest selected file',async()=>{
  const first=deferred(),second=deferred(),ui=createUi({}, {decodeFile:file=>file.name==='first'?first.promise:second.promise});ui.state.route='dictation';
  const old=ui.loadAudio({name:'first'},'zh'),latest=ui.loadAudio({name:'second'},'en');
  second.resolve(decoded(.2));await latest;first.resolve(decoded(.1));await old;
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].request.samples[0],.2);assert.equal(ui.calls[0].request.language,'en');
  assert.equal(ui.state.dictation.audio.samples[0],.2);assert.equal(ui.state.busy,null);
});

test('cancelled audio decoding neither starts ASR nor restores old input',async()=>{
  const pending=deferred(),ui=createUi({}, {decodeFile:()=>pending.promise});ui.state.route='dictation';
  const loading=ui.loadAudio({name:'pending'});await ui.cancel();pending.resolve(decoded(.1));await loading;
  assert.equal(ui.calls.length,0);assert.equal(ui.state.dictation.audio,null);assert.equal(ui.state.dictation.asr,null);assert.equal(ui.state.busy,null);
});

function bitmap(marker){return{width:16,height:16,marker,closed:false,close(){this.closed=true}};}
test('out-of-order image decoding registers only the latest image and closes discarded bitmaps',async()=>{
  const first=deferred(),second=deferred(),registered=[];
  const ui=createUi({imageAsset:async request=>{const marker=Buffer.from(request.rgbaBase64,'base64')[0];registered.push(marker);return{id:`asset-${marker}`,width:request.width,height:request.height,dataUrl:'data:image'};}},
    {createImageBitmap:file=>file.name==='first'?first.promise:second.promise});ui.state.route='vision';
  ui.state.vision.asset={id:'old',width:640,height:382,dataUrl:'data:old'};ui.state.vision.receipt={id:'old-mask'};
  const old=ui.loadImage({name:'first',size:100});assert.equal(ui.state.vision.asset,null);assert.equal(ui.state.vision.receipt,null);assert.equal(ui.state.busy.phase,'input');
  const latest=ui.loadImage({name:'second',size:100}),newBitmap=bitmap(22),oldBitmap=bitmap(11);
  second.resolve(newBitmap);await latest;first.resolve(oldBitmap);await old;
  assert.deepEqual(registered,[22]);assert.equal(ui.state.vision.asset.id,'asset-22');assert.equal(ui.state.busy,null);
  assert.equal(newBitmap.closed,true);assert.equal(oldBitmap.closed,true);
});

test('cancelled image decoding does not register or restore an image',async()=>{
  const pending=deferred(),calls=[];
  const ui=createUi({imageAsset:async request=>calls.push(request)},{createImageBitmap:()=>pending.promise});ui.state.route='vision';
  const loading=ui.loadImage({name:'pending',size:100});await ui.cancel();const decoded=bitmap(11);pending.resolve(decoded);await loading;
  assert.equal(calls.length,0);assert.equal(decoded.closed,true);assert.equal(ui.state.vision.asset,null);assert.equal(ui.state.busy,null);
});

function microphone({starting,finishing}={}){
  const instances=[];
  class DictationAudio{
    constructor(callbacks){this.callbacks=callbacks;this.open=false;this.cancelCalls=0;this.finishCalls=0;instances.push(this);}
    async start(){if(starting)await starting.promise;this.open=true;}
    async finish(){this.finishCalls++;const result=finishing?await finishing.promise:decoded(.2);this.open=false;return result;}
    async cancel(){this.cancelCalls++;this.open=false;}
  }
  return{DictationAudio,instances};
}
const nextTurn=()=>new Promise(setImmediate);

test('double clicking record during realtime voice shutdown opens exactly one microphone',async()=>{
  const stopping=deferred(),mic=microphone(),ui=createUi({stopVoice:()=>stopping.promise},mic);ui.state.route='dictation';ui.state.voice.active=true;
  const starting=ui.click('record');
  assert.equal(ui.state.busy.phase,'record-start');assert.equal(ui.state.dictation.recording,true);
  assert.match(ui.node('#main').innerHTML,/data-action="cancel"/,'Microphone startup retains a cancel action');
  await ui.click('record');assert.equal(mic.instances.length,0);
  stopping.resolve();await starting;
  assert.equal(mic.instances.length,1);assert.equal(mic.instances[0].open,true);
  assert.equal(ui.getRecorder(),mic.instances[0]);assert.equal(ui.state.busy,null);
});

test('cancelling before voice shutdown completes prevents microphone acquisition',async()=>{
  const stopping=deferred(),mic=microphone(),ui=createUi({stopVoice:()=>stopping.promise},mic);ui.state.route='dictation';ui.state.voice.active=true;
  const starting=ui.click('record');await ui.cancel();stopping.resolve();await starting;
  assert.equal(mic.instances.length,0);assert.equal(ui.state.dictation.recording,false);assert.equal(ui.state.busy,null);
});

for(const interruption of ['cancel','navigate'])test(`${interruption} during microphone startup closes a late acquisition and publishes nothing`,async()=>{
  const starting=deferred(),mic=microphone({starting}),ui=createUi({},mic);ui.state.route='dictation';
  const pending=ui.click('record'),current=mic.instances[0];
  assert.equal(ui.getRecorder(),current);
  if(interruption==='cancel')await ui.cancel();else{ui.navigate('reasoning');await nextTurn();}
  assert.ok(current.cancelCalls>0);assert.equal(ui.state.dictation.recording,false);
  starting.resolve();await pending;
  assert.equal(current.open,false);assert.equal(ui.getRecorder(),null);assert.equal(ui.state.busy,null);
  assert.equal(ui.state.dictation.audio,null);assert.equal(ui.calls.length,0);
  if(interruption==='navigate')assert.equal(ui.state.route,'reasoning');
});

test('finishing a recording retains the input slot until its audio is ready',async()=>{
  const finishing=deferred(),mic=microphone({finishing}),ui=createUi({},mic);ui.state.route='dictation';
  await ui.click('record');const current=mic.instances[0],pending=ui.click('record');
  assert.equal(ui.state.busy.phase,'record-finish');assert.equal(ui.state.dictation.recording,true);assert.equal(ui.getRecorder(),current);
  assert.match(ui.node('#main').innerHTML,/data-action="cancel"/);
  await ui.click('record');await ui.loadAudio({name:'must-not-decode'});
  let inferred=false;await ui.run('reasoning','blocked',async()=>inferred=true,()=>{});
  assert.equal(inferred,false);assert.equal(current.finishCalls,1);assert.equal(mic.instances.length,1);assert.equal(ui.state.dictation.audio,null);
  finishing.resolve(decoded(.4));await pending;
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].request.samples[0],.4);
  assert.equal(ui.state.dictation.recording,false);assert.equal(ui.getRecorder(),null);assert.equal(ui.state.busy,null);
});

for(const interruption of ['cancel','navigate'])test(`${interruption} during recording finish discards its late audio after a replacement input`,async()=>{
  const finishing=deferred(),mic=microphone({finishing}),ui=createUi({}, {...mic,decodeFile:async()=>decoded(.7)});ui.state.route='dictation';
  await ui.click('record');const pending=ui.click('record'),current=mic.instances[0];
  if(interruption==='cancel')await ui.cancel();else{ui.navigate('reasoning');await nextTurn();ui.navigate('dictation');}
  assert.ok(current.cancelCalls>0);assert.equal(current.open,false);
  await ui.loadAudio({name:'replacement'});finishing.resolve(decoded(.1));await pending;
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].request.samples[0],.7);
  assert.equal(ui.state.dictation.audio.samples[0],.7);assert.equal(ui.state.dictation.asr.result.text,'NEW TRANSCRIPT');
  assert.equal(ui.getRecorder(),null);assert.equal(ui.state.busy,null);
});

test('callbacks from a cancelled microphone cannot stop or update a newer recording',async()=>{
  const mic=microphone(),ui=createUi({},mic);ui.state.route='dictation';
  await ui.click('record');const old=mic.instances[0];await ui.cancel();await ui.click('record');const current=mic.instances[1];
  old.callbacks.onDuration(29);old.callbacks.onError(new Error('old device disconnected'));old.callbacks.onLimit();await nextTurn();
  assert.equal(ui.getRecorder(),current);assert.equal(current.open,true);assert.equal(current.cancelCalls,0);
  assert.equal(ui.state.dictation.recording,true);assert.equal(ui.state.dictation.seconds,0);assert.equal(ui.state.dictation.error,'');assert.equal(ui.calls.length,0);
});

function imageAsset(id='image'){return{id,width:128,height:128,dataUrl:`data:${id}`};}
function understandingReceipt(assetId,prompt,answer='IMAGE ANSWER'){return{...receipt({assetId,prompt},answer),key:'understanding'};}
function geometryReceipt(assetId,id='geometry'){return{id,key:'geometry',input:{assetId},depthDataUrl:`data:${id}-depth`,
  geometryPreview:{points:[-1,-1,1,1,1,2],colors:[255,20,0,0,30,255],validPixelCount:100,displayedPointCount:2,depthMin:1,depthMax:2},result:{width:128,height:128,totalMs:2}};}

test('editing an image question clears its answer without replacing the input and hides receipts for other images',()=>{
  const ui=createUi();ui.state.route='understanding';const u=ui.state.understanding;
  u.asset=imageAsset('first');u.prompt='Question A';u.receipt=understandingReceipt('first','Question A','OLD IMAGE ANSWER');ui.render();
  const input=ui.node('#understanding-prompt'),page=ui.node('#main').innerHTML;
  ui.inputField('understanding-prompt','Question B');
  assert.equal(u.receipt,null);assert.equal(ui.node('#understanding-prompt'),input);assert.equal(ui.node('#main').innerHTML,page);
  assert.doesNotMatch(ui.node('#understanding-results').innerHTML,/OLD IMAGE ANSWER/);
  u.receipt=understandingReceipt('different-image','Question B','STALE IMAGE ANSWER');assert.doesNotMatch(ui.renderUnderstanding(),/STALE IMAGE ANSWER/);
});

test('a vision-language answer cannot populate a changed question even when inference finishes successfully',async()=>{
  const pending=deferred(),ui=createUi({understand:()=>pending.promise});ui.state.route='understanding';
  ui.state.understanding.asset=imageAsset('first');ui.state.understanding.prompt='Question A';
  const running=ui.click('understand');ui.inputField('understanding-prompt','Question B');
  pending.resolve(understandingReceipt('first','Question A','LATE ANSWER'));await running;
  assert.equal(ui.state.understanding.receipt,null);assert.doesNotMatch(ui.node('#main').innerHTML,/LATE ANSWER/);
});

for(const slot of ['understanding','geometry']){
  test(`${slot} rejects late inference after cancellation and an image replacement`,async()=>{
    const pending=deferred(),requestName=slot==='understanding'?'understand':'geometry';
    const ui=createUi({[requestName]:()=>pending.promise});ui.state.route=slot;const item=ui.state[slot];
    item.asset=imageAsset('first');if(slot==='understanding')item.prompt='Question';
    item.receipt=slot==='understanding'?understandingReceipt('first','Question','OLD ANSWER'):geometryReceipt('first','old');
    const running=ui.click(requestName);assert.equal(item.receipt,null,'Rerunning must immediately clear the old output');
    await ui.cancel();item.asset=imageAsset('replacement');
    pending.resolve(slot==='understanding'?understandingReceipt('first','Question','CANCELLED ANSWER'):geometryReceipt('first','cancelled'));
    await running;assert.equal(item.receipt,null);assert.equal(item.asset.id,'replacement');assert.equal(ui.state.busy,null);
    assert.doesNotMatch(ui.node('#main').innerHTML,/CANCELLED ANSWER|data:cancelled-depth|data:old-depth/);
  });

  test(`${slot} keeps only the newest decoded input and preserves the other image slots`,async()=>{
    const first=deferred(),second=deferred(),registered=[];
    const ui=createUi({imageAsset:async request=>{registered.push(request);return imageAsset(`new-${request.slot}`);}},
      {createImageBitmap:file=>file.name==='first'?first.promise:second.promise});ui.state.route=slot;
    for(const name of ['vision','understanding','geometry'])ui.state[name].asset=imageAsset(`original-${name}`);
    ui.state[slot].receipt={id:'old-result'};
    const old=ui.loadImage({name:'first',size:100},slot);assert.equal(ui.state[slot].asset,null);assert.equal(ui.state[slot].receipt,null);
    const latest=ui.loadImage({name:'second',size:100},slot);
    const a={...bitmap(11),width:800,height:400},b={...bitmap(22),width:800,height:400};
    second.resolve(b);await latest;first.resolve(a);await old;
    assert.equal(registered.length,1);assert.equal(registered[0].slot,slot);assert.equal(Buffer.from(registered[0].rgbaBase64,'base64')[0],22);
    assert.equal(registered[0].width,slot==='geometry'?512:448);assert.equal(registered[0].height,slot==='geometry'?256:224);
    assert.equal(ui.state[slot].asset.id,`new-${slot}`);assert.equal(a.closed,true);assert.equal(b.closed,true);
    for(const name of ['vision','understanding','geometry'].filter(name=>name!==slot))assert.equal(ui.state[name].asset.id,`original-${name}`);
  });

  test(`${slot} cancellation during image decode cannot restore the image or call its backend`,async()=>{
    const pending=deferred(),registered=[];
    const ui=createUi({imageAsset:async request=>registered.push(request)},{createImageBitmap:()=>pending.promise});ui.state.route=slot;
    const loading=ui.loadImage({name:'pending',size:100},slot);await ui.cancel();
    const decoded={...bitmap(11),width:128,height:128};pending.resolve(decoded);await loading;
    assert.equal(registered.length,0);assert.equal(decoded.closed,true);assert.equal(ui.state[slot].asset,null);assert.equal(ui.state[slot].receipt,null);
  });
}

test('depth input rejects an unsupported aspect ratio and releases its decoded bitmap',async()=>{
  const decoded={...bitmap(5),width:1200,height:200},registered=[];
  const ui=createUi({imageAsset:async request=>registered.push(request)},{createImageBitmap:async()=>decoded});ui.state.route='geometry';
  await ui.loadImage({size:100},'geometry');assert.equal(registered.length,0);assert.equal(decoded.closed,true);
  assert.match(ui.state.geometry.error,/aspect ratio/);assert.equal(ui.state.geometry.asset,null);
});

test('replacement depth inputs share pending voice shutdown and decode only the latest image afterward',async()=>{
  const stopping=deferred(),decoded=[],registered=[];let stopCalls=0;
  const ui=createUi({stopVoice:()=>{stopCalls++;return stopping.promise},imageAsset:async request=>{registered.push(request);return imageAsset('new');}},
    {createImageBitmap:async file=>{decoded.push(file.name);return{...bitmap(5),width:128,height:128};}});
  ui.state.route='geometry';ui.state.voice.active=true;
  const first=ui.loadImage({name:'first',size:100},'geometry'),second=ui.loadImage({name:'second',size:100},'geometry');
  assert.equal(stopCalls,1);assert.equal(decoded.length,0);assert.equal(registered.length,0);
  stopping.resolve();await Promise.all([first,second]);
  assert.deepEqual(decoded,['second']);assert.equal(registered.length,1);assert.equal(registered[0].slot,'geometry');assert.equal(ui.state.busy,null);
});

test('cancelling image import during voice shutdown prevents its later decoding',async()=>{
  const stopping=deferred(),decoded=[];
  const ui=createUi({stopVoice:()=>stopping.promise},{createImageBitmap:async file=>{decoded.push(file.name);return{...bitmap(5),width:128,height:128};}});
  ui.state.route='understanding';ui.state.voice.active=true;
  const loading=ui.loadImage({name:'cancelled',size:100},'understanding');await ui.cancel();stopping.resolve();await loading;
  assert.equal(decoded.length,0);assert.equal(ui.state.understanding.asset,null);assert.equal(ui.state.busy,null);
});

test('point-cloud viewers are disposed across renders, navigation and replacement images',async()=>{
  const instances=[];class GeometryView{constructor(){this.closed=false;instances.push(this)}getView(){return{yaw:.2,pitch:.1,zoom:1.5}}dispose(){this.closed=true}}
  const ui=createUi({imageAsset:async()=>imageAsset('new')},{GeometryView,createImageBitmap:async()=>({...bitmap(5),width:128,height:128})});ui.state.route='geometry';
  ui.state.geometry.asset=imageAsset();ui.state.geometry.receipt=geometryReceipt('image');ui.render();
  assert.equal(instances.length,1);ui.render();assert.equal(instances[0].closed,true);assert.equal(instances.length,2);assert.equal(ui.state.geometry.camera.yaw,.2);
  await ui.loadImage({size:100},'geometry');assert.equal(instances[1].closed,true);assert.equal(ui.state.geometry.camera,null);assert.equal(ui.state.geometry.receipt,null);
  ui.state.geometry.receipt=geometryReceipt('new');ui.render();ui.navigate('home');assert.equal(instances[2].closed,true);
});

test('geometry rendering hides output whose source image no longer matches',()=>{
  const ui=createUi();ui.state.geometry.asset=imageAsset('new');ui.state.geometry.receipt=geometryReceipt('old','stale');
  assert.doesNotMatch(ui.renderGeometry(),/data:stale-depth|id="geometry-canvas"/);
});

function pointCloudHarness(){
  const events=new Map(),frames=new Map(),drawn=[],observers=[];let frameId=0;
  const drawing={setTransform(){},clearRect(){drawn.length=0},fillRect(x,y,width,height){drawn.push({x,y,width,height,color:this.fillStyle})}};
  const canvas={clientWidth:400,clientHeight:300,width:0,height:0,getContext:()=>drawing,
    classList:{add(){},remove(){}},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    setPointerCapture(){},hasPointerCapture:()=>false,releasePointerCapture(){}};
  const context=vm.createContext({window:{devicePixelRatio:1},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class{constructor(){this.closed=false;observers.push(this)}observe(){}disconnect(){this.closed=true}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/geometry-view.js'),'utf8'),context);
  return{View:context.window.GeometryView,canvas,events,frames,drawn,observers,flush(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}}};
}

test('point-cloud rotation changes the projection of actual points without mutating their coordinates or colors',()=>{
  const h=pointCloudHarness(),preview={points:[-1,-.5,1,.5,1,3,1,0,2],colors:[255,0,20,0,255,30,20,40,255]},original=JSON.stringify(preview);
  const viewer=new h.View(h.canvas,preview);h.flush();assert.equal(h.drawn.length,3);const front=JSON.stringify(h.drawn);
  viewer.rotate(.3,.1);h.flush();assert.notEqual(JSON.stringify(h.drawn),front);assert.equal(JSON.stringify(preview),original);
  assert.deepEqual(h.drawn.map(point=>point.color).sort(),['rgb(0,255,30)','rgb(20,40,255)','rgb(255,0,20)']);
  let prevented=false;h.events.get('keydown')({key:'Home',preventDefault(){prevented=true}});h.flush();assert.equal(prevented,true);assert.equal(JSON.stringify(h.drawn),front);
  viewer.zoom(1.5);assert.equal(h.frames.size,1);viewer.dispose();assert.equal(h.frames.size,0);assert.equal(h.events.size,0);assert.equal(h.observers[0].closed,true);
});

test('point-cloud preview rejects invalid geometry and normalized colors outside its RGB-byte contract',()=>{
  const h=pointCloudHarness();
  assert.throws(()=>new h.View(h.canvas,{points:[NaN,0,1],colors:[255,0,0]}),/invalid point-cloud preview/);
  assert.throws(()=>new h.View(h.canvas,{points:[0,0,1],colors:[.5,.1,.2]}),/invalid point-cloud preview/);
  assert.throws(()=>new h.View(h.canvas,{points:[0,0,1,1,1,1],colors:[255,0,0]}),/invalid point-cloud preview/);
  assert.equal(h.events.size,0);assert.equal(h.frames.size,0);
});
