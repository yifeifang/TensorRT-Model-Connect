'use strict';
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {auditPage}=require('./desktop-english.cjs');
const root=path.resolve(__dirname,'../..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  const app=await _electron.launch({executablePath:path.join(root,'dist/ModelConnect Showcase/ModelConnect Showcase.exe'),env,timeout:30000});
  const receipt={passed:false,startedAt:new Date().toISOString(),scope:'Actual packaged UI, local ModelConnect image understanding and monocular geometry, changed inputs, point-cloud interaction, exports and owned runtime cleanup. No model outputs are injected.',checks:[],results:{}};
  const guardians=new Set();let page;
  try{
    page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForSelector('.app-card');assert.equal(await page.locator('.app-card').count(),7);
    async function waitResult(id){await page.waitForFunction(id=>!state.busy&&(state[id].error||state[id].receipt),id,{timeout:240000});assert.equal(await page.evaluate(id=>state[id].error,id),'');}
    async function rememberProcess(){for(const pid of await app.evaluate(()=>process._getActiveHandles().filter(p=>p.spawnfile?.endsWith('modelconnect_process_host.exe')).map(p=>p.pid)))guardians.add(pid);}
    async function screenshot(name){await page.locator('#toast').waitFor({state:'hidden'});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(root,'logs',name),fullPage:true});}
    async function exportTo(id,format){
      const extension={depth:'png',points:'ply',json:'json',text:'txt'}[format],file=path.join(root,`logs/expansion-${id}-${format}.${extension}`);
      if(fs.existsSync(file))fs.unlinkSync(file);
      await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
      await page.click(`[data-action="export"][data-format="${format}"]`);
      for(let attempt=0;attempt<100&&!fs.existsSync(file);attempt++)await page.waitForTimeout(50);
      return fs.readFileSync(file);
    }
    await page.click('#app-nav [data-id="geometry"]');await page.click('[data-action="geometry-sample"]');
    await page.waitForFunction(()=>state.geometry.asset&&!state.busy);const firstGeometryAsset=await page.evaluate(()=>state.geometry.asset.id);
    await page.click('[data-action="geometry"]');await waitResult('geometry');await rememberProcess();
    const geometry=await page.evaluate(()=>state.geometry.receipt);assert.equal(geometry.family,'moge');assert.equal(geometry.inference,'live-local');
    assert(geometry.geometryPreview.validPixelCount>1000);assert(geometry.geometryPreview.displayedPointCount>100);assert(geometry.geometryPreview.points.every(Number.isFinite));
    assert.equal(await page.locator('#geometry-preview-error').innerText(),'');assert(await page.locator('#geometry-depth').isVisible());
    const canvas=page.locator('#geometry-canvas');await canvas.scrollIntoViewIfNeeded();await page.waitForTimeout(100);
    const before=await canvas.evaluate(c=>c.toDataURL()),box=await canvas.boundingBox();
    await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:8});await page.mouse.up();await page.waitForTimeout(100);
    const after=await canvas.evaluate(c=>c.toDataURL());assert.notEqual(digest(before),digest(after),'Dragging must change the projection of real model points');
    await page.click('[data-action="geometry-zoom"][data-direction="in"]');await page.click('[data-action="geometry-reset"]');
    const depth=await exportTo('geometry','depth');assert(depth.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(depth.readUInt32BE(16),geometry.result.width);assert.equal(depth.readUInt32BE(20),geometry.result.height);
    const ply=(await exportTo('geometry','points')).toString('utf8');const headerCount=Number(ply.match(/element vertex (\d+)/)?.[1]);
    assert.equal(headerCount,geometry.geometryPreview.validPixelCount);const vertices=ply.split('end_header\n')[1].trim().split('\n');assert.equal(vertices.length,headerCount);
    const rawPoints=Buffer.from(geometry.result.pointsBase64,'base64'),mask=Buffer.from(geometry.result.maskBase64,'base64');let row=0;
    for(let i=0;i<mask.length;i++)if(mask[i]){const values=vertices[row++].split(' ').map(Number);assert.deepEqual(values.slice(0,3),[0,4,8].map(offset=>rawPoints.readFloatLE(i*12+offset)));}
    const exported=JSON.parse(await exportTo('geometry','json'));assert.equal(exported.result.pointsBase64,geometry.result.pointsBase64);assert.equal(exported.result.depthBase64,geometry.result.depthBase64);
    receipt.results.geometry={input:geometry.input,width:geometry.result.width,height:geometry.result.height,totalMs:geometry.result.totalMs,validPixels:headerCount,previewPoints:geometry.geometryPreview.displayedPointCount,depthSha256:digest(depth),pointDataSha256:digest(rawPoints)};
    receipt.checks.push(await auditPage(page,'Actual depth, point cloud and export controls'));await screenshot('capabilities-geometry.png');

    await page.click('#app-nav [data-id="understanding"]');await page.click('[data-action="understanding-sample"]');await page.waitForFunction(()=>state.understanding.asset&&!state.busy);
    await page.click('[data-action="understand"]');await waitResult('understanding');await rememberProcess();
    const first=await page.evaluate(()=>state.understanding.receipt);assert.equal(first.family,'qwen_vl');assert.match(first.answer,/white/i);assert.equal(first.complete,true);
    receipt.results.understandingColor={input:first.input,answer:first.answer,result:first.result};
    receipt.checks.push(await auditPage(page,'Actual image-conditioned answer'));
    await page.fill('#understanding-prompt','Is the car indoors or outdoors?');assert.equal(await page.locator('#understanding-answer').count(),0);
    await page.click('[data-action="understand"]');await waitResult('understanding');const changed=await page.evaluate(()=>state.understanding.receipt);
    assert.match(changed.answer,/outdoor|outside|open air/i);assert.notEqual(changed.id,first.id);assert.equal(changed.input.assetId,first.input.assetId);assert.notEqual(changed.input.prompt,first.input.prompt);
    receipt.results.understandingLocation={input:changed.input,answer:changed.answer,result:changed.result};
    const answer=(await exportTo('understanding','text')).toString('utf8');assert.equal(answer,changed.answer);
    const understandingExport=JSON.parse(await exportTo('understanding','json'));assert.equal(understandingExport.result.text,changed.result.text);
    await screenshot('capabilities-understanding.png');

    // A controlled flat-color image is a new input, never a fabricated result.
    await page.evaluate(async()=>{
      const c=document.createElement('canvas');c.width=224;c.height=224;const ctx=c.getContext('2d');ctx.fillStyle='#da2424';ctx.fillRect(0,0,224,224);
      const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));await loadImage(new File([blob],'solid-red.png',{type:'image/png'}),'understanding');
    });
    assert.equal(await page.locator('#understanding-answer').count(),0);await page.fill('#understanding-prompt','What is the dominant color of this image?');await page.click('[data-action="understand"]');await waitResult('understanding');
    const red=await page.evaluate(()=>state.understanding.receipt);assert.match(red.answer,/red/i);assert.notEqual(red.input.assetId,first.input.assetId);receipt.results.understandingChangedImage={input:red.input,answer:red.answer};
    receipt.checks.push(await auditPage(page,'Changed image and question produce a new real answer'));

    await page.click('#app-nav [data-id="geometry"]');assert.equal(await page.evaluate(()=>state.geometry.asset.id),firstGeometryAsset);assert(await page.locator('#geometry-depth').isVisible());
    // Reusing the retained geometry input must survive imports in the other capability.
    await page.click('[data-action="geometry"]');await waitResult('geometry');await rememberProcess();assert.equal(await page.evaluate(()=>state.geometry.receipt.input.assetId),firstGeometryAsset);
    await page.locator('#geometry-image-file').setInputFiles(path.join(root,'showcase/renderer/fixtures/geometry-house.jpg'));
    await page.waitForFunction(id=>state.geometry.asset&&state.geometry.asset.id!==id&&!state.busy,firstGeometryAsset);assert.equal(await page.locator('#geometry-depth').count(),0);
    await page.click('[data-action="geometry"]');await waitResult('geometry');
    const indoor=await page.evaluate(()=>state.geometry.receipt);assert(indoor.geometryPreview.validPixelCount>1000);assert.notEqual(indoor.result.depthBase64,geometry.result.depthBase64);
    receipt.results.geometryChangedScene={input:indoor.input,width:indoor.result.width,height:indoor.result.height,totalMs:indoor.result.totalMs,validPixels:indoor.geometryPreview.validPixelCount};
    receipt.checks.push(await auditPage(page,'Changed indoor scene produces new geometry'));await screenshot('capabilities-geometry-indoor.png');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1080,720));
    for(const id of ['geometry','understanding']){await page.click(`#app-nav [data-id="${id}"]`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);receipt.checks.push(await auditPage(page,`${id} result at minimum width`));}
    assert.deepEqual(errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.stack;if(page&&!page.isClosed()){receipt.state=await page.evaluate(()=>({route:state.route,busy:state.busy,error:state[state.route]?.error})).catch(()=>null);await page.screenshot({path:path.join(root,'logs/capabilities-expansion-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
  finally{
    await app.close();receipt.guardianPids=[...guardians];receipt.guardiansExited=receipt.guardianPids.every(pid=>{try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}});
    if(!receipt.guardiansExited){receipt.passed=false;receipt.failure='An owned native process survived application close.';process.exitCode=1;}
    fs.writeFileSync(path.join(root,'logs/capabilities-expansion-verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks,guardiansExited:receipt.guardiansExited,failure:receipt.failure}));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
