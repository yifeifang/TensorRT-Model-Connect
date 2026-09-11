const {test} = require('node:test');
const assert = require('node:assert/strict');
const {TranscriptStore} = require('../transcript-store');
test('user partials spanning assistant epochs remain one utterance', () => {
  const store = new TranscriptStore();
  store.append({type: 'transcript', role: 'user', text: 'What', epoch: 0, final: false});
  store.append({type: 'transcript', role: 'assistant', text: 'Hello', epoch: 1, final: true});
  store.append({type: 'transcript', role: 'user', text: 'What is the capital of France?', epoch: 1, final: true});
  store.append({type: 'transcript', role: 'assistant', text: 'It is ', epoch: 2, delta: true, final: false});
  store.append({type: 'transcript', role: 'assistant', text: 'Paris.', epoch: 2, delta: true, final: false});
  store.append({type: 'transcript', role: 'assistant', text: 'It is Paris.', epoch: 2, final: true});
  assert.equal(store.entries.length, 3);
  assert.equal(store.entries[0].text, 'What is the capital of France?');
  assert.equal(store.entries[2].text, 'It is Paris.');
  assert.match(store.text(), /Assistant: It is Paris\./);
  store.reset(); assert.equal(store.text(), '');
});
