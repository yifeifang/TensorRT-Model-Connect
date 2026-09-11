'use strict';
// Capture/playback only. The page explicitly starts/stops the native model.
window.ShowcaseAudio = class ShowcaseAudio {
  constructor(api, {onLevel = () => {}, onError = () => {}} = {}) {
    Object.assign(this, {api, onLevel, onError});
    this.ready = false; this.muted = false; this.generation = 0;
    this.playback = new Set(); this.cursor = 0;
  }
  async start() {
    await this.stop();
    const token = ++this.generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
      if (token !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      const context = new AudioContext({sampleRate: 48000, latencyHint: 'interactive'});
      this.context = context;
      await context.resume();
      await context.audioWorklet.addModule('capture-worklet.js');
      if (token !== this.generation) return;
      const source = context.createMediaStreamSource(stream);
      const a = context.createBiquadFilter(), b = context.createBiquadFilter();
      for (const filter of [a, b]) { filter.type = 'lowpass'; filter.frequency.value = 7200; filter.Q.value = Math.SQRT1_2; }
      const node = new AudioWorkletNode(context, 'voice-capture', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
      this.node = node;
      source.connect(a).connect(b).connect(node).connect(context.destination);
      const ratio = context.sampleRate / 16000;
      // Send 20 ms packets so normal delivery jitter does not trigger the
      // native runtime's 80 ms missing-input fallback between real packets.
      let carry = 0, previous = 0, offset = 0, frame = new Float32Array(320);
      node.port.onmessage = ({data}) => {
        if (token !== this.generation) return;
        let sum = 0;
        for (const value of data) sum += value * value;
        this.onLevel(this.muted ? 0 : Math.min(1, Math.sqrt(sum / data.length) * 7));
        const combined = new Float32Array(data.length + 1); combined[0] = previous; combined.set(data, 1);
        for (; carry + 1 < combined.length; carry += ratio) {
          const left = Math.floor(carry), fraction = carry - left;
          frame[offset++] = this.muted ? 0 : Math.max(-1, Math.min(1, combined[left] * (1 - fraction) + combined[left + 1] * fraction));
          if (offset === frame.length) {
            if (this.ready) this.api.sendAudio({samples: Array.from(frame), sampleRate: 16000});
            frame = new Float32Array(320); offset = 0;
          }
        }
        carry -= data.length; previous = data[data.length - 1];
      };
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (token === this.generation) { this.onError('Microphone disconnected.'); void this.stop(); } });
    } catch (error) { await this.stop(); throw error; }
  }
  setReady(value) { this.ready = Boolean(value); }
  setMuted(value) { this.muted = Boolean(value); }
  play(event) {
    if (!this.context || !this.ready || !Array.isArray(event.samples) || !event.samples.length) return;
    if (event.sampleRate !== 48000) { this.onError('Invalid output sample rate.'); return; }
    const context = this.context;
    if (this.cursor - context.currentTime > 15) { this.onError('Audio output queue exceeded 15 seconds. Restart the conversation.'); void this.stop(); return; }
    const buffer = context.createBuffer(1, event.samples.length, event.sampleRate);
    buffer.copyToChannel(Float32Array.from(event.samples), 0);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    const when = this.cursor <= context.currentTime + .005 ? context.currentTime + .16 : this.cursor;
    this.playback.add(source); source.start(when); this.cursor = when + buffer.duration;
    source.onended = () => { this.playback.delete(source); source.disconnect(); };
  }
  flush() {
    for (const source of this.playback) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    this.playback.clear(); this.cursor = 0;
  }
  async stop() {
    this.generation++; this.ready = false; this.flush();
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    const context = this.context; this.context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
    this.onLevel(0);
  }
};
