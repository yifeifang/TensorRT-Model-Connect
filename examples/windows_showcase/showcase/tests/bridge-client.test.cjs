const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {BridgeClient} = require('../bridge-client');
const fixture = path.join(__dirname, 'fixtures', 'bridge-fixture.cjs');
const make = (mode, timeout = 2000) => new BridgeClient({executable: process.execPath, args: [fixture, mode || 'ready'], timeout});
test('request IDs keep concurrent replies isolated and a rejected request is recoverable', async () => {
  const client = make();
  try {
    await client.start();
    const outputs = await Promise.all(['alpha', 'beta'].map(prompt => client.request({type: 'generate', prompt})));
    assert.deepEqual(outputs.map(r => r.text), ['alpha', 'beta']);
    await assert.rejects(client.request({type: 'generate', prompt: 'error'}), /context limit/);
    assert.equal((await client.request({type: 'generate', prompt: 'after error'})).text, 'after error');
  } finally { await client.stop(); }
});
test('cancellation rejects outstanding work and reclaims its process', async () => {
  const client = make(); await client.start();
  const pending = client.request({type: 'generate', prompt: 'wait'});
  const rejected = assert.rejects(pending, /cancelled/);
  await client.stop(); await rejected;
  assert.equal(client.child, null);
  await client.start();
  assert.equal((await client.request({type: 'generate', prompt: 'new session'})).text, 'new session');
  await client.stop();
});
test('invalid protocol and stalled loading fail without an orphan process', async () => {
  for (const mode of ['malformed', 'never-ready']) {
    const client = make(mode, 500);
    try { await assert.rejects(client.start(), /protocol|timed out/); }
    finally { await client.stop(); }
    assert.equal(client.child, null);
  }
});
