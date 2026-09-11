'use strict';

// Audio acquisition only. Native ASR and any later text model are separate steps.
window.DictationAudio = class DictationAudio {
  constructor({onLevel = () => {}, onDuration = () => {}, onLimit = () => {}, onError = () => {}} = {}) {
    Object.assign(this, {onLevel, onDuration, onLimit, onError});
    this.generation = 0;
    this.capture = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.state = 'idle';
    this.result = null;
  }

  async start() {
    // Reserve this generation before the first await, so an immediate cancel or
    // a second start can invalidate it even during ShowcaseAudio's own startup.
    const token = ++this.generation;
    const previous = this.capture;
    this.capture = null;
    this.state = 'starting';
    this.chunks = [];
    this.sampleCount = 0;
    this.result = null;
    if (previous) await previous.stop();
    if (token !== this.generation) throw DictationAudio.cancelled();
    this.onDuration(0);
    let capture;
    try {
      if (typeof window.ShowcaseAudio !== 'function') throw new Error('The microphone capture module is unavailable.');
      capture = new window.ShowcaseAudio({sendAudio: block => this.accept(token, block)}, {
        onLevel: level => { if (token === this.generation) this.onLevel(level); },
        onError: error => {
          if (token !== this.generation) return;
          this.state = 'error';
          // ShowcaseAudio also stops itself on device loss. Stopping here keeps
          // the wrapper safe if a future capture implementation only reports it.
          void capture.stop();
          this.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
      this.capture = capture;
      await capture.start();
      if (token !== this.generation || this.capture !== capture) {
        await capture.stop();
        throw DictationAudio.cancelled();
      }
      this.state = 'recording';
      capture.setReady(true);
    } catch (error) {
      if (capture) await capture.stop();
      if (token !== this.generation) throw DictationAudio.cancelled();
      this.capture = null;
      this.state = 'error';
      if (error?.name !== 'AbortError') this.onError(error);
      throw error;
    }
  }

  accept(token, block) {
    if (token !== this.generation || this.state !== 'recording') return;
    if (block?.sampleRate !== 16000 || !Array.isArray(block.samples) || !block.samples.length ||
        block.samples.some(value => !Number.isFinite(value) || Math.abs(value) > 1)) {
      this.state = 'error';
      if (this.capture) void this.capture.stop();
      this.onError(new Error('The microphone returned invalid audio data.'));
      return;
    }
    const take = Math.min(block.samples.length, 480000 - this.sampleCount);
    if (take) {
      this.chunks.push(Float32Array.from(block.samples.slice(0, take)));
      this.sampleCount += take;
      this.onDuration(this.sampleCount / 16000);
    }
    if (token === this.generation && this.state === 'recording' && this.sampleCount === 480000) {
      this.state = 'limited';
      const capture = this.capture;
      capture.setReady(false);
      void capture.stop().then(() => {
        if (token === this.generation && this.state === 'limited') this.onLimit();
      }).catch(error => {
        if (token === this.generation) this.onError(error);
      });
    }
  }

  async finish() {
    if (this.result) return this.result;
    const token = ++this.generation;
    const capture = this.capture;
    this.capture = null;
    this.state = 'finishing';
    // Snapshot first; a new start or cancellation cannot mix these samples with
    // another recording while closing the old AudioContext takes time.
    const chunks = this.chunks;
    const count = this.sampleCount;
    if (capture) await capture.stop();
    if (token !== this.generation) throw DictationAudio.cancelled();
    this.onLevel(0);
    this.state = 'finished';
    if (count < 1600) throw new Error('Record at least 0.1 seconds of audio before transcribing.');
    const samples = new Array(count);
    let offset = 0;
    for (const chunk of chunks) for (const value of chunk) samples[offset++] = value;
    this.result = {samples, sampleRate: 16000, audioSeconds: count / 16000};
    this.chunks = [];
    return this.result;
  }

  async cancel() {
    const token = ++this.generation;
    const capture = this.capture;
    this.capture = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.result = null;
    this.state = 'idle';
    // getUserMedia cannot be aborted. The generation checks in start() and
    // ShowcaseAudio stop any stream that arrives after cancellation.
    if (capture) await capture.stop();
    if (token === this.generation) {
      this.onLevel(0);
      this.onDuration(0);
    }
  }

  static cancelled() {
    return new DOMException('Recording was cancelled.', 'AbortError');
  }

  static async decodeFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose an audio file.');
    if (Number.isFinite(file.size) && (file.size <= 0 || file.size > 64 * 1024 * 1024))
      throw new Error('Choose an audio file no larger than 64 MB.');
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024)
      throw new Error('Choose an audio file no larger than 64 MB.');
    const decoder = new AudioContext();
    let decoded;
    try {
      decoded = await decoder.decodeAudioData(bytes);
    } catch {
      throw new Error('This audio could not be decoded. Try WAV, MP3 or another supported format.');
    } finally {
      if (decoder.state !== 'closed') await decoder.close();
    }
    const seconds = decoded.length / decoded.sampleRate;
    if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 30)
      throw new Error('Audio must be between 0.1 and 30 seconds long.');
    const length = Math.round(seconds * 16000);
    const offline = new OfflineAudioContext(1, length, 16000);
    const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const channel = mono.getChannelData(0);
    for (let index = 0; index < decoded.numberOfChannels; index++) {
      const source = decoded.getChannelData(index);
      for (let sample = 0; sample < source.length; sample++) channel[sample] += source[sample] / decoded.numberOfChannels;
    }
    const source = offline.createBufferSource();
    source.buffer = mono;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    source.disconnect();
    const samples = Array.from(rendered.getChannelData(0), value => Math.max(-1, Math.min(1, value)));
    if (samples.some(value => !Number.isFinite(value))) throw new Error('The audio contains invalid samples.');
    return {samples, sampleRate: 16000, audioSeconds: samples.length / 16000};
  }
};
