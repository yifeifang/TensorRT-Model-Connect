'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { audit, exportSources } = require('./source-release.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-source-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.js'), 'const safe = true;\n');
  return root;
}
const manifest = files => ({ schemaVersion: 1, files });

test('source export contains only explicitly reviewed files and exact hashes', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'app.js'), 'const safe = true;\r\n');
  fs.writeFileSync(path.join(root, 'private.json'), '{"notForRelease":true}');
  const output = path.join(root, 'release');
  const result = exportSources(root, output, manifest([{ source: 'app.js', path: 'showcase/app.js' }]));
  assert.equal(result.files.length, 1);
  assert.equal(fs.readFileSync(path.join(output, 'showcase/app.js'), 'utf8'), 'const safe = true;\n');
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'const safe = true;\r\n', 'Source bytes remain untouched by export normalization');
  assert.equal(result.files[0].sha256, crypto.createHash('sha256').update('const safe = true;\n').digest('hex'));
  assert(!fs.existsSync(path.join(output, 'private.json')));
  assert(!JSON.stringify(result).includes(root));
  assert.throws(() => exportSources(root, output, manifest(['app.js'])), /already exists/);
});

test('audit fails closed for traversal, dependency directories, duplicate Windows names and executables', t => {
  const root = fixture(t);
  for (const bad of ['../app.js', '/app.js', 'models/app.js', 'showcase/node_modules/app.js', 'C:/app.js', 'showcase\\app.js', 'showcase/app.js.']) assert.throws(() => audit(root, manifest([bad])));
  assert.throws(() => audit(root, manifest([{ source: 'app.js', path: 'APP.js' }, 'app.js'])), /Duplicate/);
  assert.throws(() => audit(root, manifest([{ source: 'app.js', path: 'danger.exe' }])), /non-source/);
  fs.writeFileSync(path.join(root, 'binary.js'), Buffer.from([0, 1, 2]));
  assert.throws(() => audit(root, manifest(['binary.js'])), /Binary content/);
});

test('binary input requires a pinned digest and an included license notice', t => {
  const root = fixture(t), bytes = Buffer.from([255, 216, 255, 217]);
  fs.writeFileSync(path.join(root, 'sample.jpeg'), bytes);
  const approved = { schemaVersion: 1, files: ['sample.jpeg'], approvedBinaryInputs: { 'sample.jpeg': { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), license: 'Apache-2.0', notice: 'LICENSE' } } };
  assert.throws(() => audit(root, approved), /Missing binary license notice/);
  fs.writeFileSync(path.join(root, 'LICENSE'), 'Fixture license.\n');
  approved.files.push('LICENSE');
  assert.equal(audit(root, approved).length, 2);
  fs.appendFileSync(path.join(root, 'sample.jpeg'), 'changed');
  assert.throws(() => audit(root, approved), /changed binary/);
});

test('audit rejects a personal path or recognizable credential', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'app.js'), ['C:', 'Users', 'Example', 'private'].join('/'));
  assert.throws(() => audit(root, manifest(['app.js'])), /Machine-specific/);
  fs.writeFileSync(path.join(root, 'app.js'), 'gh' + 'p_' + 'x'.repeat(36));
  assert.throws(() => audit(root, manifest(['app.js'])), /credential/);
});
