'use strict';
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {auditPage}=require('./desktop-english.cjs');
const root=path.resolve(__dirname,'../..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
  const application=await _electron.launch({executablePath:path.join(root,'dist/ModelConnect Showcase/ModelConnect Showcase.exe'),env,timeout:30000});
  const receipt={passed:false,startedAt:new Date().toISOString(),scope:'Actual packaged UI, real Whisper/Qwen/E5/SAM ModelConnect inference, native input/output and exports. No model stubs.',checks:[],results:{}};let page;const guardianPids=new Set();
  try{
    page=await application.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.app-card');assert.equal(await page.locator('.app-card').count(),7);
    receipt.status=await page.evaluate(()=>showcase.getStatus());assert(receipt.status.models.every(m=>m.installed));assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
    receipt.englishChecks=[await auditPage(page,'Home')];await page.screenshot({path:path.join(root,'logs/capabilities-home.png')});
    // Wait using lexical state in the existing page, without injecting model output.
    async function waitResult(id,key){await page.waitForFunction(({id,key})=>!state.busy&&(state[id].error||state[id][key]),{id,key},{timeout:240000});const error=await page.evaluate(id=>state[id].error,id);assert(!error,error);}
    async function noteGuardian(){const pids=await application.evaluate(()=>process._getActiveHandles().filter(h=>h.spawnfile?.endsWith('modelconnect_process_host.exe')).map(h=>h.pid));assert.equal(pids.length,1);pids.forEach(pid=>guardianPids.add(pid));}
    async function exportTo(file,selector){fs.rmSync(file,{force:true});await application.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.click(selector);const deadline=Date.now()+5000;while(!fs.existsSync(file)&&Date.now()<deadline)await page.waitForTimeout(50);return fs.readFileSync(file);}
    await page.click('#app-nav [data-id="dictation"]');
    await page.click('[data-action="sample-audio"][data-language="en"]');await waitResult('dictation','asr');
    const asr=await page.evaluate(()=>state.dictation.asr);assert.match(asr.result.text,/project report/i);assert.match(asr.result.text,/Friday/i);assert.equal(asr.family,'whisper');assert.deepEqual(asr.result.segments,[]);
    receipt.results.asrEnglish=asr;assert.equal(await page.locator('#asr-output').innerText(),asr.result.text);await noteGuardian();
    await page.click('[data-action="refine"]');await waitResult('dictation','refined');
    const refined=await page.evaluate(()=>state.dictation.refined);assert.equal(refined.input.transcript,asr.result.text);assert.equal(refined.input.asrId,asr.id);assert(refined.thinking&&refined.reasoning&&refined.complete);assert(/Friday/i.test(refined.answer)&&/Monday/i.test(refined.answer));receipt.results.refined=refined;
    await page.locator('.reasoning-details summary').click();receipt.englishChecks.push(await auditPage(page,'Actual ASR and expanded Thinking result'));await page.locator('.reasoning-details summary').click();
    await page.screenshot({path:path.join(root,'logs/capabilities-asr-thinking.png'),fullPage:true});receipt.checks.push('Audio -> actual Whisper original -> separate Qwen Thinking -> fact-preserving answer');
    assert.equal(asr.input.language,'en');assert.equal(await page.locator('[data-action="sample-audio"][data-language="zh"]').count(),0);
    await page.click('#app-nav [data-id="reasoning"]');
    for(const thinking of [false,true]){await page.click(`[data-action="reason"][data-thinking="${thinking}"]`);await waitResult('reasoning',thinking?'thinking':'direct');}
    const pair=await page.evaluate(()=>({direct:state.reasoning.direct,thinking:state.reasoning.thinking}));assert.equal(pair.direct.input,pair.thinking.input);assert(!pair.direct.thinking&&pair.thinking.thinking);assert(pair.thinking.reasoning.length>100&&pair.thinking.complete);assert(/Ben[\s\S]{0,40}Casey[\s\S]{0,40}Alice/i.test(pair.thinking.answer));receipt.results.reasoning=pair;await noteGuardian();
    await page.locator('.reasoning-details summary').click();receipt.englishChecks.push(await auditPage(page,'Actual direct and Thinking comparison'));await page.locator('.reasoning-details summary').click();
    await page.screenshot({path:path.join(root,'logs/capabilities-reasoning.png'),fullPage:true});receipt.checks.push('Same Qwen model, actual thinking-mode switch, separate reasoning output, matching question');
    await page.click('#app-nav [data-id="embedding"]');await page.click('[data-action="embed"]');await waitResult('embedding','receipt');
    const embedded=await page.evaluate(()=>state.embedding.receipt);assert.equal(embedded.result.dimension,384);assert.equal(embedded.result.vectors.length,6);assert([0,1].includes(embedded.ranking[0].index));for(let i=0;i<embedded.matrix.length;i++)assert(Math.abs(embedded.matrix[i][i]-1)<1e-6);receipt.results.embedding=embedded;
    const vectorTitles=await page.locator('.vector-chart svg g title').allTextContents();assert.deepEqual(vectorTitles,embedded.result.vectors[0].slice(0,24).map((value,i)=>`Dimension ${i+1}: ${value.toFixed(6)}`));assert.equal(await page.locator('.vector-chart svg rect').count(),24);
    await noteGuardian();const exportedVectors=JSON.parse(await exportTo(path.join(root,'logs/capabilities-export-embedding.json'),'#embedding-results [data-format="json"]'));assert.deepEqual(exportedVectors.result.vectors,embedded.result.vectors);
    receipt.englishChecks.push(await auditPage(page,'Actual embedding vectors and ranking'));await page.screenshot({path:path.join(root,'logs/capabilities-embedding.png'),fullPage:true});
    await page.fill('#embedding-query','What ingredients do I need to cook tomato and egg noodles tonight?');const oldEmbeddingId=embedded.id;await page.click('[data-action="embed"]');
    await page.waitForFunction(id=>!state.busy&&(state.embedding.error||(state.embedding.receipt&&state.embedding.receipt.id!==id)),oldEmbeddingId,{timeout:240000});
    const changed=await page.evaluate(()=>state.embedding);assert(!changed.error,changed.error);assert.equal(changed.receipt.ranking[0].index,3);receipt.results.embeddingChangedQuery=changed.receipt;receipt.checks.push('Real 384D vectors, cosine matrix, changed meaning changes top-ranked passage');
    await page.click('#app-nav [data-id="vision"]');await page.click('[data-action="vision-sample"]');await page.waitForSelector('#vision-input img');
    const box=await page.locator('#vision-input').boundingBox();await page.locator('#vision-input').click({position:{x:box.width*430/640,y:box.height*225/382}});await waitResult('vision','receipt');
    const car=await page.evaluate(()=>state.vision.receipt),mask=Buffer.from(car.result.maskBase64,'base64');assert(mask.some(v=>v===255)&&mask.some(v=>v===0));assert(car.result.score>.8);assert(await page.locator('#vision-cutout').isVisible());receipt.results.visionCar=car;
    await noteGuardian();const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
    for(const format of ['cutout','mask']){const bytes=await exportTo(path.join(root,`logs/capabilities-export-${format}.png`),`[data-action="export"][data-format="${format}"]`);assert(bytes.subarray(0,8).equals(pngSignature));}
    receipt.englishChecks.push(await auditPage(page,'Actual image mask and cutout'));await page.screenshot({path:path.join(root,'logs/capabilities-vision.png'),fullPage:true});
    const skyBox=await page.locator('#vision-input').boundingBox();await page.locator('#vision-input').click({position:{x:skyBox.width*300/640,y:skyBox.height*20/382}});await waitResult('vision','receipt');const sky=await page.evaluate(()=>state.vision.receipt);assert.notEqual(sky.id,car.id);assert.notEqual(sky.result.maskBase64,car.result.maskBase64);receipt.results.visionSky=sky;receipt.checks.push('Actual SAM point prompt changes the mask; transparent PNG exported from model mask');
    await page.click('[data-action="info"]');assert(await page.locator('#info-dialog').isVisible());await page.click('[data-action="close-dialog"]');await page.click('[data-action="present"]');assert(await page.evaluate(()=>state.presentation));await page.keyboard.press('Escape');assert(!(await page.evaluate(()=>state.presentation)));
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1080,720));await page.click('.nav-home');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(root,'logs/capabilities-home-1080.png')});
    assert.deepEqual(errors,[]);receipt.errors=errors;receipt.passed=true;
  }catch(error){receipt.failure=error.stack;if(page&&!page.isClosed()){receipt.state=await page.evaluate(()=>({route:state.route,busy:state.busy,error:state[state.route]?.error})).catch(()=>null);await page.screenshot({path:path.join(root,'logs/capabilities-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
  finally{await application.close();receipt.guardianPids=[...guardianPids];receipt.guardiansExited=receipt.guardianPids.every(pid=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});if(!receipt.guardiansExited){receipt.passed=false;receipt.failure='An owned model process survived application close.';process.exitCode=1;}fs.writeFileSync(path.join(root,'logs/capabilities-desktop-verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks,guardiansExited:receipt.guardiansExited,failure:receipt.failure}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
