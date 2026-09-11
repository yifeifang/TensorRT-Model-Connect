'use strict';
const api=window.showcase,$=selector=>document.querySelector(selector);
const state={catalog:null,status:null,route:'home',busy:null,serial:0,presentation:false,
  dictation:{audio:null,url:null,language:'en',context:'A concise, natural work message',recording:false,seconds:0,asr:null,refined:null,error:''},
  reasoning:{input:'',direct:null,thinking:null,error:''},embedding:{query:'',documents:'',receipt:null,error:''},vision:{asset:null,point:null,receipt:null,error:''},
  understanding:{asset:null,prompt:'',receipt:null,error:''},geometry:{asset:null,receipt:null,camera:null,previewError:'',error:''},
  voice:{active:false,starting:false,desired:false,muted:false,mode:'disconnected',rows:[],epoch:-1,sequence:-1,assistantEpoch:-1,error:'',serial:0}};
let audio=null,recorder=null,toastTimer,geometryViewer=null,voiceStopping=null;
const paths={understanding:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M17 2h5v5"/>',geometry:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5M12 12v10M7 5l10 6v9"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',dictation:'<rect x="5" y="2" width="6" height="12" rx="3"/><path d="M2 9v3a6 6 0 0 0 12 0V9M8 18v4M4 22h8M17 6h5M17 11h5M17 16h5"/>',reasoning:'<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="M12 8v4H5v3M12 12h7v3"/>',embedding:'<path d="M3 3v18h18"/><circle cx="8" cy="16" r="1.4"/><circle cx="10" cy="13" r="1.4"/><circle cx="7" cy="12" r="1.4"/><circle cx="17" cy="6" r="1.4"/><circle cx="20" cy="8" r="1.4"/><circle cx="16" cy="10" r="1.4"/>',vision:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M5 17l4-6 4 4 3-5 4 7M14 7h1"/><path d="M10 8v6M7 11h6"/>',voice:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',expand:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',mute:'<path d="M3 9h3l5-4v14l-5-4H3zM16 8l6 8M22 8l-6 8"/>'};
const icon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]||paths.grid}</svg>`;
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const spec=id=>state.catalog.capabilities.find(c=>c.id===id);
const modelLabel=key=>({asr:'Speech recognition',reasoning:'Reasoning model',refine:'Reasoning model',embedding:'Embedding model',vision:'Segmentation model',voice:'Speech model',understanding:'Vision-language model',geometry:'Geometry model'}[String(key).split(':')[0]]||'Local model');
const readableError=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
const seconds=ms=>Number.isFinite(ms)?`${(ms/1000).toFixed(ms<10000?2:1)} s`:'—';
const disabled=(allowRecording=false)=>state.busy||(!allowRecording&&state.dictation.recording)?'disabled':'';
const inputDisabled=(id,allowRecording=false)=>(state.busy&&!(state.busy.phase==='input'&&state.busy.id===id))||(!allowRecording&&state.dictation.recording)?'disabled':'';
const sampleAvailable=name=>state.status?.samples?.[name]!==false;
const empty=text=>`<div class="stage-empty">${text}</div>`;
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function panel(title,model,body,extra=''){return`<section class="cap-panel"><div class="cap-panel-head"><h2>${title}</h2><small>${escape(model)}</small></div><div class="cap-panel-body">${body}</div>${extra}</section>`;}
function modelBadges(c){return`<div class="model-badges">${c.models.map(m=>`<span>${escape(m)}</span>`).join('')}</div>`;}
function header(c){return`<div class="cap-title"><div><span class="eyebrow">${c.english}</span><h1>${c.title}</h1><p>${c.modality}</p></div><button class="secondary-button" data-action="info">About this capability ↗</button></div><div class="flow-strip">${c.stages.map((s,i)=>`${i?'<i>→</i>':''}<span><b>0${i+1}</b>${escape(s)}</span>`).join('')}</div>`;}
function footer(c){return`<p class="core-proof"><strong>Build with this capability: </strong>${escape(c.reference)} <button class="small-link" data-action="info">Explore the capability ↗</button></p>`;}
function metrics(receipt){if(!receipt)return'';const r=receipt.result;return`<div class="stage-meta"><b>${escape(modelLabel(receipt.key))}</b><span>LOCAL GPU · LIVE</span><span>Inference ${seconds(r.totalMs)}</span>${Number.isFinite(r.tokens)?`<span>${r.tokens} tokens</span>`:''}${Number.isFinite(r.audioSeconds)?`<span>Audio ${r.audioSeconds.toFixed(2)} s</span>`:''}<button class="small-link" data-action="export" data-id="${receipt.id}" data-format="json">Export JSON ↗</button></div>`;}
function outputSummary(receipt){
  const r=receipt.result;
  return`<div class="output-summary"><span class="completion-pill ${receipt.complete===false?'partial':''}">${receipt.complete===false?'Output limit reached':receipt.complete===true?'Answer complete':'Output received'}</span><div class="output-stats"><div><strong>${seconds(r.totalMs)}</strong><span>Inference time</span></div>${Number.isFinite(r.tokens)?`<div><strong>${Number(r.tokens).toLocaleString('en-US')}</strong><span>Generated tokens</span></div>`:''}${receipt.reasoning?`<div><strong>${receipt.reasoning.length.toLocaleString('en-US')}</strong><span>Reasoning characters</span></div>`:''}</div></div>`;
}
function reasoningResult(receipt){
  if(!receipt)return empty('Run the model to see its output here.');
  return`${outputSummary(receipt)}${!receipt.complete?'<div class="error-box">The model reached its output limit before completing an answer. Its generated reasoning is preserved below. Try a shorter question.</div>':''}<div class="model-result">${escape(receipt.answer)}</div>${receipt.reasoning?`<details class="reasoning-details"><summary>View generated reasoning · ${receipt.reasoning.length} characters</summary><div class="thinking-text">${escape(receipt.reasoning)}</div></details>`:''}${metrics(receipt)}`;
}
function reasoningComparison(){const r=state.reasoning;return`<div class="reasoning-column reasoning-direct">${panel('Direct answer','THINKING OFF',reasoningResult(r.direct?.input===r.input?r.direct:null))}</div><div class="reasoning-column reasoning-thinking">${panel('Answer with thinking','THINKING ON',reasoningResult(r.thinking?.input===r.input?r.thinking:null))}</div>`;}
function setReasoningInput(value){
  state.reasoning.input=value;state.reasoning.direct=null;state.reasoning.thinking=null;
  const comparison=$('.model-comparison');if(comparison)comparison.innerHTML=reasoningComparison();
}
const embeddingDocuments=()=>state.embedding.documents.split('\n').map(v=>v.trim()).filter(Boolean);
function matchingEmbedding(){const e=state.embedding,r=e.receipt;return r?.input?.query===e.query&&JSON.stringify(r.input.documents)===JSON.stringify(embeddingDocuments())?r:null;}
function vectorChart(vector){
  const values=vector.slice(0,24),maximum=Math.max(...values.map(v=>Math.abs(v)),1e-8);
  return`<div class="vector-chart"><div class="vector-chart-heading"><strong>The query, as numbers</strong><span>First ${values.length} dimensions</span></div><svg viewBox="0 0 480 116" role="img" aria-label="Signed values of the first ${values.length} query vector dimensions. Bars extend above or below zero; height is relative to the largest absolute value shown."><line x1="14" y1="52" x2="466" y2="52" stroke="#b9cccd" stroke-width="1"/>${values.map((v,i)=>{const height=Math.abs(v)/maximum*39,x=20+i*18.5;return`<g><title>Dimension ${i+1}: ${Number(v).toFixed(6)}</title><rect x="${x}" y="${v>=0?52-height:52}" width="11" height="${height}" rx="2" fill="${v>=0?'#288b9a':'#9a68ba'}"/>${[0,5,11,17,23].includes(i)?`<text x="${x+5.5}" y="109" text-anchor="middle" fill="#7b8c89" font-size="10">${String(i+1).padStart(2,'0')}</text>`:''}</g>`;}).join('')}</svg><div class="vector-chart-legend"><span><i class="positive"></i>Positive</span><span><i class="negative"></i>Negative</span><small>Scale ±${maximum.toFixed(4)} · zero at center</small></div></div>`;
}
function setEmbeddingInput(field,value){
  state.embedding[field]=value;state.embedding.receipt=null;
  // Only replace output nodes: typing must retain the input element and caret.
  const vectors=$('#embedding-vectors'),results=$('#embedding-results');
  if(vectors)vectors.innerHTML='';
  if(results)results.innerHTML=panel('Ranked by meaning','COSINE SIMILARITY',empty('Input changed. Generate new vectors to update the matches.'));
}
function beginInput(id,label){
  if(state.busy&&!(state.busy.phase==='input'&&state.busy.id===id)){toast('Finish or cancel the current inference first.');return null;}
  const serial=++state.serial;state.busy={id,label,phase:'input'};state[id].error='';return serial;
}
function renderNav(){
  $('#app-nav').innerHTML=state.catalog.capabilities.map((c,i)=>`<button class="nav-app ${state.route===c.id?'active':''}" data-action="app" data-id="${c.id}" ${state.route===c.id?'aria-current="page"':''}>${icon(c.id)}<span class="nav-app-en">${c.title}</span><span class="nav-count">${String(i+1).padStart(2,'0')}</span></button>`).join('');
  $('.nav-home').classList.toggle('active',state.route==='home');$('.nav-home .nav-count').textContent=String(state.catalog.capabilities.length).padStart(2,'0');$('#breadcrumb-current').textContent=state.route==='home'?'Overview':spec(state.route).title;
}
function navigate(id){
  if(id!=='home'&&!spec(id))return;
  if((state.dictation.recording||recorder)&&id!=='dictation')void cancel().catch(error=>toast(readableError(error)));
  state.route=id;renderNav();render();window.scrollTo({top:0});$('#main').focus({preventScroll:true});
}
function renderHome(){
  $('#main').innerHTML=`<section class="hero"><div><span class="eyebrow">THE MODEL CAPABILITY PLAYGROUND</span><h1>See what models<br><span>can do.</span></h1><p>Start with your voice, a question, or an image.<br>Explore what you can build with ModelConnect.</p></div><div class="hero-index"><strong>${String(state.catalog.capabilities.length).padStart(2,'0')}</strong><small>Independent model<br>capability demos</small></div></section><section class="cap-grid" aria-label="Model capabilities">${state.catalog.capabilities.map(c=>`<button class="cap-card app-card" data-action="app" data-id="${c.id}"><div class="cap-art">${icon(c.id)}<span class="flow-arrow">→</span><b>${{dictation:'ASR + THINKING',reasoning:'THINK / ANSWER',embedding:'384-D VECTOR',vision:'OBJECT MASK',voice:'GENERATED AUDIO',understanding:'IMAGE + QUESTION',geometry:'DEPTH + 3D POINTS'}[c.id]}</b></div><div class="cap-card-body"><span class="cap-type">${c.english}</span><h2>${c.title}</h2><p>${c.description}</p>${modelBadges(c)}</div></button>`).join('')}<div class="cap-note"><h3>Your next idea starts here.</h3><p>Each demo makes one capability tangible.<br>Your input. A local model. A visible result.</p><code>ModelConnect → Local model → GPU</code></div></section>`;
}
function renderDictation(){
  const d=state.dictation;
  const capture=`<div class="record-area ${d.recording?'recording':''}"><div class="record-meter" aria-hidden="true">${'<i></i>'.repeat(9)}</div><div class="record-clock" id="record-clock">${d.recording?d.seconds.toFixed(1)+' / 30.0 s':'Say something. Let the model listen.'}</div><button class="primary-button" data-action="record" ${disabled(true)}>${icon(d.recording?'stop':'dictation')}${d.recording?'Stop and transcribe':'Start recording'}</button></div><div class="language-row"><label for="asr-language">Recognition language</label><select id="asr-language" ${disabled()} ${d.recording?'disabled':''}><option value="en" ${d.language==='en'?'selected':''}>English</option></select></div><div class="cap-controls"><label class="secondary-button cap-upload">Import audio<input id="audio-file" type="file" accept="audio/*" hidden ${inputDisabled('dictation',true)}></label>${sampleAvailable('dictation-en.wav')?`<button class="secondary-button" data-action="sample-audio" data-language="en" ${inputDisabled('dictation')}>Try an audio sample</button>`:''}${sampleAvailable('dictation-correction.wav')?`<button class="secondary-button" data-action="sample-audio" data-language="en" data-example="correction" ${disabled()}>Try a spoken correction</button>`:''}</div>${d.url?`<audio class="audio-preview" src="${escape(d.url)}" controls></audio><div class="cap-controls"><button class="secondary-button" data-action="transcribe" ${disabled()}>Transcribe again</button><span class="input-hint">${d.audio.audioSeconds.toFixed(2)} s audio · 16 kHz mono</span></div>`:''}<p class="input-hint">0.1–30 seconds. Samples contain audio only; the model transcribes it live.</p>`;
  const asr=d.asr?`<div class="model-result asr-raw" id="asr-output">${escape(d.asr.result.text)}</div>${metrics(d.asr)}<p class="input-hint">This is the raw model transcription. Names or accents may be misrecognized; the original output is preserved.</p>`:empty('Send audio to the recognition model to see the raw transcription.');
  const refine=`<label class="field" for="dictation-context">Describe the intended style or context</label><input id="dictation-context" type="text" maxlength="500" value="${escape(d.context)}"><div class="cap-controls"><button class="primary-button" data-action="refine" ${disabled()} ${!d.asr?'disabled':''}>Apply thinking → Refine the text</button></div>${d.refined?reasoningResult(d.refined):empty('After transcription, call the reasoning model to interpret slips, spoken corrections, and intent.')}<p class="input-hint">The input is the actual transcription above. Compare both stages to see how two models work together.</p>`;
  return`<div class="cap-layout"><div class="cap-stack">${panel('Audio input','MIC / AUDIO FILE',capture)}</div><div class="cap-stack">${panel('01 · Raw transcription','Speech recognition',asr)}${panel('02 · Refined text','Reasoning model · Thinking',refine)}</div></div>`;
}
function renderReasoning(){const r=state.reasoning;return`${panel('Ask a question with constraints','Reasoning model',`<textarea id="reasoning-input" maxlength="3500">${escape(r.input)}</textarea><div class="cap-controls"><button class="secondary-button" data-action="reason-sample" ${disabled()}>Use the sample question</button><button class="secondary-button" data-action="reason" data-thinking="false" ${disabled()}>Direct answer</button><button class="primary-button" data-action="reason" data-thinking="true" ${disabled()}>Enable thinking</button></div><p class="input-hint">One model, one question, two thinking settings. Run each mode independently and compare the results.</p>`)}<div class="model-comparison">${reasoningComparison()}</div><p class="comparison-note">Compare the answers, constraints, and token use. More thinking takes additional computation and does not guarantee a correct answer. The sample has three conditions you can check yourself.</p>`;}
function renderEmbedding(){
  const e=state.embedding,r=matchingEmbedding(),vector=r?.result.vectors[0],top=r?.ranking[0];
  const vectors=r?panel('Actual model vectors',`${vector.length} dimensions · L2 normalized`,`${vectorChart(vector)}<details><summary>Inspect the exact values</summary><p class="input-hint">First 24 query dimensions (export for the full vector):</p><pre class="vector-preview">${escape(vector.slice(0,24).map(v=>v.toFixed(5)).join(', '))}</pre></details><p class="input-hint">Norm ${Math.sqrt(vector.reduce((s,v)=>s+v*v,0)).toFixed(6)} · Mean pooling + L2</p>`):'';
  const matches=r?`${top?`<div class="match-summary"><div><span>CLOSEST CANDIDATE</span><strong>D${top.index+1}</strong></div><div><strong>${top.score.toFixed(3)}</strong><span>Cosine similarity</span></div></div>`:''}<div id="embedding-ranking">${r.ranking.map((item,i)=>`<div class="similarity-row"><span class="similarity-rank">${String(i+1).padStart(2,'0')}</span><div><p>D${item.index+1} · ${escape(item.text)}</p><div class="similarity-bar"><i data-score="${item.score}"></i></div></div><span class="similarity-score">${item.score.toFixed(3)}</span></div>`).join('')}</div>${metrics(r)}<p class="input-hint">Scores are cosine similarities between actual vectors. They measure similarity, not probability.</p><details open><summary>Compare all inputs in the similarity matrix</summary><div class="matrix-scroll"><table class="similarity-matrix"><thead><tr><th></th>${r.matrix.map((_,i)=>`<th>${i?'D'+i:'Q'}</th>`).join('')}</tr></thead><tbody>${r.matrix.map((row,i)=>`<tr><th>${i?'D'+i:'Q'}</th>${row.map(score=>`<td data-similarity="${score}" title="${score.toFixed(6)}">${score.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`:empty('Run the model to rank candidates by how closely their meaning matches the query.');
  return`<div class="cap-layout embedding-workbench"><div>${panel('Enter a query and candidate text','Embedding model',`<label class="field" for="embedding-query">Query</label><input id="embedding-query" type="text" maxlength="1000" value="${escape(e.query)}"><label class="field spaced" for="embedding-documents">Candidate text, one item per line (2–10 items)</label><textarea id="embedding-documents" maxlength="10000">${escape(e.documents)}</textarea><div class="cap-controls"><button class="secondary-button" data-action="embedding-sample" ${disabled()}>Use the sample text</button><button class="primary-button" data-action="embed" ${disabled()}>Generate vectors and match</button></div><p class="input-hint">The same model encodes each query and candidate into a vector, using the appropriate input prefix.</p>`)}<div id="embedding-vectors">${vectors}</div></div><div id="embedding-results">${panel('Ranked by meaning','COSINE SIMILARITY',matches)}</div></div>`;
}
function renderVision(){const v=state.vision;return`<div class="cap-layout"><div>${panel('Click an object in the image','IMAGE + ONE POINT',`<div class="cap-controls"><label class="secondary-button cap-upload">Import image<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden ${inputDisabled('vision')}></label><button class="secondary-button" data-action="vision-sample" ${inputDisabled('vision')}>Load the sample image</button></div>${v.asset?`<div class="vision-canvas" id="vision-input"><img src="${v.asset.dataUrl}" alt="Click the object you want to segment" draggable="false">${v.receipt?`<img class="mask-layer" src="${v.receipt.maskDataUrl}" alt="Model-generated segmentation mask">`:''}${v.point?'<span class="point-marker" id="point-marker"></span>':''}</div><p class="vision-note">${v.asset.width} × ${v.asset.height} · Each click generates a new mask from one point</p>`:empty('Load an image, then click an object.')}<p class="input-hint">Try the white car first, then click the sky. Watch the predicted region change with your input.</p>`)}${v.receipt?metrics(v.receipt):''}</div><div>${panel('Transparent cutout','Segmentation model',v.receipt?`<div class="checkerboard"><img id="vision-cutout" src="${v.receipt.cutoutDataUrl}" alt="Transparent cutout generated from the actual model mask"></div><div class="stage-meta"><b>Model score ${Number(v.receipt.result.score).toFixed(3)}</b><span>Candidate ${Number(v.receipt.result.maskIndex)+1} / 3</span><span>Inference ${seconds(v.receipt.result.totalMs)}</span></div><div class="cap-controls"><button class="secondary-button" data-action="export" data-id="${v.receipt.id}" data-format="cutout">Export cutout PNG</button><button class="secondary-button" data-action="export" data-id="${v.receipt.id}" data-format="mask">Export mask PNG</button><button class="secondary-button" data-action="export" data-id="${v.receipt.id}" data-format="json">Inference record</button></div><p class="input-hint">The model predicts the mask; the app uses it to create transparency. The score estimates mask quality, which you can inspect visually.</p>`:empty('The model predicts an object boundary from the image and your click. The highest-scoring mask produces this cutout.'))}</div></div>`;}
function renderVoice(){const v=state.voice;return`<section class="workbench voice-workbench"><section class="panel"><div class="panel-header"><h2>Speech in ⇄ Speech out</h2><small>SPEECH MODEL</small></div><div class="voice-stage"><div id="voice-ring" class="voice-ring"><div class="voice-bars">${'<i></i>'.repeat(9)}</div></div><h2 class="voice-status" id="voice-status"></h2><p id="voice-instruction"></p></div><div class="voice-controls"><button class="primary-button" id="voice-toggle" data-action="voice-toggle" ${disabled()}></button><button class="icon-button" id="voice-mute" data-action="voice-mute" aria-label="Mute microphone"></button><button class="icon-button" data-action="voice-reset" aria-label="Reset conversation">${icon('reset')}</button></div><p class="voice-hint">Speak in English · 16 kHz input · 48 kHz generated audio<br>The model loads on demand. The first load may take a few moments.</p></section><section class="panel"><div class="panel-header"><h2>Model text and speech output</h2><button class="small-link" data-action="export-voice">Export transcript</button></div><div id="voice-error"></div><div class="transcript-list" id="transcript-list" aria-live="polite"></div><div class="output-metrics"><span class="live-label"><i></i><span id="voice-live-label">IDLE</span></span><span>Speech model</span><span id="voice-audio-count">0 audio chunks</span></div></section></section>`;}
function matchingUnderstanding(){const u=state.understanding,r=u.receipt;return r&&r.input?.assetId===u.asset?.id&&r.input?.prompt===u.prompt?r:null;}
function matchingGeometry(){const g=state.geometry,r=g.receipt;return r&&r.input?.assetId===g.asset?.id?r:null;}
function understandingOutput(){
  const r=matchingUnderstanding();
  return panel('What the model sees','Vision-language model',r?`${outputSummary(r)}${r.complete===false?'<div class="error-box">The model reached its output limit. The partial answer is preserved below.</div>':''}<div class="model-result" id="understanding-answer">${escape(r.answer)}</div>${metrics(r)}<div class="cap-controls"><button class="secondary-button" data-action="export" data-id="${r.id}" data-format="text">Export answer</button></div><p class="input-hint">This answer comes from the image and question. Check it against the visible details.</p>`:empty('Ask a question to see how the model understands this image.'));
}
function setUnderstandingPrompt(value){
  const u=state.understanding;u.prompt=value;u.receipt=null;u.error='';
  const results=$('#understanding-results');if(results)results.innerHTML=understandingOutput();
}
function imageSource(slot){
  const item=state[slot],asset=item.asset;
  return`<div class="cap-controls"><label class="secondary-button cap-upload">Import image<input id="${slot}-image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden ${inputDisabled(slot)}></label>${slot==='geometry'&&sampleAvailable('geometry-house.jpg')?`<button class="secondary-button sample-preferred" data-action="geometry-indoor-sample" ${inputDisabled(slot)}>Indoor scene</button>`:''}<button class="secondary-button" data-action="${slot}-sample" ${inputDisabled(slot)}>${slot==='geometry'?'Outdoor scene':'Load the sample image'}</button></div>${asset?`<div class="source-image"><img id="${slot}-image" src="${asset.dataUrl}" alt="Source image for ${slot==='geometry'?'depth prediction':'image understanding'}" draggable="false"></div><p class="vision-note">${asset.width} × ${asset.height} · Model input</p>`:empty('Choose an image to give the model something to work with.')}`;
}
function renderUnderstanding(){
  const u=state.understanding;
  return`<div class="cap-layout understanding-workbench"><div>${panel('Image input','IMAGE',`${imageSource('understanding')}<p class="input-hint">Try asking about an object, its color, or the scene. Change the question while keeping the same image to explore what the model can perceive.</p>`)}</div><div class="cap-stack">${panel('Ask about the image','IMAGE + QUESTION',`<label class="field" for="understanding-prompt">Your question</label><textarea id="understanding-prompt" maxlength="320" placeholder="What do you notice in this image?">${escape(u.prompt)}</textarea><div class="cap-controls"><button class="secondary-button" data-action="understanding-question" ${disabled()}>Use the sample question</button><button class="primary-button" data-action="understand" ${disabled()} ${!u.asset?'disabled':''}>Understand the image</button></div><p class="input-hint">Ask a short question in English. The model receives both the image and your words.</p>`)}<div id="understanding-results">${understandingOutput()}</div></div></div>`;
}
function renderGeometry(){
  const g=state.geometry,r=matchingGeometry(),p=r?.geometryPreview;
  const depth=r?`<div class="depth-image"><img id="geometry-depth" src="${r.depthDataUrl}" alt="Predicted depth represented as a color heatmap"></div><div class="depth-legend"><span>Near</span><i aria-hidden="true"></i><span>Far</span></div><p class="input-hint">${p.depthScale==='inverse-depth'?'Inverse-depth':'Linear-depth'} color scale · Display range ${Number(p.depthMin).toPrecision(3)}–${Number(p.depthMax).toPrecision(3)} · 1st–99th percentile</p><div class="cap-controls"><button class="secondary-button" data-action="export" data-id="${r.id}" data-format="depth">Export depth PNG</button></div>`:empty('The model predicts depth from one image. Its actual output will appear here.');
  const cloud=r?`<div class="point-cloud"><canvas id="geometry-canvas" tabindex="0" role="img" aria-label="Interactive predicted point cloud. Drag to rotate, scroll to zoom, or use the arrow keys. Press Home to reset the view."></canvas></div><div id="geometry-preview-error">${g.previewError?`<div class="error-box">${escape(g.previewError)}</div>`:''}</div><div class="cap-controls cloud-controls"><button class="secondary-button" data-action="geometry-reset">Reset view</button><button class="secondary-button" data-action="geometry-zoom" data-direction="in" aria-label="Zoom in on the point cloud">+</button><button class="secondary-button" data-action="geometry-zoom" data-direction="out" aria-label="Zoom out of the point cloud">−</button><button class="secondary-button" data-action="export" data-id="${r.id}" data-format="points">Export points PLY</button></div><p class="input-hint">Drag to rotate · Scroll to zoom<br>${Number(p.displayedPointCount).toLocaleString('en-US')} displayed points from ${Number(p.validPixelCount).toLocaleString('en-US')} valid image pixels.</p>`:empty('A sampled point cloud will show the model’s predicted 3D structure.');
  return`<div class="geometry-layout"><div>${panel('Source image','ONE IMAGE',`${imageSource('geometry')}<div class="cap-controls"><button class="primary-button" data-action="geometry" ${disabled()} ${!g.asset?'disabled':''}>Predict depth and geometry</button></div><p class="input-hint">Use a landscape or portrait image between 1:2 and 2:1. The model input is resized to a maximum of 512 pixels per side.</p>`)}</div><div>${panel('Predicted depth','DEPTH MAP',depth)}</div><div>${panel('Predicted point cloud','3D PREVIEW',cloud)}</div></div>${r?metrics(r):''}<p class="comparison-note">These are model predictions from a single image, not measured dimensions. The preview uses real predicted points and source colors; rotate it to inspect the estimated structure.</p>`;
}
function disposeGeometryView(preserve=true){if(!geometryViewer)return;if(preserve)state.geometry.camera=geometryViewer.getView();geometryViewer.dispose();geometryViewer=null;}
function mountGeometryView(){
  const r=matchingGeometry(),canvas=$('#geometry-canvas');if(!r||!canvas)return;
  try{geometryViewer=new window.GeometryView(canvas,r.geometryPreview,state.geometry.camera||{});}
  catch(error){state.geometry.previewError=readableError(error);$('#geometry-preview-error').innerHTML=`<div class="error-box">${escape(state.geometry.previewError)}</div>`;}
}
async function understandImage(){
  const u=state.understanding;if(!u.asset)throw new Error('Choose an image first.');if(!u.prompt.trim())throw new Error('Enter a question about the image.');
  if(state.busy||state.dictation.recording){toast('Finish or cancel the current action first.');return;}
  const assetId=u.asset.id,prompt=u.prompt;u.receipt=null;
  await run('understanding','Understanding the image',()=>api.understand({assetId,prompt}),r=>{if(u.asset?.id===assetId&&u.prompt===prompt)u.receipt=r;});
}
async function predictGeometry(){
  const g=state.geometry;if(!g.asset)throw new Error('Choose an image first.');if(state.busy||state.dictation.recording){toast('Finish or cancel the current action first.');return;}
  const assetId=g.asset.id;disposeGeometryView(false);g.receipt=null;g.camera=null;g.previewError='';
  await run('geometry','Predicting depth and geometry',()=>api.geometry({assetId}),r=>{if(g.asset?.id===assetId)g.receipt=r;});
}
function render(){
  disposeGeometryView();
  $('#main').classList.toggle('gallery-page',state.route==='home');
  if(state.route==='home'){renderHome();return;}
  const c=spec(state.route),body={dictation:renderDictation,reasoning:renderReasoning,embedding:renderEmbedding,vision:renderVision,voice:renderVoice,understanding:renderUnderstanding,geometry:renderGeometry}[state.route]();
  $('#main').innerHTML=`${header(c)}${state.busy?`<div class="busy-banner"><span class="stage-running"><span class="spinner"></span></span><span id="busy-detail">${escape(state.busy.label)}</span><button data-action="cancel">Cancel</button></div>`:''}${state[state.route]?.error?`<div class="error-box">${escape(state[state.route].error)}</div>`:''}${body}${footer(c)}`;
  document.querySelectorAll('[data-score]').forEach(el=>el.style.width=`${Math.max(0,Number(el.dataset.score))*100}%`);
  document.querySelectorAll('[data-similarity]').forEach(el=>el.style.backgroundColor=`rgba(138,177,90,${.08+Math.max(0,Number(el.dataset.similarity))*.62})`);
  if(state.route==='vision'&&state.vision.point){const p=state.vision.point,a=state.vision.asset;$('#point-marker').style.left=`${p.x/a.width*100}%`;$('#point-marker').style.top=`${p.y/a.height*100}%`;}
  if(state.route==='voice'){updateVoice();renderTranscript();}
  if(state.route==='geometry')mountGeometryView();
}
async function run(id,label,work,accept){
  if(state.busy){toast('Finish or cancel the current inference first.');return;}
  if(state.dictation.recording){toast('Stop recording before running another model.');return;}
  const stopPreviousVoice=state.voice.active||state.voice.starting||voiceStopping;
  const serial=++state.serial;state.busy={id,label};state[id].error='';render();
  try{if(stopPreviousVoice)await stopVoice();if(serial!==state.serial)return;const result=await work();if(serial===state.serial)accept(result);}
  catch(error){if(serial===state.serial)state[id].error=readableError(error);}
  finally{if(serial===state.serial){state.busy=null;await refreshStatus();render();}}
}
async function cancel(){
  const serial=++state.serial,current=recorder,wasRecording=state.dictation.recording||current;
  recorder=null;state.dictation.recording=false;
  if(wasRecording){state.busy={id:'dictation',label:'Closing the microphone',phase:'record-cancel'};render();}
  try{await Promise.all([current?.cancel(),api.cancel()]);}
  finally{if(serial===state.serial){state.busy=null;await refreshStatus();render();}}
}
async function transcribe(){const d=state.dictation;if(!d.audio)return;if(state.busy||d.recording){toast(d.recording?'Stop recording before transcribing.':'Finish or cancel the current inference first.');return;}d.asr=null;d.refined=null;await run('dictation','Transcribing audio',()=>api.transcribe({...d.audio,language:d.language}),r=>d.asr=r);}
function audioBlob(samples){const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b),text=(s,p)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));text('RIFF',0);v.setUint32(4,b.byteLength-8,true);text('WAVEfmt ',8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text('data',36);v.setUint32(40,samples.length*2,true);samples.forEach((x,i)=>v.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true));return new Blob([b],{type:'audio/wav'});}
function acceptAudio(decoded){const d=state.dictation;if(d.url)URL.revokeObjectURL(d.url);d.audio=decoded;d.url=URL.createObjectURL(audioBlob(decoded.samples));d.asr=null;d.refined=null;d.seconds=decoded.audioSeconds;render();}
async function finishRecording(){
  const current=recorder;if(!current||state.busy)return;
  const d=state.dictation,serial=++state.serial;
  state.busy={id:'dictation',label:'Finishing the recording',phase:'record-finish'};render();
  try{
    const decoded=await current.finish();if(serial!==state.serial||recorder!==current)return;
    recorder=null;d.recording=false;acceptAudio(decoded);state.busy=null;await transcribe();
  }catch(error){
    await current.cancel().catch(()=>{});
    if(serial===state.serial){recorder=null;d.recording=false;state.busy=null;if(error.name!=='AbortError')d.error=readableError(error);render();}
  }
}
async function toggleRecord(){
  if(state.busy){toast('Finish or cancel the current action first.');return;}
  if(recorder){await finishRecording();return;}
  const d=state.dictation,serial=++state.serial,stopPreviousVoice=state.voice.active||state.voice.starting||voiceStopping;
  state.busy={id:'dictation',label:'Starting the microphone',phase:'record-start'};d.error='';d.recording=true;d.seconds=0;render();
  let current;
  try{
    if(stopPreviousVoice)await stopVoice();if(serial!==state.serial)return;
    current=new window.DictationAudio({
      onLevel:level=>{if(recorder===current&&state.route==='dictation')document.querySelectorAll('.record-meter i').forEach((el,i)=>el.style.height=`${6+Math.min(1,level*5)*(30-Math.abs(4-i)*4)}px`);},
      onDuration:s=>{if(recorder!==current)return;d.seconds=s;if(state.route==='dictation'&&$('#record-clock'))$('#record-clock').textContent=`${s.toFixed(1)} / 30.0 s`;},
      onLimit:()=>{if(recorder===current)void finishRecording();},
      onError:error=>{if(recorder!==current)return;d.error=readableError(error);void cancel().catch(failure=>toast(readableError(failure)));}
    });recorder=current;
    await current.start();
    if(serial!==state.serial||recorder!==current){await current.cancel();return;}
    state.busy=null;render();
  }catch(error){
    if(current)await current.cancel().catch(()=>{});
    if(serial===state.serial){if(recorder===current)recorder=null;d.recording=false;state.busy=null;if(error.name!=='AbortError')d.error=readableError(error);render();}
  }
}
async function loadAudio(source,language){
  const serial=beginInput('dictation','Reading and decoding audio');if(serial===null)return;
  const d=state.dictation,current=recorder;recorder=null;d.recording=false;
  if(d.url)URL.revokeObjectURL(d.url);d.url=null;d.audio=null;d.asr=null;d.refined=null;d.seconds=0;if(language)d.language=language;render();
  try{
    if(current)await current.cancel();if(serial!==state.serial)return;
    const file=typeof source==='function'?await source():source;if(serial!==state.serial)return;
    const decoded=await window.DictationAudio.decodeFile(file);if(serial!==state.serial)return;
    acceptAudio(decoded);state.busy=null;await transcribe();
  }catch(error){if(serial===state.serial){d.error=readableError(error);state.busy=null;render();}}
  finally{if(serial===state.serial&&state.busy?.phase==='input'){state.busy=null;render();}}
}
async function loadImage(source,slot='vision'){
  if(!['vision','understanding','geometry'].includes(slot))return;
  const serial=beginInput(slot,'Reading and decoding image');if(serial===null)return;
  if(slot==='geometry')disposeGeometryView(false);
  const v=state[slot];v.asset=null;v.receipt=null;if(slot==='vision')v.point=null;if(slot==='geometry'){v.camera=null;v.previewError='';}render();let bitmap;
  try{
    if(state.voice.active||state.voice.starting||voiceStopping)await stopVoice();if(serial!==state.serial)return;
    const file=typeof source==='function'?await source():source;if(serial!==state.serial)return;
    if(file.size>20*1024*1024)throw new Error('Image files must be 20 MB or smaller.');
    bitmap=await createImageBitmap(file);if(serial!==state.serial)return;
    const aspect=bitmap.width/bitmap.height,limit={vision:1024,understanding:448,geometry:512}[slot];
    if(slot!=='vision'&&(Math.min(bitmap.width,bitmap.height)<64))throw new Error('Use an image at least 64 pixels wide and high.');
    if(slot==='geometry'&&(aspect<.5||aspect>2))throw new Error('Use an image with an aspect ratio between 1:2 and 2:1 for depth prediction.');
    const scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    if(slot!=='vision'&&Math.min(canvas.width,canvas.height)<64)throw new Error('The resized image is too narrow. Choose an image with a less extreme aspect ratio.');
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
    const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    const asset=await api.imageAsset({slot,width:canvas.width,height:canvas.height,rgbaBase64:btoa(binary)});if(serial!==state.serial)return;
    v.asset=asset;state.busy=null;render();
  }catch(error){if(serial===state.serial){v.error=readableError(error);state.busy=null;render();}}
  finally{bitmap?.close();if(serial===state.serial&&state.busy?.phase==='input'){state.busy=null;render();}}
}
async function startVoice(){
  if(state.busy)return;if(recorder){await recorder.cancel();recorder=null;state.dictation.recording=false;}
  const v=state.voice,serial=++v.serial;v.active=false;v.starting=true;v.desired=true;v.muted=false;v.error='';v.rows=[];v.epoch=-1;v.sequence=-1;v.assistantEpoch=-1;v.audioChunks=0;updateVoice();renderTranscript();
  const current=new window.ShowcaseAudio(api,{onLevel:level=>{if(state.route==='voice'&&v.active&&!v.muted)document.querySelectorAll('.voice-bars i').forEach((el,i)=>el.style.height=`${7+Math.min(1,level*5)*(48-Math.abs(4-i)*7)}px`);},onError:error=>{v.error=readableError(error);void stopVoice();}});audio=current;
  try{if(voiceStopping)await voiceStopping;if(serial!==v.serial)return;await current.start();if(serial!==v.serial){await current.stop();return;}await api.startVoice();if(serial!==v.serial)return;v.starting=false;v.active=true;current.setReady(true);updateVoice();}
  catch(error){if(serial===v.serial){v.error=readableError(error);await stopVoice();}}
}
async function stopVoice(){
  if(voiceStopping)return voiceStopping;
  const v=state.voice;v.serial++;v.desired=false;v.active=false;v.starting=false;v.mode='disconnected';const previous=audio;audio=null;
  const stopping=(async()=>{try{if(previous){previous.setReady(false);await previous.stop();}await api.stopVoice();}catch(error){v.error=readableError(error);}finally{for(const row of v.rows)row.final=true;updateVoice();renderTranscript();}})();
  voiceStopping=stopping;try{await stopping;}finally{if(voiceStopping===stopping)voiceStopping=null;}
}
function updateVoice(){if(state.route!=='voice'||!$('#voice-ring'))return;const v=state.voice;$('#voice-ring').classList.toggle('active',v.active);$('#voice-ring').classList.toggle('speaking',v.mode==='thinking');$('#voice-status').textContent=v.starting?'Loading the speech model':v.active?(v.muted?'Microphone muted':v.mode==='thinking'?'The model is responding':'Listening'):'Talk with the model';$('#voice-instruction').textContent=v.starting?'The model is loading locally. You can speak when it is ready.':v.active?'Audio, transcripts, and replies run through a local model.':'Select Start session to enable the microphone.';$('#voice-toggle').innerHTML=`${icon(v.active||v.starting?'stop':'voice')}<span>${v.starting?'Cancel loading':v.active?'End session':'Start session'}</span>`;$('#voice-toggle').disabled=Boolean(state.busy);$('#voice-mute').disabled=!v.active;$('#voice-mute').innerHTML=icon(v.muted?'mute':'voice');$('#voice-mute').setAttribute('aria-label',v.muted?'Unmute microphone':'Mute microphone');$('#voice-live-label').textContent=v.starting?'LOADING':v.active?'LIVE · LOCAL':v.rows.length?'ENDED':'IDLE';$('#voice-audio-count').textContent=`${v.audioChunks||0} audio chunks`;$('#voice-error').innerHTML=v.error?`<div class="error-box">${escape(v.error)}</div>`:'';$('[data-action="voice-reset"]').disabled=!v.active;}
function renderTranscript(){if(state.route!=='voice'||!$('#transcript-list'))return;const box=$('#transcript-list'),near=box.scrollTop+box.clientHeight>=box.scrollHeight-70;box.innerHTML=state.voice.rows.length?state.voice.rows.map(r=>`<article class="transcript-row ${r.role} ${r.final?'':'pending'}"><div class="transcript-author"><i></i>${r.role==='user'?'YOU / TRANSCRIPT':'MODEL / REPLY'}</div><p class="transcript-text">${escape(r.text)}</p></article>`).join(''):'<div class="transcript-empty">Your transcript and the model reply will appear here as you speak.</div>';if(near)box.scrollTop=box.scrollHeight;}
function voiceEvent(event){
  const v=state.voice;if(Number.isSafeInteger(event.epoch)&&Number.isSafeInteger(event.sequence)){if(event.epoch<v.epoch||(event.epoch===v.epoch&&event.sequence<v.sequence))return;if(event.epoch>v.epoch){v.epoch=event.epoch;v.sequence=-1;}v.sequence=Math.max(v.sequence,event.sequence);}
  if(event.type==='audio'){if(v.desired){audio?.play(event);v.audioChunks=(v.audioChunks||0)+1;updateVoice();}return;}
  if(event.type==='flush'){audio?.flush();return;}
  if(event.type==='error'){v.error=event.message||'Speech inference failed.';if(event.fatal!==false)void stopVoice();else updateVoice();return;}
  if(event.type==='state'){v.mode=event.state;if(event.state==='listening'&&v.desired){v.active=true;v.starting=false;audio?.setReady(true);}if(event.state==='disconnected'&&!v.starting){v.active=false;if(v.desired){v.desired=false;const previous=audio;audio=null;void previous?.stop();}}updateVoice();return;}
  if(event.type==='transcript'&&typeof event.text==='string'&&['user','assistant'].includes(event.role)){
    if(event.role==='assistant'&&Number.isSafeInteger(event.epoch)&&event.epoch!==v.assistantEpoch){for(const old of v.rows)if(old.role==='assistant')old.final=true;v.assistantEpoch=event.epoch;}
    let row=[...v.rows].reverse().find(r=>r.role===event.role&&!r.final);if(!row){const last=v.rows.at(-1);if(event.final&&last?.role===event.role&&last.text===event.text)return;row={role:event.role,text:'',final:false};v.rows.push(row);}row.text=event.delta?row.text+event.text:event.text;row.final=event.final===true;if(v.rows.length>200)v.rows.splice(0,v.rows.length-200);renderTranscript();updateVoice();
  }
}
function updateStatus(){const s=state.status;if(!s)return;const busy=['loading','generating'].includes(s.state);$('#sidebar-dot').className=`status-dot ${busy?'busy':''}`;$('#sidebar-status').textContent=busy?s.state==='loading'?'Loading a local model':'Running local inference':s.state==='voice'?'Speech session active':`${s.models?.filter(m=>m.installed).length||0} local models ready`;const g=s.gpu;$('#footer-status').textContent=Number.isFinite(g?.usedMb)?`Local GPU · ${(g.usedMb/1024).toFixed(1)} GB total memory in use`:'Real input · Local models · Visible results';if($('#busy-detail'))$('#busy-detail').textContent=s.state==='loading'?`Loading ${modelLabel(s.loadedModel).toLowerCase()}`:state.busy?.label||'Running model inference';}
async function refreshStatus(){state.status=await api.getStatus();updateStatus();}
function showDialog(title,body){$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=body;if(!$('#info-dialog').open)$('#info-dialog').showModal();}
function showInfo(){const c=spec(state.route);showDialog(c.title,`${modelBadges(c)}<div class="dialog-section"><h3>The model capability</h3><p>${escape(c.description)}</p></div><div class="dialog-section"><h3>What this demo shows</h3><p>${escape(c.boundary)}</p></div><div class="dialog-section"><h3>Build with this capability</h3><p>${escape(c.reference)}</p></div>`);}
async function showRuntime(){await refreshStatus();showDialog('ModelConnect · Local runtime',`<p class="dialog-small">Each capability runs through a native ModelConnect interface. Models load on demand, with one model held in GPU memory at a time.</p><div class="model-inventory">${state.status.models.map(m=>`<div class="model-inventory-item"><strong>${modelLabel(m.key)}</strong><small>${m.installed?'Installed':'Not installed'}${state.status.loadedModel===m.key?' · Currently loaded':''}</small></div>`).join('')}</div>`);}
async function present(){state.presentation=!state.presentation;await api.setFullscreen(state.presentation);document.body.classList.toggle('presentation',state.presentation);$('#present-label').textContent=state.presentation?'Exit presentation · Esc':'Present';}
document.addEventListener('input',event=>{const id=event.target.id,value=event.target.value;if(id==='dictation-context')state.dictation.context=value;else if(id==='reasoning-input')setReasoningInput(value);else if(id==='embedding-query')setEmbeddingInput('query',value);else if(id==='embedding-documents')setEmbeddingInput('documents',value);else if(id==='understanding-prompt')setUnderstandingPrompt(value);});
document.addEventListener('change',async event=>{try{if(event.target.id==='asr-language')state.dictation.language=event.target.value;else if(event.target.id==='audio-file'&&event.target.files[0])await loadAudio(event.target.files[0]);else if(event.target.id==='image-file'&&event.target.files[0])await loadImage(event.target.files[0]);else if(event.target.id==='understanding-image-file'&&event.target.files[0])await loadImage(event.target.files[0],'understanding');else if(event.target.id==='geometry-image-file'&&event.target.files[0])await loadImage(event.target.files[0],'geometry');}catch(error){state[state.route].error=readableError(error);render();}});
document.addEventListener('click',async event=>{
  const vision=event.target.closest('#vision-input');
  if(vision&&!state.busy){const box=vision.getBoundingClientRect(),a=state.vision.asset,p={x:Math.min(a.width-1,Math.max(0,(event.clientX-box.left)/box.width*a.width)),y:Math.min(a.height-1,Math.max(0,(event.clientY-box.top)/box.height*a.height))};state.vision.point=p;state.vision.receipt=null;await run('vision','Predicting the object boundary',()=>api.segment({assetId:a.id,...p}),r=>state.vision.receipt=r);return;}
  const b=event.target.closest('button[data-action]');if(!b||b.disabled)return;
  try{
    switch(b.dataset.action){
      case'home':navigate('home');break;case'app':navigate(b.dataset.id);break;case'info':showInfo();break;case'runtime':await showRuntime();break;case'close-dialog':$('#info-dialog').close();break;case'present':await present();break;case'cancel':await cancel();break;
      case'record':await toggleRecord();break;case'transcribe':await transcribe();break;
      case'sample-audio':{const language=b.dataset.language,name=b.dataset.example==='correction'?'dictation-correction.wav':'dictation-en.wav';await loadAudio(async()=>{const response=await fetch(`fixtures/${name}`);if(!response.ok)throw new Error('Could not load the audio sample.');return new File([await response.blob()],name);},language);break;}
      case'refine':{const d=state.dictation;await run('dictation','Interpreting the raw transcription',()=>api.refine({asrId:d.asr.id,context:d.context}),r=>d.refined=r);break;}
      case'reason-sample':setReasoningInput(spec('reasoning').sample);render();break;
      case'reason':{const thinking=b.dataset.thinking==='true',input=state.reasoning.input;if(!input.trim())throw new Error('Enter a question first.');await run('reasoning',thinking?'Generating an answer with thinking':'Generating a direct answer',()=>api.reason({input,thinking}),r=>{if(r.input===state.reasoning.input)state.reasoning[thinking?'thinking':'direct']=r;});break;}
      case'embedding-sample':setEmbeddingInput('query',spec('embedding').sample);setEmbeddingInput('documents',spec('embedding').documents.join('\n'));render();break;
      case'embed':{const e=state.embedding,query=e.query,documentInput=e.documents,documents=embeddingDocuments();await run('embedding','Generating semantic vectors',()=>api.embed({query,documents}),r=>{if(e.query===query&&e.documents===documentInput)e.receipt=r;});break;}
      case'vision-sample':{await loadImage(async()=>{const response=await fetch('fixtures/vision-car.jpeg');if(!response.ok)throw new Error('Could not load the sample image.');return new File([await response.blob()],'vision-car.jpeg');});break;}
      case'understanding-sample':case'geometry-sample':case'geometry-indoor-sample':{const slot=b.dataset.action==='understanding-sample'?'understanding':'geometry',filename=b.dataset.action==='geometry-indoor-sample'?'geometry-house.jpg':'vision-car.jpeg';await loadImage(async()=>{const response=await fetch(`fixtures/${filename}`);if(!response.ok)throw new Error('Could not load the sample image.');return new File([await response.blob()],filename);},slot);break;}
      case'understanding-question':setUnderstandingPrompt(spec('understanding')?.sample||'Describe the main object and its surroundings.');render();break;
      case'understand':await understandImage();break;
      case'geometry':await predictGeometry();break;
      case'geometry-reset':geometryViewer?.reset();break;
      case'geometry-zoom':geometryViewer?.zoom(b.dataset.direction==='in'?1.2:1/1.2);break;
      case'export':{const result=await api.exportResult({id:b.dataset.id,format:b.dataset.format});if(result.path)toast('Model result exported.');break;}
      case'voice-toggle':if(state.voice.active||state.voice.starting)await stopVoice();else await startVoice();break;
      case'voice-mute':state.voice.muted=!state.voice.muted;audio?.setMuted(state.voice.muted);updateVoice();break;
      case'voice-reset':audio?.flush();await api.resetVoice();state.voice.rows=[];state.voice.error='';renderTranscript();updateVoice();break;
      case'export-voice':{const result=await api.exportResult({kind:'voice',format:'text'});if(result.path)toast('Session transcript exported.');break;}
    }
  }catch(error){if(state[state.route])state[state.route].error=readableError(error);toast(readableError(error));}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.presentation&&!$('#info-dialog').open){event.preventDefault();void present();}});
async function init(){state.catalog=await api.getCatalog();state.reasoning.input=spec('reasoning').sample;state.embedding.query=spec('embedding').sample;state.embedding.documents=spec('embedding').documents.join('\n');state.understanding.prompt=spec('understanding')?.sample||'Describe the main object and its surroundings.';document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));api.onEvent(packet=>{if(packet.type==='engine'){state.status={...state.status,...packet,loadedModel:packet.kind};updateStatus();}else if(packet.type==='gpu'){state.status={...state.status,gpu:packet};updateStatus();}else if(packet.type==='voice')voiceEvent(packet.event);else if(packet.type==='runtime-error'){toast(packet.detail);if(packet.kind==='voice'){state.voice.error=packet.detail;void stopVoice();}}});renderNav();render();await refreshStatus();setInterval(()=>void refreshStatus().catch(()=>{}),10000);}
void init().catch(error=>{$('#main').textContent=`Could not start the showcase: ${readableError(error)}`;});
