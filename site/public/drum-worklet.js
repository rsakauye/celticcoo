// Audio worklet for the drum practice page. It reduces each 128-sample block
// to one transient level (RMS of the first difference, the same formula as
// blockLevel in src/lib/drumPractice.js) and posts [time, level] pairs.
// The samples are never copied out, stored, or sent anywhere.
class DrumLevels extends AudioWorkletProcessor {
  constructor() {
    super();
    this.prev = 0;
    this.pairs = [];
  }

  process(inputs) {
    const block = inputs[0] && inputs[0][0];
    if (block && block.length) {
      let sum = 0;
      let last = this.prev;
      for (let i = 0; i < block.length; i += 1) {
        const d = block[i] - last;
        sum += d * d;
        last = block[i];
      }
      this.prev = last;
      this.pairs.push(currentFrame / sampleRate, Math.sqrt(sum / block.length));
      if (this.pairs.length >= 16) {
        this.port.postMessage(this.pairs);
        this.pairs = [];
      }
    }
    return true;
  }
}

registerProcessor('drum-levels', DrumLevels);
