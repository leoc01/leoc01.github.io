// lights.js - brilho das luzes do aviao (navegacao, farol rotativo, strobes, farol de pouso),
// desenhado na resolucao da tela por cima de tudo, com soma de luz (aditivo).
// Cada luz e um ponto (sprite) cujo tamanho cai com a distancia; o vertex shader testa se o
// centro esta escondido atras do relevo (G-buffer do mundo) ou atras da cabine (profundidade
// da malha) e entao some inteiro - o halo nao e cortado pela metade.
//
// Selecao no jogo (SELECT no controle, N no teclado): 0 apagadas, 1 navegacao + farol,
// 2 + strobes, 3 + farol de pouso e taxi.

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aP;   // posicao relativa a camera (camera: x direita, y cima, z frente) e raio (m)
layout(location = 1) in vec4 aC;   // cor e intensidade
uniform float uTanX, uHW, uPx;     // uPx: pixels por unidade de tela (meia largura)
uniform sampler2D uG;              // G-buffer do mundo (distancia, tipo)
uniform sampler2D uA;              // profundidade da cabine (w), 1x1 vazia fora da cabine
uniform vec2 uGSize, uASize;
out vec4 vC;
void main() {
    vec3 p = aP.xyz;
    vC = aC;
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    if (p.z < 0.1) return;
    vec2 ndc = vec2(p.x / (p.z * uTanX), p.y / (p.z * uTanX * uHW));
    if (abs(ndc.x) > 1.2 || abs(ndc.y) > 1.2) return;
    float d = length(p);
    vec2 uv = ndc * 0.5 + 0.5;
    vec4 g = texelFetch(uG, ivec2(clamp(uv, 0.0, 0.999) * uGSize), 0);
    int k = int(g.y + 0.5);
    if (k != 0 && k != 1 && k != 7 && g.x < d * 0.98 - 1.0) return;   // atras do relevo ou de predios
    vec4 a = texelFetch(uA, ivec2(clamp(uv, 0.0, 0.999) * uASize), 0);
    if (a.w > 0.0 && a.w < d - 0.25) return;                           // atras da cabine ou da asa
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = clamp(aP.w / p.z * uPx, 3.0, 160.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec4 vC;
out vec4 o;
void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.35, 0.0, r), halo = pow(1.0 - r, 2.2);
    vec3 c = vC.rgb * (halo * 0.55 + core * 1.2) * vC.a + vec3(core * core * 0.6 * vC.a);
    o = vec4(c, 0.0);
}`;

// luzes no referencial do aviao (x frente, y direita, z cima): posicao, raio do brilho, cor, nivel minimo
const DEFS = [
  { p: [0.95, -5.66, 0.90], r: 0.9, c: [1.0, 0.12, 0.08], lv: 1 },                 // navegacao esquerda
  { p: [0.95, 5.66, 0.90], r: 0.9, c: [0.15, 1.0, 0.30], lv: 1 },                  // direita
  { p: [-5.56, 0, 0.50], r: 0.7, c: [1.0, 0.98, 0.92], lv: 1 },                    // cauda
  { p: [-5.05, 0, 2.00], r: 1.2, c: [1.0, 0.10, 0.05], lv: 1, kind: 'beacon' },     // farol rotativo
  { p: [0.90, -5.70, 0.90], r: 2.4, c: [1.0, 1.0, 1.0], lv: 2, kind: 'strobe' },    // strobes nas pontas
  { p: [0.90, 5.70, 0.90], r: 2.4, c: [1.0, 1.0, 1.0], lv: 2, kind: 'strobe' },
  { p: [3.02, 0, -0.24], r: 1.4, c: [1.0, 0.93, 0.78], lv: 3, kind: 'land' },        // farol de pouso no nariz
];

export class Lights {
  constructor(gl, compile) {
    this.gl = gl;
    this.prog = compile(VS, FS);
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.data = new Float32Array(DEFS.length * 8);
    this.empty = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  // posicao e direcao do farol de pouso no mundo (para o shader da cena iluminar o chao)
  static landing(I) {
    if (I[88] < 3 || I[38] > 0.5) return null;
    const f = [I[28], I[29], I[30]], u = [I[34], I[35], I[36]];
    const pos = [0, 1, 2].map((k) => I[25 + k] + f[k] * 3.0 - u[k] * 0.24);
    const d = [0, 1, 2].map((k) => f[k] - u[k] * 0.07), l = Math.hypot(...d);
    return { pos, dir: d.map((v) => v / l) };
  }

  // gTex/gW/gH: G-buffer do mundo; aTex/aW/aH: profundidade da cabine (ou null)
  draw(I, time, W, H, gTex, gW, gH, aTex, aW, aH) {
    const gl = this.gl, lv = I[88] | 0;
    if (lv <= 0 || I[38] > 0.5) return;
    const PF = [I[28], I[29], I[30]], PR = [I[31], I[32], I[33]], PU = [I[34], I[35], I[36]];
    const CF = [I[3], I[4], I[5]], CR = [I[6], I[7], I[8]], CU = [I[9], I[10], I[11]];
    const cockpit = I[17] > 0;
    // aviao -> camera: na cabine pelo olho no corpo (sem tremer); fora pela diferenca de posicoes
    const off = cockpit ? [0, 1, 2].map((k) => -(PF[k] * I[83] + PR[k] * I[84] + PU[k] * I[85]))
                        : [0, 1, 2].map((k) => I[25 + k] - I[k]);
    const day = Math.min(1, Math.max(0, I[22] * 3));   // de dia o brilho fica bem menor
    const dark = I[87] > 0.5 ? 1 : 1 - 0.75 * day;
    let n = 0;
    for (const L of DEFS) {
      if (lv < L.lv) continue;
      let inten = 1;
      if (L.kind === 'beacon') { const ph = (time * 1.1) % 1; inten = ph < 0.13 ? 1 : ph < 0.25 ? 0.25 : 0.04; }
      if (L.kind === 'strobe') { const ph = time % 1.3; inten = (ph < 0.05 || (ph > 0.16 && ph < 0.21)) ? 1.6 : 0; }
      const w = [0, 1, 2].map((k) => PF[k] * L.p[0] + PR[k] * L.p[1] + PU[k] * L.p[2] + off[k]);
      if (L.kind === 'land') {   // farol de pouso: forte so de frente para ele
        const dir = [0, 1, 2].map((k) => PF[k] - PU[k] * 0.07), dl = Math.hypot(...w) || 1;
        const c = -(dir[0] * w[0] + dir[1] * w[1] + dir[2] * w[2]) / dl;
        inten = 0.15 + 1.6 * Math.pow(Math.max(c, 0), 6);
      }
      if (inten <= 0) continue;
      const o = n * 8;
      this.data[o] = w[0] * CR[0] + w[1] * CR[1] + w[2] * CR[2];
      this.data[o + 1] = w[0] * CU[0] + w[1] * CU[1] + w[2] * CU[2];
      this.data[o + 2] = w[0] * CF[0] + w[1] * CF[1] + w[2] * CF[2];
      this.data[o + 3] = L.r * (L.kind === 'strobe' ? 1 : 1);
      this.data[o + 4] = L.c[0]; this.data[o + 5] = L.c[1]; this.data[o + 6] = L.c[2];
      this.data[o + 7] = inten * dark;
      n++;
    }
    if (!n) return;
    const p = this.prog;
    gl.useProgram(p);
    gl.uniform1f(p.u.uTanX, I[12]);
    gl.uniform1f(p.u.uHW, H / W);
    gl.uniform1f(p.u.uPx, W / 2 / I[12]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gTex); gl.uniform1i(p.u.uG, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, aTex || this.empty); gl.uniform1i(p.u.uA, 1);
    gl.uniform2f(p.u.uGSize, gW, gH);
    gl.uniform2f(p.u.uASize, aTex ? aW : 1, aTex ? aH : 1);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, n * 8), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
