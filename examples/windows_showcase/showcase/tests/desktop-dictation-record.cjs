'use strict';
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {auditPage}=require('./desktop-english.cjs');
const root=path.resolve(__dirname,'../..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
  const application=await _electron.launch({executablePath:path.join(root,'dist/ModelConnect Showcase/ModelConnect Showcase.exe'),env,timeout:30000});
  const receipt={passed:false,startedAt:new Date().toISOString(),scope:'Prerecorded correction speech replaces microphone only; production recording controls, WebAudio/worklet, 16k capture, Whisper and Qwen Thinking remain actual.'};let page;
  try{
    page=await application.firstWindow();page.setDefaultTimeout(20000);await page.waitForSelector('.app-card');const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.evaluate(async b64=>{
      const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),test={tracks:[]};window.dictationTest=test;
      navigator.mediaDevices.getUserMedia=async()=>{
        const context=new AudioContext({sampleRate:48000}),destination=context.createMediaStreamDestination(),silence=context.createConstantSource();
        silence.offset.value=0;silence.connect(destination);silence.start();test.context=context;test.destination=destination;test.buffer=await context.decodeAudioData(bytes.buffer);test.tracks.push(...destination.stream.getTracks());await context.resume();return destination.stream;
      };
    },fs.readFileSync(path.join(root,'showcase/renderer/fixtures/dictation-correction.wav')).toString('base64'));
    await page.click('#app-nav [data-id="dictation"]');await page.selectOption('#asr-language','en');await page.click('[data-action="record"]');
    await page.waitForFunction(()=>state.dictation.recording&&recorder?.state==='recording'&&recorder.capture?.ready);
    await page.evaluate(()=>new Promise(resolve=>{const s=dictationTest.context.createBufferSource();s.buffer=dictationTest.buffer;s.connect(dictationTest.destination);s.onended=resolve;s.start(dictationTest.context.currentTime+.2);}));
    await page.waitForTimeout(300);await page.click('[data-action="record"]');
    await page.waitForFunction(()=>!state.busy&&(state.dictation.error||state.dictation.asr),null,{timeout:240000});
    let d=await page.evaluate(()=>state.dictation);assert(!d.error,d.error);assert(!d.recording);assert(d.audio.samples.length>16000*12&&d.audio.samples.length<16000*20);assert(d.audio.samples.some(v=>Math.abs(v)>.01));assert.equal(d.audio.sampleRate,16000);
    assert(await page.evaluate(()=>dictationTest.tracks.every(t=>t.readyState==='ended')));
    for(const fact of [/Alex/i,/Thursday/i,/Friday/i,/laptop/i])assert.match(d.asr.result.text,fact);
    receipt.asr=d.asr;receipt.capture={sampleRate:d.audio.sampleRate,audioSeconds:d.audio.audioSeconds,samples:d.audio.samples.length,tracksEnded:true};
    await page.fill('#dictation-context','A concise message addressed to Alex.');await page.click('[data-action="refine"]');
    await page.waitForFunction(()=>!state.busy&&(state.dictation.error||state.dictation.refined),null,{timeout:240000});d=await page.evaluate(()=>state.dictation);assert(!d.error,d.error);assert(d.refined.complete);assert.equal(d.refined.input.asrId,receipt.asr.id);
    for(const fact of [/Alex/i,/Friday/i,/laptop/i,/(3|three)\s*(:00)?\s*p\.?m\.?/i])assert.match(d.refined.answer,fact);
    assert(!/Thursday|Sorry|I mean/i.test(d.refined.answer),'The explicit spoken correction should resolve to Friday in the final message.');
    receipt.refined=d.refined;receipt.englishCheck=await auditPage(page,'Recorded correction and actual refined result');await page.screenshot({path:path.join(root,'logs/capabilities-dictation-correction.png'),fullPage:true});
    await page.evaluate(()=>dictationTest.context.close());assert.deepEqual(errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.stack;if(page&&!page.isClosed()){receipt.state=await page.evaluate(()=>({busy:state.busy,error:state.dictation.error,asr:state.dictation.asr,refined:state.dictation.refined})).catch(()=>null);await page.screenshot({path:path.join(root,'logs/capabilities-dictation-record-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
  finally{await application.close();fs.writeFileSync(path.join(root,'logs/capabilities-dictation-record.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:receipt.passed,capture:receipt.capture,asr:receipt.asr?.result.text,answer:receipt.refined?.answer,failure:receipt.failure}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
