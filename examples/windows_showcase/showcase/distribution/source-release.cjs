'use strict';

// Export the reviewed example sources, never the development workspace as a whole.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const textExtensions = new Set(['.js', '.cjs', '.html', '.css', '.md', '.txt', '.json', '.ps1', '.py', '.cpp', '.h', '.cmake', '.patch', '.toml']);
const textNames = new Set(['LICENSE', 'NOTICE', '.gitignore', '.gitattributes', 'CMakeLists.txt', 'Dockerfile']);
const forbiddenDirectory = /^(?:\.git|\.showcase|logs|dist|models|vendor|dependencies|node_modules|runtime(?:-.+)?|python(?:-.+)?-deps|build(?:-.+)?)$/i;

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || /[\x00-\x1f]/.test(value) || value.startsWith('/')) throw new Error(`Invalid relative release path: ${value}`);
  const segments = value.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error(`Invalid relative release path: ${value}`);
  if (segments.slice(0, -1).some(part => forbiddenDirectory.test(part))) throw new Error(`Generated or dependency directory in source release: ${value}`);
  return value;
}

function safeSource(root, relative) {
  const segments = relative.split('/');
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Source links are not permitted: ${relative}`);
  }
  const resolved = fs.realpathSync(current);
  const outside = path.relative(root, resolved);
  if (outside === '..' || outside.startsWith(`..${path.sep}`) || path.isAbsolute(outside)) throw new Error(`Source escapes root: ${relative}`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`Not a source file: ${relative}`);
  return resolved;
}

function audit(root, config = JSON.parse(fs.readFileSync(path.join(__dirname, 'source-files.json'), 'utf8'))) {
  root = fs.realpathSync(root);
  if (config.schemaVersion !== 1 || !Array.isArray(config.files) || !config.files.length) throw new Error('Unsupported or empty source release manifest.');
  const binaries = config.approvedBinaryInputs || {};
  const names = new Set();
  const records = [];
  for (const entry of config.files) {
    const source = relativePath(typeof entry === 'string' ? entry : entry.source);
    const target = relativePath(typeof entry === 'string' ? entry : entry.path);
    if (names.has(target.toLowerCase()) || target.toLowerCase() === 'source_manifest.json') throw new Error(`Duplicate or reserved release path: ${target}`);
    names.add(target.toLowerCase());
    const sourceFile = safeSource(root, source);
    let bytes = fs.readFileSync(sourceFile);
    const extension = path.posix.extname(target).toLowerCase();
    const binary = binaries[target];
    if (binary) {
      if (!/^[a-f0-9]{64}$/.test(binary.sha256) || sha256(bytes) !== binary.sha256 || !binary.license || !binary.notice) throw new Error(`Unreviewed or changed binary input: ${target}`);
      relativePath(binary.notice);
    } else {
      if (!textExtensions.has(extension) && !textNames.has(path.posix.basename(target))) throw new Error(`Unapproved non-source file: ${target}`);
      if (bytes.includes(0)) throw new Error(`Binary content in text source: ${target}`);
      const text = bytes.toString('utf8');
      if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|hf_[A-Za-z0-9]{25,}|sk-[A-Za-z0-9]{30,})/.test(text)) throw new Error(`Possible credential in source: ${target}`);
      if (/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/i.test(text) || /[A-Z]:[\\/]+Projects[\\/]+TRTMC(?:[\\/]|\b)/i.test(text)) throw new Error(`Machine-specific path in source: ${target}`);
      // Match the repository's eol=lf policy before recording release hashes.
      bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
    }
    records.push({ source, path: target, bytes: bytes.length, sha256: sha256(bytes), ...(binary ? { license: binary.license, notice: binary.notice } : {}) });
  }
  for (const record of records) if (record.notice && !names.has(record.notice.toLowerCase())) throw new Error(`Missing binary license notice: ${record.notice}`);
  return records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function exportSources(root, destination, config) {
  const records = audit(root, config);
  const resolvedRoot = fs.realpathSync(root);
  const resolvedDestination = path.resolve(destination);
  if (resolvedDestination === resolvedRoot) throw new Error('Source and export destination must differ.');
  if (fs.existsSync(resolvedDestination)) throw new Error('Export destination already exists; choose a new empty destination. Nothing was overwritten.');
  // No deletion or overwrite: an interrupted export remains visible for inspection.
  fs.mkdirSync(resolvedDestination, { recursive: true });
  for (const record of records) {
    let bytes = fs.readFileSync(safeSource(resolvedRoot, record.source));
    if (!record.license) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    if (sha256(bytes) !== record.sha256) throw new Error(`Source changed during export: ${record.source}`);
    const output = path.join(resolvedDestination, ...record.path.split('/'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes, { flag: 'wx' });
  }
  const receipt = { schemaVersion: 1, distribution: 'Reviewed source only; dependencies, models and optional media are obtained by the user.', textNormalization: 'UTF-8 with LF line endings, matching .gitattributes; approved binary inputs remain byte-identical.', files: records.map(({source, ...record}) => record) };
  fs.writeFileSync(path.join(resolvedDestination, 'SOURCE_MANIFEST.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

function main(args) {
  let root = path.resolve(__dirname, '../..'), destination;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[++i]);
    else if (args[i] === '--destination' && args[i + 1]) destination = args[++i];
    else throw new Error('Usage: node showcase/distribution/source-release.cjs [--root PATH] [--destination NEW_DIRECTORY]');
  }
  const result = destination ? exportSources(root, destination) : { files: audit(root) };
  process.stdout.write(`${JSON.stringify({ passed: true, mode: destination ? 'export' : 'audit', files: result.files.length, bytes: result.files.reduce((sum, file) => sum + file.bytes, 0) })}\n`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { audit, exportSources, relativePath };
