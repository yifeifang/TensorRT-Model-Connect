'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');

// Owns one native process. Cancellation closes that process and its GPU state.
class BridgeClient extends EventEmitter {
  constructor({executable, args, guardian, readyType = 'ready', timeout = 180000}) {
    super();
    Object.assign(this, {executable, args, guardian, readyType, timeout});
    this.child = null;
    this.pending = new Map();
    this.counter = 0;
  }
  async start() {
    if (this.startPromise) return this.startPromise;
    if (!fs.statSync(this.executable, {throwIfNoEntry: false})?.isFile()) throw new Error(`Native runtime is missing: ${this.executable}`);
    if (this.guardian && !fs.statSync(this.guardian, {throwIfNoEntry:false})?.isFile()) throw new Error('The Windows process host is missing. Rebuild the demo runtime.');
    this.startPromise = new Promise((resolve, reject) => {
      let buffer = '', stderr = '', ready = false, failed = false;
      const executable = this.guardian || this.executable;
      const args = this.guardian ? ['--parent-pid', String(process.pid), '--', this.executable, ...this.args] : this.args;
      const child = spawn(executable, args, {cwd: path.dirname(this.executable), windowsHide: true, shell: false,
        env: {...process.env, PATH: `${path.dirname(this.executable)}${path.delimiter}${process.env.PATH || ''}`}, stdio: ['pipe', 'pipe', 'pipe']});
      this.child = child;
      const timer = setTimeout(() => { fail(new Error('Model loading timed out. Retry after closing other GPU applications.')); child.kill(); }, this.timeout);
      const fail = error => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        if (!ready) reject(error);
        for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
        this.pending.clear();
        this.emit('failure', error.message);
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
      child.stdout.on('data', data => {
        if (this.child !== child || failed) return;
        buffer += data;
        if (buffer.length > 12 * 1024 * 1024) { fail(new Error('Native output exceeded protocol limit.')); child.kill(); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (!event || typeof event.type !== 'string') throw new Error('Invalid native event');
            if (event.type === this.readyType) { ready = true; clearTimeout(timer); resolve(event); }
            const job = this.pending.get(String(event.id));
            if (job && (event.type === 'result' || event.type === 'error')) {
              clearTimeout(job.timer); this.pending.delete(String(event.id));
              if (event.type === 'error') job.reject(new Error(event.message || 'Inference failed'));
              else job.resolve(event);
            }
            this.emit('packet', event);
            if (event.type === 'error' && event.fatal) { fail(new Error(event.message)); child.kill(); return; }
          } catch (error) { fail(new Error(`Native protocol error: ${error.message}`)); child.kill(); return; }
        }
      });
      child.stdin.on('error', fail);
      child.on('error', fail);
      child.on('close', code => {
        clearTimeout(timer);
        if (this.child === child) { this.child = null; this.startPromise = null; }
        if (!ready || this.pending.size) fail(new Error(`Native session closed (${code ?? 'cancelled'}). ${stderr}`));
        this.emit('closed', code);
      });
    });
    return this.startPromise;
  }
  send(packet) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Native runtime is not connected.');
    if (this.child.stdin.writableLength > 512 * 1024) { void this.stop(); throw new Error('Audio input exceeded runtime capacity. Session stopped.'); }
    this.child.stdin.write(JSON.stringify(packet) + '\n');
  }
  request(packet) {
    const id = String(++this.counter);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Inference timed out. The request was cancelled.')); void this.stop(); }, this.timeout);
      this.pending.set(id, {resolve, reject, timer});
      try { this.send({...packet, id}); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    const child = this.child;
    if (!child) { this.startPromise = null; return; }
    this.stopPromise = new Promise(resolve => {
      for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('Request cancelled.')); }
      this.pending.clear();
      const timer = setTimeout(() => child.kill(), 2000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      if (!child.stdin.destroyed) child.stdin.end('{"type":"stop"}\n'); else child.kill();
    });
    await this.stopPromise;
    this.stopPromise = null;
    this.startPromise = null;
  }
}
module.exports = {BridgeClient};
