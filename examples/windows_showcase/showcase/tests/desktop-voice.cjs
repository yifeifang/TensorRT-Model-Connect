'use strict';
const {_electron} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const {auditPage}=require('./desktop-english.cjs');
const root = path.resolve(__dirname, '../..');
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
function wave(samples,rate=48000) {const b=Buffer.alloc(44+samples.length*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(32,34);b.write('data',36);b.writeUInt32LE(samples.length*4,40);samples.forEach((v,i)=>b.writeFloatLE(v,44+i*4));return b;}
(async () => {
  const application = await _electron.launch({executablePath:path.join(root,'dist/ModelConnect Showcase/ModelConnect Showcase.exe'),env,timeout:30000});
  const receipt={passed:false,startedAt:new Date().toISOString(),input:'Single-sentence capital-city-of-France question replaces microphone only; actual packaged UI, capture worklet, IPC, ModelConnect Nemotron, GPU and playback remain unmodified.'};
  let page;
  try {
    page=await application.firstWindow();page.setDefaultTimeout(20000);await page.waitForSelector('.app-card');
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    await page.evaluate(async b64=>{
      const t={events:[],samples:[],inputSamples:[],inputFrames:[],tracks:[],playbacks:0};window.voiceTest=t;
      const captureStart=ShowcaseAudio.prototype.start;
      ShowcaseAudio.prototype.start=function(...args){
        const api=this.api;
        this.api={...api,sendAudio(packet){
          t.inputFrames.push({at:Date.now(),count:packet.samples.length,sampleRate:packet.sampleRate,rms:Math.sqrt(packet.samples.reduce((s,v)=>s+v*v,0)/packet.samples.length)});
          t.inputSamples.push(...packet.samples);
          return api.sendAudio(packet);
        }};
        return captureStart.apply(this,args);
      };
      const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
      showcase.onEvent(packet=>{if(packet.type!=='voice')return;const e={...packet.event,at:Date.now()};if(e.type==='audio'){e.count=e.samples.length;e.rms=Math.sqrt(e.samples.reduce((s,v)=>s+v*v,0)/e.samples.length);t.samples.push(...e.samples);delete e.samples;}t.events.push(e);});
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){if(this.context!==t.context)t.playbacks++;return start.apply(this,args);};
      navigator.mediaDevices.getUserMedia=async()=>{
        const c=new AudioContext({sampleRate:48000}),d=c.createMediaStreamDestination();const s=c.createConstantSource();s.offset.value=0;s.connect(d);s.start();
        t.context=c;t.destination=d;t.buffer=await c.decodeAudioData(bytes.buffer);t.tracks.push(...d.stream.getTracks());await c.resume();return d.stream;
      };
    },fs.readFileSync(path.join(__dirname,'fixtures/voice-question-single.wav')).toString('base64'));
    await page.click('#app-nav [data-id="voice"]');
    const started=Date.now();await page.click('#voice-toggle');
    await page.waitForFunction(()=>voiceTest.events.some(e=>e.type==='state'&&e.state==='listening')||voiceTest.events.some(e=>e.type==='error'),null,{timeout:180000});
    const initial=await page.evaluate(()=>voiceTest.events);assert(!initial.some(e=>e.type==='error'),JSON.stringify(initial));
    receipt.guardianPids=await application.evaluate(()=>process._getActiveHandles().filter(handle=>handle.spawnfile?.endsWith('modelconnect_process_host.exe')).map(handle=>handle.pid));
    assert.equal(receipt.guardianPids.length,1,'Voice inference must be owned by one Windows Job Object guardian');
    receipt.loadMs=Date.now()-started;console.log(`Voice loaded in ${receipt.loadMs}ms; feeding recorded question through the production microphone worklet.`);
    await page.evaluate(()=>{const s=voiceTest.context.createBufferSource();s.buffer=voiceTest.buffer;s.connect(voiceTest.destination);voiceTest.inputScheduledAt=Date.now()+8000;voiceTest.inputDuration=s.buffer.duration;s.start(voiceTest.context.currentTime+8);});
    await page.waitForFunction(()=>voiceTest.events.some(e=>e.type==='transcript'&&e.role==='assistant'&&e.final)||voiceTest.events.some(e=>e.type==='error'),null,{timeout:120000});
    await page.waitForTimeout(10000);
    receipt.events=await page.evaluate(()=>voiceTest.events);
    assert(!receipt.events.some(e=>e.type==='error'),JSON.stringify(receipt.events.filter(e=>e.type==='error')));
    assert(receipt.events.some(e=>e.type==='audio'&&e.rms>.001));
    assert(receipt.events.some(e=>e.type==='transcript'&&e.role==='user'&&e.text.length>5));
    receipt.playbacks=await page.evaluate(()=>voiceTest.playbacks);assert(receipt.playbacks>0);
    receipt.routeBeforeTranscriptCheck=await page.evaluate(()=>state.route);
    await page.click('#app-nav [data-id="voice"]');
    receipt.rendered=await page.locator('.transcript-text').allTextContents();
    const finalUsers=receipt.events.filter(e=>e.type==='transcript'&&e.role==='user'&&e.final).map(e=>e.text);
    const displayedUsers=await page.locator('.transcript-row.user:not(.pending) .transcript-text').allTextContents();assert.deepEqual(displayedUsers,finalUsers);
    assert(await page.locator('.transcript-row.user.pending').count()<=1,'One active user utterance may have at most one partial row.');
    receipt.englishCheck=await auditPage(page,'Live voice transcript and controls');
    await page.click('#voice-mute');assert.equal(await page.locator('#voice-mute').getAttribute('aria-label'),'Unmute microphone');
    await page.click('#voice-toggle');
    await page.waitForFunction(()=>!state.voice.active&&!state.voice.starting);
    let stoppedStatus;
    const stopDeadline=Date.now()+15000;
    do { stoppedStatus=await page.evaluate(()=>showcase.getStatus()); if(stoppedStatus.state==='idle')break; await page.waitForTimeout(100); } while(Date.now()<stopDeadline);
    assert.equal(stoppedStatus.state,'idle');
    for(const pid of receipt.guardianPids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'Stopping voice must reclaim the owned guardian process');
    assert(await page.evaluate(()=>voiceTest.tracks.every(t=>t.readyState==='ended')));
    await page.evaluate(()=>voiceTest.context.close());
    // Export large diagnostic arrays only after capture stops. Serialization by
    // the test runner must not manufacture gaps in the live microphone clock.
    receipt.capture=await page.evaluate(()=>({scheduledAt:voiceTest.inputScheduledAt,duration:voiceTest.inputDuration,frames:voiceTest.inputFrames}));
    fs.writeFileSync(path.join(root,'logs/capabilities-voice-output.wav'),wave(await page.evaluate(()=>voiceTest.samples)));
    fs.writeFileSync(path.join(root,'logs/capabilities-voice-captured-input.wav'),wave(await page.evaluate(()=>voiceTest.inputSamples),16000));
    assert(receipt.capture.frames.every(f=>f.sampleRate===16000&&f.count===320));
    assert(receipt.capture.frames.some(f=>f.rms>.001));
    const gaps=receipt.capture.frames.slice(1).map((f,i)=>f.at-receipt.capture.frames[i].at).sort((a,b)=>a-b);
    receipt.capture.timing={p99GapMs:gaps[Math.floor(gaps.length*.99)],maxGapMs:gaps.at(-1),audioSeconds:receipt.capture.frames.length*.02,wallSeconds:(receipt.capture.frames.at(-1).at-receipt.capture.frames[0].at)/1000};
    assert(receipt.capture.timing.p99GapMs<60,'Microphone delivery p99 must stay ahead of the native 80 ms silence deadline.');
    assert(receipt.capture.timing.maxGapMs<80,'Microphone capture must not stall across the native 80 ms silence deadline.');
    await page.screenshot({path:path.join(root,'logs/capabilities-voice.png'),fullPage:true});
    assert.deepEqual(pageErrors,[]);receipt.pipelinePassed=true;
    receipt.answerCorrect=receipt.rendered.some(t=>/paris/i.test(t));
    assert(receipt.answerCorrect,'The real speech model did not answer the recorded France question correctly; preserve its actual output.');
    receipt.passed=true;
  }catch(error){receipt.failure=error.message;if(page&&!page.isClosed()){receipt.events=await page.evaluate(()=>voiceTest?.events).catch(()=>[]);await page.screenshot({path:path.join(root,'logs/capabilities-voice-failure.png')}).catch(()=>{});}throw error;}
  finally{await application.close();fs.writeFileSync(path.join(root,'logs/capabilities-desktop-voice.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:receipt.passed,loadMs:receipt.loadMs,playbacks:receipt.playbacks,failure:receipt.failure}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
