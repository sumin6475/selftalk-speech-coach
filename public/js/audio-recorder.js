// Mic capture → PCM16 16kHz → base64 chunks
export class AudioRecorder {
  constructor() {
    this.audioContext = null;
    this.stream = null;
    this.workletNode = null;
    this.analyser = null;
    this.analyserData = null;
    this.onAudioData = null; // callback: (base64String) => void
    this.volume = 0; // 0-1 normalized volume level
    this._volumeRAF = null;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone access requires localhost or HTTPS. Open http://localhost:8000 instead.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    await this.audioContext.audioWorklet.addModule("/js/pcm-processor.js");

    const source = this.audioContext.createMediaStreamSource(this.stream);

    // Analyser for volume metering
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
    source.connect(this.analyser);
    this._updateVolume();

    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");

    this.workletNode.port.onmessage = (event) => {
      if (this.onAudioData) {
        const buffer = event.data;
        const base64 = this._arrayBufferToBase64(buffer);
        this.onAudioData(base64);
      }
    };

    source.connect(this.workletNode);
    // Do NOT connect worklet to destination — that would echo mic back to speakers
  }

  _updateVolume() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sum += this.analyserData[i];
    }
    this.volume = Math.min(1, (sum / this.analyserData.length) / 128);
    this._volumeRAF = requestAnimationFrame(() => this._updateVolume());
  }

  stop() {
    if (this._volumeRAF) {
      cancelAnimationFrame(this._volumeRAF);
      this._volumeRAF = null;
    }
    this.volume = 0;
    this.analyser = null;
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
