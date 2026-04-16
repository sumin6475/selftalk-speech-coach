// base64 PCM16 → Float32 → gapless playback at 24kHz
export class AudioStreamer {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.scheduledTime = 0;
    this.sampleRate = 24000;
  }

  init() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      this.scheduledTime = this.audioContext.currentTime;
    }
  }

  addChunk(base64) {
    if (!this.audioContext) this.init();

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buf = this.audioContext.createBuffer(1, float32.length, this.sampleRate);
    buf.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buf;
    source.connect(this.gainNode);

    // Schedule sequentially for gapless playback
    const now = this.audioContext.currentTime;
    if (this.scheduledTime < now) {
      this.scheduledTime = now;
    }
    source.start(this.scheduledTime);
    this.scheduledTime += buf.duration;
  }

  clearQueue() {
    // Instant silence: disconnect and recreate gain node
    if (this.gainNode) {
      this.gainNode.disconnect();
    }
    if (this.audioContext) {
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      this.scheduledTime = this.audioContext.currentTime;
    }
  }

  stop() {
    this.clearQueue();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.gainNode = null;
    }
  }
}
