class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channel = options?.processorOptions?.inputChannel ?? 'all';
    this.recording = true;
    this.buffer = new Float32Array(2048);
    this.length = 0;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.recording = false;
        if (this.length) this.port.postMessage(this.buffer.slice(0, this.length));
        this.port.postMessage('stopped');
      }
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.recording || !channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      if (this.channel === 'all') {
        for (const channel of channels) sample += channel[i] || 0;
        sample /= channels.length;
      } else sample = channels[this.channel === 'second' ? 1 : 0]?.[i] ?? 0;
      this.buffer[this.length++] = sample;
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer);
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-recorder', PcmRecorder);
