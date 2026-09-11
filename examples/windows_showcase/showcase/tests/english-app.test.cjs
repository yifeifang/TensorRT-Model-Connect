'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const catalog=require('../capabilities');
const {forbiddenBrands}=require('./desktop-english.cjs');
const rendererPath=path.join(__dirname,'../renderer');
const source=fs.readFileSync(path.join(rendererPath,'capabilities.js'),'utf8');
function assertPresentation(text,label){assert.doesNotMatch(text,/\p{Script=Han}/u,`${label}: English-only authored copy`);assert.doesNotMatch(text,forbiddenBrands,`${label}: capability names replace third-party branding`);}

test('public catalog presents seven distinct capabilities with English defaults and no product branding',()=>{
  assertPresentation(catalog.title,'Window title');
  assert.deepEqual(catalog.capabilities.map(capability=>capability.id),['dictation','reasoning','embedding','vision','understanding','geometry','voice']);
  const visibleFields=['title','english','modality','models','description','stages','reference','boundary','sample','documents'];
  for(const capability of catalog.capabilities){
    for(const field of visibleFields)if(capability[field]!==undefined)assertPresentation(JSON.stringify(capability[field]),`${capability.id}.${field}`);
  }
  const reasoning=catalog.capabilities.find(capability=>capability.id==='reasoning');assert.match(reasoning.sample,/Alice/);assert.match(reasoning.sample,/Ben/);assert.match(reasoning.sample,/Casey/);
  const embedding=catalog.capabilities.find(capability=>capability.id==='embedding');assert.equal(embedding.sample,'My laptop cannot get online.');assert.equal(embedding.documents.length,5);
});

test('active renderer and browser audio helpers contain no Chinese UI messages or Chinese sample route',()=>{
  for(const file of ['capabilities.html','capabilities.js','audio.js','dictation-audio.js','capture-worklet.js','geometry-view.js'])assert.doesNotMatch(fs.readFileSync(path.join(rendererPath,file),'utf8'),/\p{Script=Han}/u,`${file}: user-visible and error paths must be English`);
  assertPresentation(fs.readFileSync(path.join(rendererPath,'geometry-view.js'),'utf8'),'Point-cloud viewer controls and errors');
  assert.match(fs.readFileSync(path.join(rendererPath,'capabilities.html'),'utf8'),/<html\s+lang="en(?:-[^"]*)?"/);
  assert.doesNotMatch(source,/dictation-zh\.wav|data-language="zh"|value="zh"/,'The presentation must not offer a Chinese sample or language option');
});

test('rendered result metadata and runtime inventory cannot reveal raw native model names or paths',async()=>{
  const nodes=new Map();
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',hidden:false,style:{},classList:{toggle(){}},setAttribute(){},focus(){},showModal(){}});return nodes.get(selector);};
  const status={state:'ready',loadedModel:'reasoning',gpu:{name:'NVIDIA Test Device',usedMb:123,totalMb:32000,utilization:10},models:[
    {key:'asr',model:'Whisper Small',family:'whisper',task:'ITranscription',bundle:'C:/models/whisper-small.bundle',installed:true},
    {key:'reasoning',model:'Qwen3-4B',family:'qwen',task:'ITextGeneration',bundle:'C:/models/qwen3-4b.bundle',installed:true},
    {key:'embedding',model:'Multilingual E5 Small',family:'bert',task:'IEmbedding',bundle:'C:/models/e5-small.bundle',installed:true},
    {key:'vision',model:'SAM ViT-Base',family:'sam',task:'IPointPromptedSegmentation',bundle:'C:/models/sam-vit-base.bundle',installed:true},
    {key:'understanding',model:'Qwen2.5-VL-3B',family:'qwen_vl',task:'IImageTextGeneration',bundle:'C:/models/qwen-vl.bundle',installed:true},
    {key:'geometry',model:'MoGe',family:'moge',task:'IMonocularGeometry',bundle:'C:/models/moge.bundle',installed:true},
    {key:'voice',model:'Nemotron VoiceChat 11B',family:'nemotron_voicechat',task:'ISpeechSessionProvider',bundle:'C:/models/nemotron.bundle',installed:true}
  ]};
  const context=vm.createContext({window:{showcase:{getStatus:async()=>status},scrollTo(){}},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},setTimeout:()=>1,clearTimeout(){},console});
  vm.runInContext(source.replace(/\nvoid init\(\)\.catch[\s\S]*$/,'')+'\nglobalThis.englishUi={state,renderHome,renderDictation,renderReasoning,renderEmbedding,renderVision,renderUnderstanding,renderGeometry,renderVoice,showInfo,showRuntime,updateStatus};',context);
  const ui=context.englishUi;ui.state.catalog=catalog;ui.state.status=status;
  const reasoning=catalog.capabilities.find(capability=>capability.id==='reasoning'),embedding=catalog.capabilities.find(capability=>capability.id==='embedding');
  ui.state.reasoning.input=reasoning.sample;ui.state.embedding.query=embedding.sample;ui.state.embedding.documents=embedding.documents.join('\n');
  const modelResult=(key,model,input)=>({id:key,key,model,input,answer:'The answer is Ben, Casey, Alice.',reasoning:'Check each condition before selecting the valid order.',complete:true,result:{text:'Please send the report on Friday.',totalMs:10,tokens:20}});
  ui.state.dictation.asr=modelResult('asr','Whisper Small',{});ui.state.dictation.refined=modelResult('refine','Qwen3-4B',{});
  ui.state.reasoning.direct=modelResult('reasoning:false','Qwen3-4B',reasoning.sample);ui.state.reasoning.thinking=modelResult('reasoning:true','Qwen3-4B',reasoning.sample);
  ui.state.embedding.receipt={...modelResult('embedding','Multilingual E5 Small',{query:embedding.sample,documents:embedding.documents}),result:{totalMs:10,vectors:[Array(384).fill(1/Math.sqrt(384))]},matrix:[[1,.8],[.8,1]],ranking:[{index:0,text:embedding.documents[0],score:.8}]};
  ui.state.vision.asset={id:'asset',width:640,height:382,dataUrl:'data:image/png;base64,AA=='};ui.state.vision.receipt={...modelResult('vision','SAM ViT-Base',{}),result:{score:.98,maskIndex:1,totalMs:20},maskDataUrl:'data:image/png;base64,AA==',cutoutDataUrl:'data:image/png;base64,AA=='};
  ui.state.understanding.asset={id:'image-question',width:448,height:256,dataUrl:'data:image/png;base64,AA=='};ui.state.understanding.prompt='What color is the object?';
  ui.state.understanding.receipt=modelResult('understanding','Qwen2.5-VL-3B',{assetId:'image-question',prompt:ui.state.understanding.prompt});
  ui.state.geometry.asset={id:'geometry-image',width:512,height:256,dataUrl:'data:image/png;base64,AA=='};
  ui.state.geometry.receipt={...modelResult('geometry','MoGe',{assetId:'geometry-image'}),depthDataUrl:'data:image/png;base64,AA==',geometryPreview:{points:[0,0,1],colors:[255,0,0],validPixelCount:1,displayedPointCount:1,depthMin:1,depthMax:1}};
  ui.renderHome();
  assert.equal((node('#main').innerHTML.match(/class="cap-card app-card"/g)||[]).length,7);
  assert.match(node('#main').innerHTML,/<strong>07<\/strong>/);
  for(const [id,render]of [['dictation',ui.renderDictation],['reasoning',ui.renderReasoning],['embedding',ui.renderEmbedding],['vision',ui.renderVision],['understanding',ui.renderUnderstanding],['geometry',ui.renderGeometry],['voice',ui.renderVoice]]){
    ui.state.route=id;const html=render();if(html)assertPresentation(html,`${id} result surface`);ui.showInfo();assertPresentation(node('#dialog-content').innerHTML,`${id} details`);
  }
  await ui.showRuntime();
  for(const state of ['idle','loading','generating','voice','ready']){
    ui.state.status={...status,state,detail:'Qwen3-4B / TensorRT-RTX'};ui.updateStatus();
    for(const selector of ['#sidebar-status','#footer-status','#busy-detail'])assertPresentation(node(selector).textContent,`${state} ${selector}`);
  }
  for(const [selector,element]of nodes)assertPresentation(element.innerHTML+'\n'+element.textContent,selector);
  assert.doesNotMatch(node('#dialog-content').innerHTML,/C:\/models|\.bundle/,'Runtime details must not expose brand-bearing bundle paths');
});


test('source-only installs hide unavailable sample buttons while retaining import and recording',()=>{
  const context=vm.createContext({window:{showcase:{}},document:{querySelector:()=>({}),querySelectorAll:()=>[],addEventListener(){}},setTimeout:()=>1,clearTimeout(){},console});
  vm.runInContext(source.replace(/\nvoid init\(\)\.catch[\s\S]*$/,'')+'\nglobalThis.sampleUi={state,renderDictation,renderGeometry};',context);
  const ui=context.sampleUi;ui.state.catalog=catalog;ui.state.status={samples:{'dictation-en.wav':false,'dictation-correction.wav':false,'geometry-house.jpg':false}};
  const dictation=ui.renderDictation(),geometry=ui.renderGeometry();
  assert.doesNotMatch(dictation,/data-action="sample-audio"/);
  assert.match(dictation,/Start recording/);assert.match(dictation,/Import audio/);
  assert.doesNotMatch(geometry,/data-action="geometry-indoor-sample"/);
  assert.match(geometry,/Import image/);assert.match(geometry,/Outdoor scene/);
});
