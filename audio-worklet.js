// audio-worklet.js - toca os blocos de som que o jogo sintetiza (em C) na thread principal
class VooAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];
    this.off = 0;
    this.port.onmessage = (e) => this.q.push(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length) {
      if (!this.q.length) { out.fill(0, i); break; }
      const b = this.q[0];
      const n = Math.min(out.length - i, b.length - this.off);
      out.set(b.subarray(this.off, this.off + n), i);
      i += n;
      this.off += n;
      if (this.off >= b.length) { this.q.shift(); this.off = 0; }
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('voo-audio', VooAudio);
