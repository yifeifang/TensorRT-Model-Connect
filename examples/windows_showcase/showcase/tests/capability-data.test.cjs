'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseThinking} = require('../capability-data');

test('a closed thinking section and a finished answer are complete by default', () => {
  assert.deepEqual(parseThinking('<think> Reasoning. </think> Final answer. ', true), {
    reasoning: 'Reasoning.', answer: 'Final answer.', complete: true
  });
});

test('an unclosed thinking section remains incomplete and preserves generated text', () => {
  assert.deepEqual(parseThinking('<think>Still reasoning', true), {
    reasoning: 'Still reasoning', answer: '', complete: false
  });
});

test('a token-limited answer after a closed thinking section remains incomplete', () => {
  assert.deepEqual(parseThinking('<think>Reasoning.</think>The answer starts', true, true), {
    reasoning: 'Reasoning.', answer: 'The answer starts', complete: false
  });
});

test('a closed thinking section without an answer remains incomplete', () => {
  assert.equal(parseThinking('<think>Reasoning.</think> ', true, false).complete, false);
});

test('a token-limited direct answer remains incomplete without losing its text', () => {
  assert.deepEqual(parseThinking('A partial direct answer', false, true), {
    reasoning: '', answer: 'A partial direct answer', complete: false
  });
  assert.equal(parseThinking('A finished direct answer.', false, false).complete, true);
});
