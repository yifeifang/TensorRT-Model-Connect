'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const forbiddenBrands=/\b(?:Wispr(?:\s*Flow)?|Whisper(?:\s*Flow)?|Clipto|Dograh|Qwen[\w.-]*|E5|SAM|MoGe|Nemotron|TensorRT(?:-RTX)?|NVIDIA|Hugging(?:\s*Face)?|OpenAI|Facebook|Microsoft|Google|Anthropic)\b/i;

async function auditPage(page,label){
  const snapshot=await page.evaluate(()=>{
    const visible=element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
    const controls=[...document.querySelectorAll('input:not([type="file"]),textarea,select')].filter(visible).map(element=>element.value);
    const attributes=[...document.querySelectorAll('[aria-label],[title],[alt],[placeholder]')].filter(visible).flatMap(element=>['aria-label','title','alt','placeholder'].map(name=>element.getAttribute(name)||''));
    const links=[...document.querySelectorAll('a[href],[data-action="source"]')].filter(visible).map(element=>element.getAttribute('href')||element.dataset.url||'source action');
    return{title:document.title,lang:document.documentElement.lang,text:document.body.innerText,controls,attributes,links};
  });
  const surface=[snapshot.title,snapshot.text,...snapshot.controls,...snapshot.attributes].join('\n');
  assert.match(snapshot.lang,/^en(?:-|$)/,`${label}: document language must be English`);
  assert.doesNotMatch(surface,/\p{Script=Han}/u,`${label}: app-authored content and default outputs must use English`);
  assert.doesNotMatch(surface,forbiddenBrands,`${label}: third-party names must stay out of the presentation`);
  assert(!snapshot.links.some(link=>/^https?:|source action/i.test(link)),`${label}: no external product/model source actions`);
  return{label,title:snapshot.title,characters:surface.length,attributesChecked:snapshot.attributes.filter(Boolean).length};
}

async function desktopAudit(){
  fs.mkdirSync(path.join(root,'logs'),{recursive:true});
  const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const application=await _electron.launch({executablePath:path.join(root,'dist/ModelConnect Showcase/ModelConnect Showcase.exe'),env,timeout:30000});
  const receipt={passed:false,startedAt:new Date().toISOString(),scope:'Actual packaged app, seven independent pages, English defaults, accessible labels, capability dialogs and runtime inventory. No GPU requests.',checks:[]};let page;
  try{
    page=await application.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForSelector('.app-card');assert.equal(await page.locator('.app-card').count(),7);
    await page.waitForFunction(()=>Boolean(state.status));
    receipt.checks.push(await auditPage(page,'Home'));
    for(const id of ['dictation','reasoning','embedding','vision','understanding','geometry','voice']){
      await page.click(`#app-nav [data-id="${id}"]`);receipt.checks.push(await auditPage(page,id));
      if(id==='dictation'){
        assert.deepEqual(await page.locator('#asr-language option').evaluateAll(options=>options.map(option=>option.value)),['en']);
        assert.equal(await page.locator('[data-action="sample-audio"][data-language="zh"]').count(),0);
      }
      await page.click('[data-action="info"]');await page.waitForSelector('#info-dialog[open]');receipt.checks.push(await auditPage(page,`${id} capability details`));
      await page.click('[data-action="close-dialog"]');
    }
    await page.click('[data-action="runtime"]');await page.waitForSelector('#info-dialog[open]');receipt.checks.push(await auditPage(page,'Runtime inventory'));
    await page.screenshot({path:path.join(root,'logs/english-runtime-inventory.png')});await page.click('[data-action="close-dialog"]');
    await page.click('.nav-home');await page.click('[data-action="present"]');receipt.checks.push(await auditPage(page,'Presentation mode'));await page.keyboard.press('Escape');
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1080,720));
    for(const id of ['home','dictation','reasoning','embedding','vision','understanding','geometry','voice']){
      await page.click(id==='home'?'.nav-home':`#app-nav [data-id="${id}"]`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${id}: English text must fit the minimum window width`);
    }
    await page.click('.nav-home');await page.screenshot({path:path.join(root,'logs/english-home-1080.png')});
    assert.deepEqual(errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.stack;if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'logs/english-app-failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{await application.close();fs.writeFileSync(path.join(root,'logs/english-desktop-audit.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
}

module.exports={auditPage,forbiddenBrands};
if(require.main===module)desktopAudit().catch(error=>{console.error(error);process.exitCode=1;});
