// vida.js - desenha o trem, os trilhos e as gaivotas como malha, junto com o aviao (cabin.js).
// As posicoes vem do C (vida.c): tipo, x, y, z, rumo, arfagem, rolagem e fase da asa.
// Tudo e levado para o referencial do aviao (o mesmo da cabine) por uma matriz por objeto, entao
// usa a mesma luz, o mesmo contorno, o mesmo reflexo na agua e a mesma oclusao pelo relevo.
import { Mesh, M_EXT, VF, IDENT, hex, add, mul, sub, len, norm, cross } from './malha.js';

const M_WIN = 13;   // janela acesa a noite (cabin.js)
const OBJ_F = 8, OBJ_LOCO = 0, OBJ_CAR = 1, OBJ_GULL = 2;
const WORLD = 16384;
const wrapd = (d) => d - Math.round(d / WORLD) * WORLD;
const C = {
  wine: hex('#7d1f1b'), cream: hex('#e6dcc3'), gold: hex('#d1a43c'), dark: hex('#262628'), steel: hex('#5b5d62'),
  green: hex('#2f5d46'), glass: hex('#1d2a33'), roof: hex('#5d5f63'), wood: hex('#5a4434'), rail: hex('#8a8d93'),
  white: hex('#f4f2ec'), grey: hex('#a7adb4'), tip: hex('#202022'), beak: hex('#e5b62c'),
};
const box = (m, c, h, col, mat = M_EXT) => m.rbox(c, IDENT, h, Math.min(0.06, Math.min(...h) * 0.4), { col, mat, step: 2.0 });

// locomotiva diesel (17 m): cabine na frente, capo comprido, faixa dourada
function buildLoco(m) {
  const z0 = 1.1;   // altura do estrado acima do trilho
  box(m, [0, 0, z0 - 0.35], [8.3, 1.25, 0.25], C.dark);                 // estrado
  box(m, [-1.2, 0, z0 + 1.2], [6.6, 1.15, 1.2], C.wine);               // capo
  box(m, [-1.2, 0, z0 + 0.55], [6.62, 1.17, 0.07], C.gold);            // faixa
  box(m, [6.0, 0, z0 + 1.55], [1.9, 1.45, 1.55], C.wine);              // cabine
  box(m, [6.0, 0, z0 + 3.15], [2.0, 1.5, 0.08], C.roof);               // teto
  box(m, [7.92, 0, z0 + 2.2], [0.03, 1.05, 0.45], C.glass, M_WIN);     // para-brisa (cabine acesa a noite)
  for (const s of [-1, 1]) box(m, [6.2, s * 1.46, z0 + 2.2], [1.1, 0.02, 0.42], C.glass, M_WIN);
  m.cyl([8.0, 0, z0 + 1.0], [8.12, 0, z0 + 1.0], 0.2, { col: C.cream, mat: M_WIN }, 12);   // farol
  for (const s of [-1, 1]) m.cyl([8.0, s * 0.85, z0 + 0.62], [8.1, s * 0.85, z0 + 0.62], 0.09, { col: C.cream, mat: M_WIN }, 8);
  box(m, [7.95, 0, z0 + 0.5], [0.15, 1.3, 0.35], C.gold);              // limpa-trilhos
  box(m, [-1.6, 0, z0 + 2.48], [0.5, 0.5, 0.12], C.dark);              // escapamento
  for (const x of [-5.5, 5.0]) bogie(m, x);
}
// vagao de passageiros (15 m): verde com faixa creme e janelas
function buildCar(m) {
  const z0 = 1.1;
  box(m, [0, 0, z0 - 0.3], [7.4, 1.25, 0.22], C.dark);
  box(m, [0, 0, z0 + 1.3], [7.4, 1.4, 1.35], C.green);
  box(m, [0, 0, z0 + 1.65], [7.42, 1.42, 0.5], C.cream);
  for (let k = -5; k <= 5; k++) for (const s of [-1, 1]) box(m, [k * 1.3, s * 1.43, z0 + 1.68], [0.42, 0.02, 0.32], C.glass, M_WIN);
  box(m, [0, 0, z0 + 2.75], [7.3, 1.3, 0.12], C.roof);
  for (const x of [-4.9, 4.9]) bogie(m, x);
}
function bogie(m, x) {
  box(m, [x, 0, 0.62], [1.3, 1.0, 0.18], C.dark);
  for (const dx of [-0.85, 0.85]) for (const s of [-1, 1]) m.cyl([x + dx, s * 0.72, 0.46], [x + dx, s * 0.62, 0.46], 0.46, { col: C.steel, mat: M_EXT }, 10);
}
// gaivota (escala ~1,6 para ser vista do aviao): corpo, cabeca, bico, cauda; asas separadas
const GS = 2.0;
function buildGull(m) {
  m.capsule([-0.18 * GS, 0, 0], [0.16 * GS, 0, 0.01 * GS], 0.07 * GS, { col: C.white, mat: M_EXT }, 8);
  m.capsule([0.2 * GS, 0, 0.04 * GS], [0.22 * GS, 0, 0.045 * GS], 0.05 * GS, { col: C.white, mat: M_EXT }, 8);
  m.cyl([0.25 * GS, 0, 0.035 * GS], [0.33 * GS, 0, 0.03 * GS], 0.015 * GS, { col: C.beak, mat: M_EXT }, 6);
  box(m, [-0.27 * GS, 0, 0.005 * GS], [0.08 * GS, 0.07 * GS, 0.012 * GS], C.white);
}
function buildWing(m, s) {
  // asa na direcao s*y, presa no corpo (y = 0): cinza com ponta preta
  const span = 0.68 * GS;
  for (const [y0, y1, col, c0, c1] of [[0.04, 0.42, C.grey, 0.20, 0.17], [0.42, 0.68, C.tip, 0.17, 0.07]]) {
    const a = y0 * GS, b = y1 * GS;
    m.surf([0, 1], [0, 1], (u, v) => {
      const y = a + (b - a) * u, ch = (c0 + (c1 - c0) * u) * GS;
      return [0.05 * GS - v * ch, s * y, 0];
    }, { col, mat: M_EXT, ref: (p) => [p[0], p[1], -1] });
  }
  void span;
}

export class VidaGfx {
  constructor(cabin) {
    this.cab = cabin;
    const mk = (f) => { const m = new Mesh(); f(m); return cabin.upload(m, cabin.gl.STATIC_DRAW); };
    this.loco = mk(buildLoco);
    this.car = mk(buildCar);
    this.gull = mk(buildGull);
    this.wingL = mk((m) => buildWing(m, -1));
    this.wingR = mk((m) => buildWing(m, 1));
    this.track = null;
    this.trackAt = null;
    this.objs = new Float32Array(0);
    this.n = 0;
  }

  // dados do quadro: objetos do C, ferrovia (uma vez), aviao
  setFrame(objs, n, rail, I) {
    this.objs = objs; this.n = n;
    this.I = I;
    if (rail && rail.length > 6 && !this.rail) { this.rail = Float32Array.from(rail); this.buildTrack(); }
  }

  // a linha inteira, uma vez so: os trilhos numa malha e os dormentes como copias de um so dormente
  // (a placa repete o desenho; nada e refeito durante o voo)
  buildTrack() {
    const R = this.rail, n = R.length / 3, m = new Mesh(), gl = this.cab.gl;
    const inst = [];
    for (let k = 0; k + 1 < n; k++) {
      const ax = R[k * 3], ay = R[k * 3 + 1], az = R[k * 3 + 2], bx = R[k * 3 + 3], by = R[k * 3 + 4], bz = R[k * 3 + 5];
      const t = norm([bx - ax, by - ay, 0]), s = [t[1], -t[0], 0];
      const P = (x, y, z, o, h) => [x + s[0] * o, y + s[1] * o, z + h];
      for (const o of [-0.72, 0.72]) {   // trilhos: perfil simples (alma e boleto)
        const a0 = P(ax, ay, az, o - 0.04, 0.06), a1 = P(ax, ay, az, o + 0.04, 0.06), b0 = P(bx, by, bz, o - 0.04, 0.06), b1 = P(bx, by, bz, o + 0.04, 0.06);
        const up = [0, 0, 0.14];
        const v0 = m.n;
        for (const p of [a0, a1, b1, b0]) m.vert(add(p, up), [0, 0, 1], C.rail, M_EXT);
        m.quad(v0, v0 + 1, v0 + 2, v0 + 3);
        for (const [p, q, nn] of [[a0, b0, mul(s, -1)], [a1, b1, s]]) {
          const w = m.n;
          for (const pp of [p, q, add(q, up), add(p, up)]) m.vert(pp, nn, C.steel, M_EXT);
          m.quad(w, w + 1, w + 2, w + 3);
        }
      }
      const yaw = Math.atan2(t[1], t[0]);
      for (let j = 0; j < 12; j++) {   // dormentes a cada ~0,67 m
        const f = j / 12;
        inst.push(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f - 0.04, yaw);
      }
    }
    this.rails = this.cab.upload(m, gl.STATIC_DRAW);
    const sm = new Mesh();
    sm.rbox([0, 0, 0], IDENT, [0.11, 1.25, 0.08], 0.02, { col: C.wood, mat: M_EXT, step: 3 });
    this.sleeper = this.cab.upload(sm, gl.STATIC_DRAW);
    gl.bindVertexArray(this.sleeper.vao);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
    this.perSeg = 12;
  }

  // desenha trilhos e (perto da camera) dormentes; o mundo da a volta: desloca a linha para perto
  drawTrack(p) {
    if (!this.rails) return false;
    const gl = this.cab.gl, I = this.I, R = this.rail, n = R.length / 3;
    const cx = I[0], cy = I[1];
    let best = 1e18, bk = 0, lo = -1, hi = -1;
    for (let k = 0; k < n; k += 2) {
      const dx = wrapd(R[k * 3] - cx), dy = wrapd(R[k * 3 + 1] - cy), d = dx * dx + dy * dy;
      if (d < best) { best = d; bk = k; }
      if (d < 320 * 320) { if (lo < 0) lo = k; hi = k; }
    }
    if (best > 3000 * 3000) return false;
    const sx = cx + wrapd(R[bk * 3] - cx) - R[bk * 3], sy = cy + wrapd(R[bk * 3 + 1] - cy) - R[bk * 3 + 1];   // multiplo do tamanho do mundo
    gl.uniformMatrix4fv(p.u.uModel, false, this.model([sx, sy, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]));
    this.cab.draw(this.rails);
    if (lo >= 0) {
      const first = Math.max(0, lo - 1) * this.perSeg, count = (Math.min(n - 1, hi + 2) - Math.max(0, lo - 1)) * this.perSeg;
      gl.uniform1i(p.u.uInst, 1);
      gl.bindVertexArray(this.sleeper.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16, first * 16);
      gl.drawElementsInstanced(gl.TRIANGLES, this.sleeper.count, gl.UNSIGNED_INT, 0, count);
      gl.uniform1i(p.u.uInst, 0);
    }
    return true;
  }

  // farois do trem para o brilho (lights.js): posicao no mundo e direcao
  glows() {
    const out = [], O = this.objs;
    for (let i = 0; i < this.n; i++) {
      const o = i * OBJ_F;
      if (O[o] !== OBJ_LOCO) continue;
      const h = O[o + 4], f = [Math.cos(h), Math.sin(h), 0];
      const z0 = 1.1;
      out.push({ p: [O[o + 1] + f[0] * 8.15, O[o + 2] + f[1] * 8.15, O[o + 3] + z0 + 1.0], dir: f, r: 2.2, c: [1.0, 0.92, 0.75] });
    }
    return out;
  }

  // matriz: local (x frente, y direita, z cima) -> referencial do aviao
  model(pos, f, r, u) {
    const I = this.I, PF = [I[28], I[29], I[30]], PR = [I[31], I[32], I[33]], PU = [I[34], I[35], I[36]];
    const toB = (v) => [v[0] * PF[0] + v[1] * PF[1] + v[2] * PF[2], v[0] * PR[0] + v[1] * PR[1] + v[2] * PR[2], v[0] * PU[0] + v[1] * PU[1] + v[2] * PU[2]];
    const d = [wrapd(pos[0] - I[25]), wrapd(pos[1] - I[26]), pos[2] - I[27]];
    const a = toB(f), b = toB(r), c = toB(u), t = toB(d);
    return new Float32Array([a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, t[0], t[1], t[2], 1]);
  }

  // desenha com o programa principal da cabine (ja com camera e luz); devolve se desenhou algo
  draw(p) {
    if (!this.I) return false;
    const gl = this.cab.gl, loc = p.u.uModel, I = this.I;
    let drew = false;
    const camx = I[0], camy = I[1];
    if (this.drawTrack(p)) drew = true;
    const O = this.objs;
    for (let i = 0; i < this.n; i++) {
      const o = i * OBJ_F, kind = O[o];
      const pos = [O[o + 1], O[o + 2], O[o + 3]];
      const dist = Math.hypot(wrapd(pos[0] - camx), wrapd(pos[1] - camy), pos[2] - I[2]);
      if (dist > (kind === OBJ_GULL ? 700 : 4000)) continue;
      const h = O[o + 4], pt = O[o + 5], bank = O[o + 6];
      const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(pt), sp = Math.sin(pt);
      // (x frente, y direita, z cima) e canhoto no mundo, como o aviao: cima = direita x frente
      let f = [ch * cp, sh * cp, sp], r = [sh, -ch, 0], u = cross(r, f);
      if (bank) {   // rolagem em torno de f
        const cb = Math.cos(bank), sb = Math.sin(bank);
        const r2 = add(mul(r, cb), mul(u, -sb)), u2 = add(mul(u, cb), mul(r, sb));
        r = r2; u = u2;
      }
      const M = this.model(pos, f, r, u);
      gl.uniformMatrix4fv(loc, false, M);
      if (kind === OBJ_LOCO) this.cab.draw(this.loco);
      else if (kind === OBJ_CAR) this.cab.draw(this.car);
      else {
        this.cab.draw(this.gull);
        const flap = O[o + 7], ang = flap < -1.5 ? 0.12 : 0.15 + 0.65 * flap;   // planando: asas quase retas
        for (const [w, sg] of [[this.wingL, -1], [this.wingR, 1]]) {
          // gira a asa em torno do eixo x do corpo (a ponta sobe com ang > 0)
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const rr = add(mul(r, ca), mul(u, sg * sa)), uu = add(mul(u, ca), mul(r, -sg * sa));
          gl.uniformMatrix4fv(loc, false, this.model(pos, f, rr, uu));
          this.cab.draw(w);
        }
      }
      drew = true;
    }
    return drew;
  }
}

export { VF };
void len; void sub;
