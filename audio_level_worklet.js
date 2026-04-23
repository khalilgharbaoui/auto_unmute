class AutoUnmuteLevelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxRms = 0;
    this.blockCount = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (output) {
      for (const channel of output) channel.fill(0);
    }

    if (input && input[0] && input[0].length > 0) {
      const data = input[0];
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / data.length);
      if (rms > this.maxRms) this.maxRms = rms;
    }

    // Emit roughly every 10ms at 48kHz (4 * 128-frame render quanta).
    this.blockCount += 1;
    if (this.blockCount >= 4) {
      this.port.postMessage({ rms: this.maxRms });
      this.maxRms = 0;
      this.blockCount = 0;
    }
    return true;
  }
}

registerProcessor('auto-unmute-level', AutoUnmuteLevelProcessor);
