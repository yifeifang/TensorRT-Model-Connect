'use strict';
class TranscriptStore {
  constructor() { this.reset(); }
  reset() { this.entries = []; this.active = new Map(); this.assistantEpoch = null; }
  append(event) {
    if (event.type !== 'transcript' || typeof event.text !== 'string' || !event.text) return;
    const role = event.role === 'user' ? 'user' : 'assistant';
    if (role === 'assistant' && event.epoch !== undefined) {
      if (this.assistantEpoch !== event.epoch) this.active.delete(role);
      this.assistantEpoch = event.epoch;
    }
    let entry = this.active.get(role);
    if (!entry) { entry = {role, text: '', final: false}; this.entries.push(entry); this.active.set(role, entry); }
    entry.text = event.delta ? entry.text + event.text : event.text;
    entry.final = event.final !== false;
    if (entry.final) this.active.delete(role);
    if (this.entries.length > 300) this.entries.shift();
  }
  text() { return this.entries.map(e => `${e.role === 'user' ? 'You' : 'Assistant'}: ${e.text}`).join('\n\n'); }
}
module.exports = {TranscriptStore};
