// audio-worklet.js - toca as faixas que o jogo sintetiza (em C) na thread principal.
// Cada fonte sai numa saida propria (o vento em estereo) para ser espacializada
// separadamente; os blocos chegam planares: canal * n + i.
const NOUT = 9;
const CH_OF_OUT = [[0], [1], [2, 3], [4], [5], [6], [7], [8], [9]];

class VooAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];
    this.off = 0;
    this.port.onmessage = (e) => this.q.push(e.data);
  }
  process(inputs, outputs) {
    const len = outputs[0][0].length;
    let i = 0;
    while (i < len) {
      if (!this.q.length) {
        for (let o = 0; o < NOUT; o++) for (const ch of outputs[o]) ch.fill(0, i);
        break;
      }
      const b = this.q[0];
      const n = Math.min(len - i, b.n - this.off);
      for (let o = 0; o < NOUT; o++) {
        const src = CH_OF_OUT[o];
        for (let c = 0; c < outputs[o].length; c++) {
          const k = src[Math.min(c, src.length - 1)];
          outputs[o][c].set(b.data.subarray(k * b.n + this.off, k * b.n + this.off + n), i);
        }
      }
      i += n;
      this.off += n;
      if (this.off >= b.n) { this.q.shift(); this.off = 0; }
    }
    return true;
  }
}
registerProcessor('voo-audio', VooAudio);
