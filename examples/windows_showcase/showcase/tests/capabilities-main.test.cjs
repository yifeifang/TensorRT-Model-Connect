'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');

const showcase = path.resolve(__dirname, '..');
const root = path.dirname(showcase);
const temporary = path.join(root, '.showcase/capability-inputs');
const picture = {width: 16, height: 16, rgbaBase64: Buffer.alloc(16 * 16 * 4, 255).toString('base64')};

async function harness({lock = true, initial = []} = {}) {
  const handlers = new Map(), files = new Map(initial), calls = [], runs = [], dialogs = [];
  let saveResult={canceled:true};
  let runtime, window;
  const mockFs = {
    existsSync: file => file === path.join(root, 'showcase/package.json') || file === path.join(root, 'models'),
    mkdirSync: (directory, options) => calls.push({type: 'mkdir', directory, options}),
    readdirSync: (directory, options) => {
      calls.push({type: 'readdir', directory, options});
      assert.equal(options.withFileTypes, true);
      return [...files].filter(([file]) => path.dirname(file) === directory).map(([file, value]) => ({
        name: path.basename(file), isFile: () => Buffer.isBuffer(value)
      }));
    },
    writeFileSync: (file, data) => { calls.push({type: 'write', file}); files.set(file, data); },
    unlinkSync: file => {
      calls.push({type: 'unlink', file});
      if (!files.delete(file)) { const error = new Error('Missing file'); error.code = 'ENOENT'; throw error; }
    }
  };
  class FakeRuntime extends EventEmitter {
    constructor() {
      super(); runtime = this; this.busy = false; this.state = 'idle'; this.kind = null;
      this.models = Object.fromEntries(['vision', 'understanding', 'geometry', 'reasoning', 'voice'].map(kind => [kind, {
        model: kind, family: kind, task: kind, bundle: path.join(root, `models/${kind}.bundle`)
      }]));
    }
    status() { return {busy: this.busy, state: this.state, loadedModel: this.kind}; }
    async run(kind, request) {
      this.busy = true; this.state = 'loading'; this.kind = kind;
      try { return await new Promise((resolve, reject) => runs.push({kind, request, resolve, reject})); }
      finally { this.busy = false; this.state = 'ready'; }
    }
    async startVoice() { this.busy = false; this.state = 'voice'; this.kind = 'voice'; return {}; }
    async stopVoice() { this.state = 'idle'; this.kind = null; }
    async cancel() { this.busy = false; this.state = 'idle'; this.kind = null; }
  }
  class FakeWindow extends EventEmitter {
    constructor() {
      super(); window = this; this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      this.webContents.getURL = () => this.webContents.mainFrame.url;
    }
    loadFile(file) { this.webContents.mainFrame.url = require('node:url').pathToFileURL(file).href; }
    setMenu() {}
    isDestroyed() { return false; }
  }
  const app = new EventEmitter();
  Object.assign(app, {
    commandLine: {appendSwitch() {}}, setName() {}, setPath() {}, quit: () => calls.push({type: 'quit'}),
    requestSingleInstanceLock: () => { calls.push({type: 'lock', acquired: lock}); return lock; },
    whenReady: () => Promise.resolve()
  });
  const electron = {
    app, BrowserWindow: FakeWindow,
    ipcMain: {handle: (name, handler) => handlers.set(name, handler), on() {}},
    session: {defaultSession: {setPermissionRequestHandler() {}, setPermissionCheckHandler() {}}},
    dialog: {showSaveDialog: async (_window, config) => { dialogs.push(config); return saveResult; }}, shell: {}
  };
  const context = {
    module: {exports: {}}, __dirname: showcase, Buffer, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    require: name => name === 'electron' ? electron : name === 'node:fs' ? mockFs
      : name === './capability-runtime' ? {CapabilityRuntime: FakeRuntime}
      : name.startsWith('./') ? require(path.join(showcase, name)) : require(name)
  };
  vm.runInNewContext(fs.readFileSync(path.join(showcase, 'capabilities-main.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const invoke = (name, value) => handlers.get(`showcase:${name}`)({
    sender: window.webContents, senderFrame: window.webContents.mainFrame
  }, value);
  return {runtime, invoke, files, calls, runs, dialogs, handlers,saveTo(file){saveResult={canceled:false,filePath:file};}};
}

test('a new image cannot delete the input of a SAM request that is still loading', async () => {
  const app = await harness();
  const asset = app.invoke('image-asset', picture);
  const segmenting = app.invoke('segment', {assetId: asset.id, x: 1, y: 1});
  const job = app.runs[0], input = job.request.imagePath;
  assert.equal(app.runtime.status().busy, true);
  assert.throws(() => app.invoke('image-asset', picture), /Finish or cancel/);
  assert.equal(app.files.has(input), true, 'Pending native input must survive the rejected image import');
  job.resolve({width: 16, height: 16, maskBase64: Buffer.alloc(256, 1).toString('base64')});
  const receipt = await segmenting;
  assert.equal(receipt.input.assetId, asset.id);
  const next = app.invoke('image-asset', picture);
  assert.notEqual(next.id, asset.id);
  assert.equal(app.files.has(input), false, 'Completed input can be reclaimed by a later import');
});

test('image imports are rejected during an active voice session even when busy is false', async () => {
  const app = await harness();
  app.invoke('image-asset', picture);
  const previousFiles = [...app.files.keys()];
  await app.invoke('voice-start');
  assert.equal(app.runtime.status().busy, false);
  assert.throws(() => app.invoke('image-asset', picture), /end the voice session/);
  assert.deepEqual([...app.files.keys()], previousFiles);
  await app.invoke('voice-stop');
  assert.doesNotThrow(() => app.invoke('image-asset', picture));
});

test('visual capabilities keep independent images and refuse an image from another slot', async () => {
  const app=await harness(),large={width:64,height:64,rgbaBase64:Buffer.alloc(64*64*4,255).toString('base64')};
  const segmentation=app.invoke('image-asset',picture),understanding=app.invoke('image-asset',{...large,slot:'understanding'}),geometry=app.invoke('image-asset',{...large,slot:'geometry'});
  assert.equal(app.files.size,3,'Each image capability retains its own native input');
  const prior=[...app.files.keys()];
  const answer=app.invoke('understand',{assetId:understanding.id,prompt:'What is visible?'});
  assert.throws(()=>app.invoke('image-asset',{...large,slot:'geometry'}),/Finish or cancel/);
  app.runs.at(-1).resolve({text:'A white image.',reachedTokenLimit:false,totalMs:1});
  const receipt=await answer;assert.equal(receipt.input.assetId,understanding.id);assert.equal(receipt.input.prompt,'What is visible?');
  assert.equal(receipt.answer,'A white image.');
  app.invoke('image-asset',{...large,slot:'geometry'});
  assert.equal(app.files.size,3);assert.equal(prior.filter(p=>app.files.has(p)).length,2);
  await assert.rejects(app.invoke('understand',{assetId:segmentation.id,prompt:'What is visible?'}),/Image Understanding/);
  await assert.rejects(app.invoke('geometry',{assetId:geometry.id}),/Image to Depth/);
});

test('point export retains the original image colors after that capability imports a replacement',async()=>{
  const app=await harness(),width=64,height=64,count=width*height;
  const rgba=Buffer.alloc(count*4);for(let i=0;i<count;i++)rgba.set([255,0,0,255],i*4);
  const asset=app.invoke('image-asset',{slot:'geometry',width,height,rgbaBase64:rgba.toString('base64')});
  const depth=Buffer.alloc(count*4),points=Buffer.alloc(count*12);for(let i=0;i<count;i++){depth.writeFloatLE(2,i*4);points.writeFloatLE(i%width,i*12);points.writeFloatLE(Math.floor(i/width),i*12+4);points.writeFloatLE(2,i*12+8);}
  const pending=app.invoke('geometry',{assetId:asset.id});
  app.runs.at(-1).resolve({width,height,depthEncoding:'float32le',pointsEncoding:'float32le-xyz',maskEncoding:'u8-validity',invalidValue:'+Infinity',depthBase64:depth.toString('base64'),pointsBase64:points.toString('base64'),maskBase64:Buffer.alloc(count,1).toString('base64'),intrinsics:[1,0,.5,0,1,.5,0,0,1],validPixelCount:count});
  const receipt=await pending;
  app.invoke('image-asset',{slot:'geometry',width,height,rgbaBase64:Buffer.alloc(count*4,255).toString('base64')});
  const output=path.join(root,'geometry-test.ply');app.saveTo(output);await app.invoke('export',{id:receipt.id,format:'points'});
  const vertices=app.files.get(output).split('end_header\n')[1].trim().split('\n');assert.equal(vertices.length,count);
  assert(vertices.every(line=>line.endsWith(' 255 0 0')),'The new white image cannot recolor an old red point cloud');
});

test('only the lock owner removes regular WAV and PPM files directly in the temporary directory', async () => {
  const oldWav = path.join(temporary, 'old.wav'), oldPpm = path.join(temporary, 'old.PPM');
  const preserved = [path.join(temporary, 'notes.json'), path.join(temporary, 'nested', 'recording.wav'),
    path.join(root, 'outside.wav'), path.join(temporary, 'directory.wav'), path.join(temporary, 'link.ppm')];
  const initial = [[oldWav, Buffer.from('audio')], [oldPpm, Buffer.from('image')],
    ...preserved.map((file, index) => [file, index < 3 ? Buffer.from('keep') : {type: index === 3 ? 'directory' : 'link'}])];
  const app = await harness({initial});
  assert.equal(app.files.has(oldWav), false);
  assert.equal(app.files.has(oldPpm), false);
  for (const file of preserved) assert.equal(app.files.has(file), true, `Must preserve ${file}`);
  const lockIndex = app.calls.findIndex(call => call.type === 'lock' && call.acquired);
  assert.ok(lockIndex >= 0);
  for (const [index, call] of app.calls.entries()) {
    if (['mkdir', 'readdir', 'unlink'].includes(call.type)) assert.ok(index > lockIndex);
    if (call.type === 'readdir') assert.equal(call.directory, temporary, 'Cleanup is not recursive');
  }
  assert.equal(app.calls.filter(call => call.type === 'readdir').length, 1);
});

test('a second instance does not inspect or remove the first instance temporary inputs', async () => {
  const input = path.join(temporary, 'active.wav');
  const app = await harness({lock: false, initial: [[input, Buffer.from('live audio')]]});
  assert.equal(app.files.has(input), true);
  assert.equal(app.handlers.size, 0);
  assert.equal(app.calls.filter(call => ['mkdir', 'readdir', 'unlink'].includes(call.type)).length, 0);
  assert.ok(app.calls.some(call => call.type === 'quit'));
});

test('both reasoning modes export using valid Windows default filenames', async () => {
  const app = await harness();
  for (const thinking of [false, true]) {
    const reasoning = app.invoke('reason', {input: 'A test question', thinking});
    app.runs.at(-1).resolve({text: thinking ? '<think>Test reasoning.</think>Answer.' : 'Answer.'});
    const receipt = await reasoning;
    await app.invoke('export', {id: receipt.id, format: 'json'});
    const filename = path.basename(app.dialogs.at(-1).defaultPath);
    assert.equal(filename, `modelconnect-reasoning-${thinking}.json`);
    assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
  }
});
