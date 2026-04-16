// AudioWorklet processor: captures Float32 audio and converts to Int16 PCM
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4096; // larger chunks for smoother streaming
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0];
    for (let i = 0; i < float32.length; i++) {
      // Clamp and convert Float32 [-1, 1] to Int16
      const s = Math.max(-1, Math.min(1, float32[i]));
      this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    while (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.splice(0, this._bufferSize);
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        int16[i] = chunk[i];
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
