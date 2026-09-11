'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function until(condition) {
  for (let turn = 0; turn < 30; turn++) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Expected lifecycle transition did not occur');
}
function harness() {
  const clients = [];
  class FakeBridge extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.child = {}; this.stopCalls = 0;
      this.family = options.executable.includes('voicechat') ? 'nemotron_voicechat' : 'qwen';
      this.ready = {protocolVersion: 1, backend: 'trt_rtx', family: this.family};
      clients.push(this);
    }
    async start() { return this.ready; }
    async request() {
      this.requested = true;
      return this.response ? this.response.promise : {backend: 'trt_rtx', family: this.family, text: 'Actual test response'};
    }
    async stop() {
      if (this.stopPromise) return this.stopPromise;
      this.stopCalls++;
      this.response?.reject(new Error('Request cancelled.'));
      this.stopPromise = (async () => {
        if (this.stopGate) await this.stopGate.promise;
        this.child = null;
        this.emit('closed');
      })();
      return this.stopPromise;
    }
    send() {}
  }
  const context = {module: {exports: {}}, require: name => name === './bridge-client'
    ? {BridgeClient: FakeBridge} : name === 'node:fs' ? {statSync: () => ({isFile: () => true})} : require(name)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../capability-runtime.js'), 'utf8'), context);
  return {runtime: new context.module.exports.CapabilityRuntime(path.resolve(__dirname, '../..')), clients};
}

test('voice-stop cancels voice startup while the previous model is still retiring', async () => {
  const {runtime, clients} = harness();
  await runtime.run('reasoning', {});
  const old = clients[0]; old.stopGate = deferred();
  const starting = runtime.startVoice();
  const rejected = assert.rejects(starting, /cancelled/);
  await until(() => old.stopCalls === 1);
  const stopping = runtime.stopVoice();
  assert.equal(runtime.busy, true);
  old.stopGate.resolve();
  await Promise.all([stopping, rejected]);
  assert.equal(clients.length, 1, 'The cancelled voice request must never spawn a voice model');
  assert.equal(runtime.client, null);
  assert.equal(runtime.state, 'idle');
});

test('voice-stop leaves an active text request alone', async () => {
  const {runtime, clients} = harness();
  await runtime.run('reasoning', {});
  const client = clients[0]; client.requested = false; client.response = deferred();
  const running = runtime.run('reasoning', {});
  await until(() => client.requested);
  await runtime.stopVoice();
  assert.equal(client.stopCalls, 0);
  assert.equal(runtime.busy, true);
  client.response.resolve({backend: 'trt_rtx', family: 'qwen', text: 'Completed'});
  assert.equal((await running).text, 'Completed');
  await runtime.cancel();
});

test('voice-stop leaves a pending text request alone while the old voice model retires', async () => {
  const {runtime, clients} = harness();
  await runtime.startVoice();
  const voice = clients[0]; voice.stopGate = deferred();
  const running = runtime.run('reasoning', {});
  await until(() => voice.stopCalls === 1);
  await runtime.stopVoice();
  voice.stopGate.resolve();
  assert.equal((await running).family, 'qwen');
  assert.equal(runtime.kind, 'reasoning');
  assert.equal(clients.length, 2);
  await runtime.cancel();
});

test('cancel keeps an idle ready model owned and blocks a new request until shutdown completes', async () => {
  const {runtime, clients} = harness();
  await runtime.run('reasoning', {});
  const client = clients[0]; client.stopGate = deferred();
  const stopping = runtime.cancel();
  assert.equal(runtime.client, client);
  assert.equal(runtime.busy, true);
  await assert.rejects(runtime.run('reasoning', {}), /Finish or cancel/);
  client.stopGate.resolve(); await stopping;
  assert.equal(runtime.client, null);
  assert.equal(runtime.kind, null);
  assert.equal(runtime.busy, false);
  assert.equal(runtime.state, 'idle');
});

test('a runtime failure stops a text client and never leaves a failed session ready', async () => {
  const {runtime, clients} = harness();
  await runtime.run('reasoning', {});
  const client = clients[0]; client.requested = false; client.response = deferred();
  const running = runtime.run('reasoning', {});
  const rejected = assert.rejects(running, /cancelled/);
  await until(() => client.requested);
  client.emit('failure', 'Native protocol failure');
  await rejected; await until(() => runtime.state === 'idle');
  assert.equal(client.stopCalls, 1);
  assert.equal(client.child, null);
  assert.equal(runtime.client, null);
  assert.equal(runtime.busy, false);
});

test('a mismatched ready packet is rejected and its client is stopped', async () => {
  const {runtime, clients} = harness();
  const starting = runtime.run('reasoning', {});
  // ensure() yields once before creating the client; its start() resumes later.
  await Promise.resolve();
  const client = clients[0];
  client.ready.family = 'bert';
  await assert.rejects(starting, /different capability than requested/);
  assert.equal(client.stopCalls, 1);
  assert.equal(runtime.client, null);
  assert.equal(runtime.state, 'idle');
});

test('a result with the wrong backend identity is rejected and its session is retired', async () => {
  const {runtime, clients} = harness();
  await runtime.run('reasoning', {});
  const client = clients[0]; client.response = deferred();
  client.response.resolve({backend: 'other', family: 'qwen', text: 'Wrong backend'});
  await assert.rejects(runtime.run('reasoning', {}), /Unexpected inference backend/);
  assert.equal(client.stopCalls, 1);
  assert.equal(runtime.client, null);
  assert.equal(runtime.state, 'idle');
});
