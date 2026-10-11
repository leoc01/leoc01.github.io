// cabin.js - a cabine do Cessna como malha 3D de verdade (triangulos), so na camera de cabine.
//
// O mundo continua sendo tracado por raios em baixa resolucao; a cabine e rasterizada por cima,
// na resolucao da tela, com:
//   - sombra do sol (mapa de sombra): a luz entra pelas janelas e desenha manchas no painel e
//     nos bancos, e a asa faz sombra no capo quando o sol esta baixo;
//   - oclusao ambiente por vertice (cantos e vaos mais escuros), calculada uma vez com um
//     campo de distancia simplificado da cabine;
//   - luz em faixas (mesmo estilo ilustrado do resto) e contorno de desenho nas bordas;
//   - o aviao visto de dentro: capo, spinner, helice (disco translucido com rastro das pas),
//     asas com flaps e ailerons que se mexem, montantes e a cauda pela janela de tras.
// Antes de tracar o mundo, uma mascara da cabine em baixa resolucao marca os pixels cobertos
// (encolhida 1 pixel nas bordas) e o teste de profundidade pula o raymarching ali.
//
// Referencial do aviao: x para frente, y para a direita, z para cima (metros, origem no CG).
import { PanelArt, PANEL, FLAPS, THROTTLE, MIXTURE, GLARE, glareEdgeZ, R_PANEL, R_COMP, R_EMBLEM, R_PED, PED_SCALE, atlasUV } from './cockpit.js';

// ---------------------------------------------------------------------------
// vetores
// ---------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const rad = (d) => d * Math.PI / 180;

// ---------------------------------------------------------------------------
// cores e materiais
// ---------------------------------------------------------------------------
const COL = {
  cream: hex('#ddd3bb'), creamDk: hex('#c9bea4'), red: hex('#8e2a24'), redDk: hex('#6e1f1b'), seat: hex('#a3322b'),
  carpet: hex('#4a3d37'), leather: hex('#2b292d'), black: hex('#19191c'), dark: hex('#2e2d31'), chrome: hex('#b9bcc2'),
  white: hex('#eeeeea'), redExt: hex('#c72a24'), blue: hex('#29408c'), tyre: hex('#111111'),
  shirt: hex('#9fb9d4'), skin: hex('#d9a582'), jeans: hex('#34486b'), shoe: hex('#3a2a20'), knobRed: hex('#c2241c'),
  green: hex('#2fd04a'), navRed: hex('#ff2a1a'), yellow: hex('#f2c230'),
};
// materiais (o shader decide a luz): 0 interior liso, 1 textura do painel, 2 casco (janelas e
// zonas de cor), 3 tecido dos bancos, 4 disco da helice, 5 exterior, 6 cromado, 7 vidro das janelas
// (copia do casco, so onde ha janela), 8 vidro do para-brisa
const M_IN = 0, M_TEX = 1, M_SHELL = 2, M_SEAT = 3, M_PROP = 4, M_EXT = 5, M_CHROME = 6, M_GLASS = 7, M_WSHIELD = 8;
const VF = 13;   // floats por vertice: pos3 normal3 cor3 material uv2 oclusao

// ---------------------------------------------------------------------------
// geometria da cabine (precisa bater com o shader: ver SHELL_GLSL)
// ---------------------------------------------------------------------------
const X_AFT = -1.70, X_FWD = 1.46;
const roofZ = (x) => x > -0.45 ? 0.80 : 0.80 - (-0.45 - x) * 0.192;
const floorZ = (x) => -0.40 + 0.12 * sstep(-0.6, -1.70, x);
const halfW = (x) => 0.565 - 0.095 * sstep(-0.7, -1.70, x);
const RB = 0.12, RT = 0.14;          // raios dos cantos de baixo e de cima da secao
const xws = (z) => 1.29 - (z - 0.245) * 0.53;   // linha do para-brisa: (1.29, 0.245) a (1.0, 0.80)
const PX = PANEL.PX;                  // plano do painel
const YOKE_Y = [-0.27, 0.27], YOKE_Z = 0.035, YOKE_X = 0.95;
// pedestal (embaixo do meio do painel), roda do trim e a placa da escala
const PED = { x: 1.10, hx: 0.05, hy: 0.075, zc: -0.215, hz: 0.155 };
const TRIMW = { x: 1.13, y: -0.028, z: -0.205, r: 0.072, w: 0.011 };
const PLATE = { y0: 0.018, y1: 0.062, z0: -0.165, z1: -0.165 - 0.0825 };

// ponto da secao transversal (retangulo arredondado) no comprimento de arco s (0..1, volta inteira)
function sectionPoint(x, s) {
  const w = halfW(x), f = floorZ(x), r = roofZ(x);
  const segs = [
    ['l', [0, f], [w - RB, f]],
    ['a', [w - RB, f + RB], RB, -Math.PI / 2, 0],
    ['l', [w, f + RB], [w, r - RT]],
    ['a', [w - RT, r - RT], RT, 0, Math.PI / 2],
    ['l', [w - RT, r], [-(w - RT), r]],
    ['a', [-(w - RT), r - RT], RT, Math.PI / 2, Math.PI],
    ['l', [-w, r - RT], [-w, f + RB]],
    ['a', [-(w - RB), f + RB], RB, Math.PI, Math.PI * 1.5],
    ['l', [-(w - RB), f], [0, f]],
  ];
  const L = segs.map((g) => g[0] === 'l' ? Math.hypot(g[2][0] - g[1][0], g[2][1] - g[1][1]) : g[2] * (g[4] - g[3]));
  let d = (((s % 1) + 1) % 1) * L.reduce((a, b) => a + b, 0);
  for (let i = 0; i < segs.length; i++) {
    if (d <= L[i] || i === segs.length - 1) {
      const g = segs[i], t = L[i] > 0 ? Math.min(d / L[i], 1) : 0;
      if (g[0] === 'l') return [x, lerp(g[1][0], g[2][0], t), lerp(g[1][1], g[2][1], t)];
      const a = lerp(g[3], g[4], t);
      return [x, g[1][0] + g[2] * Math.cos(a), g[1][1] + g[2] * Math.sin(a)];
    }
    d -= L[i];
  }
  return [x, 0, f];
}

// ---------------------------------------------------------------------------
// campo de distancia (so para a oclusao ambiente por vertice)
// ---------------------------------------------------------------------------
class SDF {
  constructor() { this.prims = []; }
  // caixa arredondada orientada: c centro, ax eixos (3 vetores unitarios), h meia-medida, r raio
  box(c, ax, h, r) { this.prims.push({ t: 0, c, ax, h, r, R: len(h) + r }); }
  cap(a, b, r) { this.prims.push({ t: 1, a, b, r, c: mul(add(a, b), 0.5), R: len(sub(b, a)) / 2 + r }); }
  inner(p) {   // distancia ate as paredes do casco, por dentro (positiva dentro)
    const x = p[0], y = p[1], z = p[2];
    let fx = PX - x;
    if (z < -0.16) fx = PX + (-0.16 - z) / 0.24 * 0.26 - x;
    return Math.min(z - floorZ(x), roofZ(x) - z, halfW(x) - Math.abs(y), x - X_AFT, fx);
  }
  at(p) {
    let d = this.inner(p);
    for (const q of this.prims) {
      const dc = sub(p, q.c);
      if (dot(dc, dc) > (q.R + Math.max(d, 0) + 0.05) ** 2) continue;
      let e;
      if (q.t === 0) {
        const l = [Math.abs(dot(dc, q.ax[0])) - q.h[0], Math.abs(dot(dc, q.ax[1])) - q.h[1], Math.abs(dot(dc, q.ax[2])) - q.h[2]];
        const o = [Math.max(l[0], 0), Math.max(l[1], 0), Math.max(l[2], 0)];
        e = len(o) + Math.min(Math.max(l[0], l[1], l[2]), 0) - q.r;
      } else {
        const ba = sub(q.b, q.a), pa = sub(p, q.a);
        const t = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
        e = len(sub(pa, mul(ba, t))) - q.r;
      }
      if (e < d) d = e;
    }
    return d;
  }
  ao(p, n) {
    let occ = 0, w = 1;
    for (let i = 0; i < 5; i++) {
      const h = 0.012 + 0.04 * i;
      occ += (h - this.at(add(p, mul(n, h)))) * w;
      w *= 0.72;
    }
    return clamp(1 - 2.4 * occ, 0.3, 1);
  }
}

// ---------------------------------------------------------------------------
// construtor de malha
// ---------------------------------------------------------------------------
class Mesh {
  constructor() { this.v = []; this.i = []; this.n = 0; this.aoFrom = []; }
  vert(p, n, c, mat, uv, ao = 1) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], mat, uv ? uv[0] : 0, uv ? uv[1] : 0, ao);
    return this.n++;
  }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // superficie parametrica P(u, v) com listas de parametros; normais por diferencas finitas,
  // orientadas para fora de o.ref(p) (ou para dentro, com o.inward)
  surf(U, Vs, P, o) {
    const base = this.n, nu = U.length, e = 1e-4;
    const mat = o.mat ?? M_IN;
    if (o.ao) this.aoFrom.push(this.n);
    for (let j = 0; j < Vs.length; j++) {
      for (let i = 0; i < nu; i++) {
        const u = U[i], v = Vs[j], p = P(u, v);
        const u0 = i > 0 ? Math.max(u - e, U[0]) : u, u1 = i < nu - 1 ? Math.min(u + e, U[nu - 1]) : u;
        const v0 = j > 0 ? Math.max(v - e, Vs[0]) : v, v1 = j < Vs.length - 1 ? Math.min(v + e, Vs[Vs.length - 1]) : v;
        let n = cross(sub(P(u1, v), P(u0, v)), sub(P(u, v1), P(u, v0)));
        const ref = o.ref ? o.ref(p) : [0, 0, 0];
        if (len(n) < 1e-12) n = sub(p, ref);
        n = norm(n);
        if ((dot(n, sub(p, ref)) < 0) !== !!o.inward) n = mul(n, -1);
        const c = typeof o.col === 'function' ? o.col(p, u, v) : o.col;
        this.vert(p, n, c, mat, o.uv ? o.uv(p, u, v) : null);
      }
    }
    for (let j = 0; j < Vs.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i;
      this.quad(a, a + 1, a + nu + 1, a + nu);
    }
    if (o.ao) this.aoFrom.push(this.n);
    else this.aoFrom.push(-1, -1);
  }
  // caixa arredondada: c centro, ax eixos, h meias-medidas, r raio dos cantos
  rbox(c, ax, h, r, o) {
    const coords = (hh) => {
      const a = [-hh, -hh + 0.35 * r, -hh + r];
      const mid = Math.max(1, Math.ceil((2 * (hh - r)) / (o.step || 0.12)));
      for (let k = 1; k < mid; k++) a.push(-hh + r + (2 * (hh - r)) * k / mid);
      a.push(hh - r, hh - 0.35 * r, hh);
      return a.filter((v, i, arr) => i === 0 || v > arr[i - 1] + 1e-6);
    };
    const C = [coords(h[0]), coords(h[1]), coords(h[2])];
    const P = (q) => {
      const pc = [clamp(q[0], -h[0] + r, h[0] - r), clamp(q[1], -h[1] + r, h[1] - r), clamp(q[2], -h[2] + r, h[2] - r)];
      const d = norm(sub(q, pc)), l = add(pc, mul(d, r));
      return add(c, add(add(mul(ax[0], l[0]), mul(ax[1], l[1])), mul(ax[2], l[2])));
    };
    const ref = () => c;
    for (let k = 0; k < 3; k++) {
      const i1 = (k + 1) % 3, i2 = (k + 2) % 3;
      for (const sg of [-1, 1]) {
        this.surf(C[i1], C[i2], (u, v) => { const q = [0, 0, 0]; q[k] = sg * h[k]; q[i1] = u; q[i2] = v; return P(q); },
          { ...o, ref, uv: o.uv ? (p) => o.uv(p, sub(p, c)) : null });
      }
    }
    if (o.sdf) o.sdf.box(c, ax, sub(h, [r, r, r]).map((v) => Math.max(v, 0)), r);
  }
  // solido de revolucao com normais exatas: perfil [{s, r, ns, nr}] ao longo do eixo a->b
  lathe(a, b, prof, segs, o) {
    const ax = norm(sub(b, a));
    const t0 = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(cross(ax, t0)), e2 = cross(ax, e1);
    const base = this.n, mat = o.mat ?? M_IN;
    if (o.ao) this.aoFrom.push(this.n);
    for (const q of prof) {
      for (let k = 0; k <= segs; k++) {
        const ang = (k / segs) * Math.PI * 2 + (o.phase || 0);
        const rd = add(mul(e1, Math.cos(ang)), mul(e2, Math.sin(ang)));
        const p = add(add(a, mul(ax, q.s)), mul(rd, q.r));
        const n = norm(add(mul(ax, q.ns), mul(rd, q.nr)));
        this.vert(p, n, q.col || o.col, mat, o.uv ? o.uv(q, k / segs) : null);
      }
    }
    for (let j = 0; j < prof.length - 1; j++) for (let k = 0; k < segs; k++) {
      const i = base + j * (segs + 1) + k;
      this.quad(i, i + 1, i + segs + 2, i + segs + 1);
    }
    if (o.ao) this.aoFrom.push(this.n);
    else this.aoFrom.push(-1, -1);
  }
  capsule(a, b, r, o, segs = 10) {
    const L = len(sub(b, a)), prof = [];
    for (let k = 0; k <= 3; k++) { const f = -Math.PI / 2 + (k / 3) * Math.PI / 2; prof.push({ s: r * Math.sin(f), r: r * Math.cos(f) + 1e-5, ns: Math.sin(f), nr: Math.cos(f) }); }
    for (let k = 0; k <= 3; k++) { const f = (k / 3) * Math.PI / 2; prof.push({ s: L + r * Math.sin(f), r: r * Math.cos(f) + 1e-5, ns: Math.sin(f), nr: Math.cos(f) }); }
    this.lathe(a, b, prof, segs, o);
    if (o.sdf) o.sdf.cap(a, b, r);
  }
  // cilindro (tubo) com tampas chatas
  cyl(a, b, r, o, segs = 12) {
    const L = len(sub(b, a));
    this.lathe(a, b, [{ s: 0, r: 1e-5, ns: -1, nr: 0 }, { s: 0, r, ns: -1, nr: 0 }, { s: 0, r, ns: 0, nr: 1 },
                      { s: L, r, ns: 0, nr: 1 }, { s: L, r, ns: 1, nr: 0 }, { s: L, r: 1e-5, ns: 1, nr: 0 }], segs, o);
  }
  // perfil (x, z) extrudado ao longo de y; normais suaves (ou quinas com o.sharp), tampas opcionais
  extrude(prof, ys, o) {
    const n = prof.length, closed = !!o.closed, mat = o.mat ?? M_IN;
    const ref = o.ref || prof.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
    const nrm = prof.map((p, i) => {
      const a = prof[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)], b = prof[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
      let t = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(t[0], t[1]) || 1; t = [t[0] / l, t[1] / l];
      let nn = [t[1], -t[0]];
      if ((p[0] - ref[0]) * nn[0] + (p[1] - ref[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
      return nn;
    });
    const base = this.n;
    if (o.ao) this.aoFrom.push(this.n);
    for (const y of ys) for (let i = 0; i < n; i++) {
      const c = typeof o.col === 'function' ? o.col(prof[i], y, i) : o.col;
      const P = o.map ? o.map([prof[i][0], y, prof[i][1]]) : [prof[i][0], y, prof[i][1]];
      let N = [nrm[i][0], 0, nrm[i][1]];
      if (o.mapN) N = o.mapN(N);
      this.vert(P, N, c, mat, o.uv ? o.uv(prof[i], y) : null);
    }
    const segs = closed ? n : n - 1;
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < segs; i++) {
      const a = base + j * n + i, b = base + j * n + (i + 1) % n;
      this.quad(a, b, b + n, a + n);
    }
    if (o.ao) this.aoFrom.push(this.n);
    else this.aoFrom.push(-1, -1);
    // tampas (leque a partir do centro do perfil)
    for (const [y, sg] of o.caps || []) {
      const cb = this.n;
      const cc = o.map ? o.map([ref[0], y, ref[1]]) : [ref[0], y, ref[1]];
      let N = [0, sg, 0];
      if (o.mapN) N = o.mapN(N);
      const c = o.capCol || (typeof o.col === 'function' ? o.col(prof[0], y, 0) : o.col);
      this.vert(cc, N, c, mat);
      for (let i = 0; i < n; i++) this.vert(o.map ? o.map([prof[i][0], y, prof[i][1]]) : [prof[i][0], y, prof[i][1]], N, c, mat);
      for (let i = 0; i < n; i++) this.i.push(cb, cb + 1 + i, cb + 1 + (i + 1) % n);
    }
  }
  // quadrilatero plano (4 cantos), subdividido nu x nv (para a oclusao)
  plane(p00, p10, p01, nu, nv, o) {
    const U = [], Vv = [];
    for (let i = 0; i <= nu; i++) U.push(i / nu);
    for (let j = 0; j <= nv; j++) Vv.push(j / nv);
    const du = sub(p10, p00), dv = sub(p01, p00);
    this.surf(U, Vv, (u, v) => add(p00, add(mul(du, u), mul(dv, v))), { ...o, ref: o.ref || (() => add(p00, mul(norm(cross(du, dv)), -1))) });
  }
  // oclusao ambiente nos trechos marcados
  bakeAO(sdf) {
    for (let k = 0; k < this.aoFrom.length; k += 2) {
      const a = this.aoFrom[k], b = this.aoFrom[k + 1];
      if (a < 0) continue;
      for (let i = a; i < b; i++) {
        const o = i * VF;
        const p = [this.v[o], this.v[o + 1], this.v[o + 2]], n = [this.v[o + 3], this.v[o + 4], this.v[o + 5]];
        this.v[o + 12] = sdf.ao(add(p, mul(n, 0.002)), n);
      }
    }
  }
}

const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const tilt = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];   // a > 0: topo inclinado para tras
const seatUV = (p, l) => [l[1], l[2] + l[0]];

// ---------------------------------------------------------------------------
// partes fixas
// ---------------------------------------------------------------------------
function buildStatic(m, sdf) {
  // ----- casco: tubo com secao arredondada, janelas recortadas no shader -----
  {
    const U = [];
    for (let x = X_AFT; x < X_FWD - 1e-6; x += 0.06) U.push(x);
    U.push(X_FWD);
    const S = [];
    for (let k = 0; k <= 72; k++) S.push(k / 72);
    m.surf(U, S, (x, s) => sectionPoint(x, s), { col: COL.cream, mat: M_SHELL, ref: (p) => [p[0], 0, 0.2], inward: true, ao: true });
    // antepara do bagageiro, la atras
    const B = [];
    for (let k = 0; k <= 36; k++) B.push(sectionPoint(X_AFT + 0.001, k / 36));
    const cb = m.n;
    m.vert([X_AFT + 0.001, 0, 0.12], [1, 0, 0], COL.creamDk, M_IN);
    for (const p of B) m.vert(p, [1, 0, 0], COL.creamDk, M_IN);
    for (let k = 0; k < 36; k++) m.i.push(cb, cb + 1 + k, cb + 2 + k);
  }
  // ----- painel (textura), laterais, painel de baixo e parede de fogo -----
  {
    const y0 = -PANEL.PW / 2, y1 = PANEL.PW / 2, uv = atlasUV(R_PANEL);
    m.plane([PX, y0, PANEL.TOP], [PX, y1, PANEL.TOP], [PX, y0, PANEL.PZ0], 14, 5, {
      col: [1, 1, 1], mat: M_TEX, ao: true, ref: () => [PX + 1, 0, 0.1],
      uv: (p) => [lerp(uv[0], uv[2], (p[1] - y0) / PANEL.PW), lerp(uv[1], uv[3], (PANEL.TOP - p[2]) / (PANEL.TOP - PANEL.PZ0))],
    });
    for (const s of [-1, 1]) {   // sobras dos lados: creme embaixo, couro da pala descendo em cima
      const Y = [0, 0.25, 0.5, 0.75, 1], V = [0, 0.5, 1], yAt = (u) => s * lerp(PANEL.PW / 2, 0.57, u);
      m.surf(Y, V, (u, v) => [PX, yAt(u), lerp(PANEL.PZ0, glareEdgeZ(yAt(u)), v)], { col: COL.cream, ao: true, ref: () => [PX + 1, 0, 0.1] });
      m.surf(Y, V, (u, v) => [PX, yAt(u), lerp(glareEdgeZ(yAt(u)), PANEL.TOP + 0.01, v)], { col: COL.leather, ao: true, ref: () => [PX + 1, 0, 0.1] });
    }
    m.plane([PX, -0.57, PANEL.PZ0], [PX, 0.57, PANEL.PZ0], [PX, -0.57, -0.16], 12, 1, { col: COL.redDk, ao: true, ref: () => [PX + 1, 0, 0.1] });
    m.plane([PX, -0.57, -0.16], [PX, 0.57, -0.16], [X_FWD, -0.57, -0.42], 12, 3, { col: COL.carpet, ao: true, ref: () => [PX + 1, 0, 0.3] });
  }
  // ----- pala de couro preto, arredondada, por cima do painel -----
  {
    // tampo: da borda arredondada ate a base do para-brisa
    const top = GLARE.z + 0.011;
    const prof = [[PX - 0.004, top], [1.215, top + 0.002], [1.25, top - 0.004], [1.29, 0.247], [1.32, 0.243]];
    const ys = []; for (let y = -0.57; y <= 0.5701; y += 0.095) ys.push(y);
    m.extrude(prof, ys, { col: COL.leather, ao: true, ref: [1.25, 0.1] });
    sdf.box([1.25, 0, 0.255], IDENT, [0.05, 0.57, 0.012], 0.0);
    // faixa de couro entre o alto do painel e o tampo (nos cantos a borda desce e ela aparece)
    m.plane([PX + 0.0005, -0.57, top + 0.001], [PX + 0.0005, 0.57, top + 0.001], [PX + 0.0005, -0.57, PANEL.TOP - 0.006], 12, 1, { col: COL.leather, ao: true, ref: () => [PX + 1, 0, 0.2] });
    // friso arredondado da borda: reto no meio e descendo em arco nos cantos (varrido ao longo do caminho)
    const yEnd = 0.565, zEnd = 0.05;
    const segs = [];   // caminho no plano do painel: (y, z) por comprimento de arco
    const pathPt = (t) => {   // t: -1..1 de ponta a ponta
      const L0 = GLARE.z - GLARE.r - zEnd, La = GLARE.r * Math.PI / 2, Lc = GLARE.yc, tot = L0 + La + Lc;
      let d = Math.abs(t) * tot, sg = t < 0 ? -1 : 1, y, z;
      if (d <= Lc) { y = d; z = GLARE.z; }
      else if (d <= Lc + La) { const a = (d - Lc) / GLARE.r; y = GLARE.yc + GLARE.r * Math.sin(a); z = GLARE.z - GLARE.r + GLARE.r * Math.cos(a); }
      else { y = GLARE.yc + GLARE.r; z = GLARE.z - GLARE.r - (d - Lc - La); }
      return [sg * Math.min(y, yEnd), z];
    };
    const T = []; for (let k = 0; k <= 80; k++) T.push(-1 + 2 * k / 80);
    const A = []; for (let k = 0; k <= 10; k++) A.push(-Math.PI / 2 + Math.PI * k / 10);
    m.surf(T, A, (t, a) => {
      const [y, z] = pathPt(t), [y2, z2] = pathPt(Math.min(t + 1e-3, 1)), [y1, z1] = pathPt(Math.max(t - 1e-3, -1));
      let ty = y2 - y1, tz = z2 - z1; const l = Math.hypot(ty, tz) || 1; ty /= l; tz /= l;
      let ny = -tz, nz = ty;                              // normal no plano do painel
      if (ny * -y + nz * (0.1 - z) < 0) { ny = -ny; nz = -nz; }   // aponta para o creme (centro do painel)
      return [PX - 0.002 - 0.016 * Math.cos(a), y + ny * 0.011 * Math.sin(a), z + nz * 0.011 * Math.sin(a)];
    }, { col: COL.leather, ao: true, ref: (p) => [PX + 0.02, p[1] * 0.98, p[2] - 0.0] });
    // bussola em cima da pala, no meio
    m.rbox([1.245, 0, 0.283], IDENT, [0.04, 0.042, 0.024], 0.008, { col: COL.black, ao: true, sdf });
    const cu = atlasUV(R_COMP);
    m.plane([1.2045, -0.03, 0.301], [1.2045, 0.03, 0.301], [1.2045, -0.03, 0.265], 1, 1, {
      col: [1, 1, 1], mat: M_TEX, ref: () => [1.3, 0, 0.28], uv: (p) => [lerp(cu[0], cu[2], (p[1] + 0.03) / 0.06), lerp(cu[1], cu[3], (0.301 - p[2]) / 0.036)],
    });
  }
  // ----- difusores de ar na raiz das asas (cantos do teto) e luz da cabine -----
  for (const s of [-1, 1]) {
    m.cyl([0.98, s * 0.47, 0.80], [0.98, s * 0.47, 0.72], 0.032, { col: COL.creamDk, ao: true });
    m.cyl([0.98, s * 0.47, 0.721], [0.98, s * 0.47, 0.70], 0.02, { col: COL.dark });
  }
  m.cyl([0.10, 0, 0.80], [0.10, 0, 0.785], 0.05, { col: COL.creamDk });
  // ----- bancos -----
  const fabric = { col: COL.seat, mat: M_SEAT, ao: true, sdf, uv: seatUV, step: 0.09 };
  for (const y0 of YOKE_Y) {
    m.rbox([0.43, y0, -0.195], IDENT, [0.235, 0.215, 0.07], 0.055, fabric);
    m.rbox([0.14, y0, 0.12], tilt(rad(12)), [0.055, 0.215, 0.26], 0.05, fabric);
    m.rbox([0.43, y0, -0.32], IDENT, [0.16, 0.15, 0.05], 0.02, { col: COL.dark, ao: true, sdf });
  }
  m.rbox([-0.70, 0, -0.19], IDENT, [0.22, 0.47, 0.07], 0.055, fabric);
  m.rbox([-1.03, 0, 0.10], tilt(rad(15)), [0.06, 0.47, 0.25], 0.05, fabric);
  // ----- apoios de braco, macanetas -----
  for (const s of [-1, 1]) {
    m.rbox([0.58, s * 0.535, 0.12], IDENT, [0.22, 0.032, 0.028], 0.016, { col: COL.redDk, ao: true, sdf });
    m.rbox([0.98, s * 0.548, 0.19], IDENT, [0.035, 0.012, 0.009], 0.006, { col: COL.chrome, mat: M_CHROME });
    m.rbox([-0.72, s * 0.530, 0.07], IDENT, [0.18, 0.032, 0.026], 0.016, { col: COL.redDk, ao: true, sdf });
  }
  // ----- pedestal embaixo do meio do painel: roda do trim e a placa com a escala -----
  m.rbox([PED.x + PED.hx, 0, PED.zc], IDENT, [PED.hx, PED.hy, PED.hz], 0.014, { col: COL.dark, ao: true, sdf });
  {
    const pu = atlasUV(R_PED), x = PED.x - 0.0008;
    m.plane([x, PLATE.y0, PLATE.z0], [x, PLATE.y1, PLATE.z0], [x, PLATE.y0, PLATE.z1], 1, 1, {
      col: [1, 1, 1], mat: M_TEX, ref: () => [x + 1, 0, PLATE.z0], uv: (p, u, v) => [lerp(pu[0], pu[2], u), lerp(pu[1], pu[3], v)] });
    // fenda da roda
    m.rbox([PED.x - 0.001, TRIMW.y, TRIMW.z], IDENT, [0.003, 0.02, 0.085], 0.002, { col: COL.black });
  }
  // seletor de combustivel no assoalho
  m.rbox([0.98, 0, -0.37], IDENT, [0.05, 0.05, 0.02], 0.01, { col: COL.dark, ao: true });
  m.rbox([0.98, 0, -0.34], IDENT, [0.045, 0.012, 0.012], 0.008, { col: COL.knobRed });
  // ----- colunas dos manches e botoes fixos (mistura) -----
  for (const y0 of YOKE_Y) {
    m.lathe([PX - 0.04, y0, YOKE_Z], [PX + 0.001, y0, YOKE_Z],
      [{ s: 0, r: 0.016, ns: 0, nr: 1 }, { s: 0.04, r: 0.03, ns: 0, nr: 1 }], 12, { col: COL.black });
  }
  {
    const x0 = PX - 0.028, y = MIXTURE.y, z = MIXTURE.z;
    m.cyl([PX, y, z], [x0, y, z], 0.004, { col: COL.chrome, mat: M_CHROME }, 8);
    m.capsule([x0, y, z], [x0 - 0.018, y, z], 0.013, { col: COL.knobRed }, 12);
  }
  sdf.box([0.43, -0.27, -0.195], IDENT, [0.18, 0.16, 0.015], 0.055);
}

// ----- o aviao visto de dentro (fixo) -----
const WING = { le: 1.20, te: -0.40, hinge: -0.12, zb: 0.83, t: 0.16 };
const FLAP_Y = [0.565, 2.85], AIL_Y = [3.05, 5.15], TIP_Y = 5.25, SPAN = 5.6;
const wingProf = (() => {
  // perfil inteiro (corda 1.6) e as duas partes: fixa (bordo de ataque ate a articulacao) e movel
  const c = 1.6, t = 0.16;
  const thick = (x) => {   // meia-espessura e linha media no ponto x
    const u = clamp((WING.le - x) / c, 0, 1);
    const yt = 5 * (t / c) * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4) * c;
    return [WING.zb + 0.055 + yt * 1.2, WING.zb + 0.055 - yt * 0.55];
  };
  const pts = (x0, x1, n) => {
    const top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const u = (1 - Math.cos((i / n) * Math.PI)) / 2, x = lerp(x0, x1, x0 === WING.le ? u : i / n);
      const [zt, zb] = thick(x);
      top.push([x, zt]); bot.push([x, zb]);
    }
    return { top, bot };
  };
  const fixed = pts(WING.le, WING.hinge, 16), mov = pts(WING.hinge, WING.te, 5);
  const close = (p, ends) => p.top.concat(p.bot.slice().reverse().slice(ends[0], p.bot.length - ends[1]));
  return {
    full: close(pts(WING.le, WING.te, 20), [1, 1]),
    fixed: fixed.top.concat(fixed.bot.slice().reverse().slice(0, -1)),
    mov: mov.top.concat(mov.bot.slice().reverse().slice(1)),
    thick,
  };
})();

function buildExterior(m) {
  const white = COL.white;
  // ----- capo: forma afinando ate o spinner -----
  {
    const st = [[1.29, 0.25, 0.575, -0.30], [1.75, 0.262, 0.555, -0.32], [2.20, 0.255, 0.515, -0.30], [2.55, 0.205, 0.445, -0.25],
                [2.78, 0.150, 0.355, -0.20], [2.93, 0.105, 0.27, -0.16]];
    const at = (x) => {
      let i = 0; while (i < st.length - 2 && x > st[i + 1][0]) i++;
      const a = st[i], b = st[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1), s = t * t * (3 - 2 * t);
      return [lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)];
    };
    const U = [], A = [];
    for (let x = 1.29; x < 2.93; x += 0.1) U.push(x);
    U.push(2.93);
    for (let k = 0; k <= 24; k++) A.push(-1.9 + 3.8 * k / 24);
    m.surf(U, A, (x, a) => {
      const [top, hw, bot] = at(x), cz = (top + bot) / 2, hz = (top - bot) / 2;
      const s = Math.sin(a), c = Math.cos(a), e = 2 / 3.2;
      return [x, hw * Math.sign(s) * Math.abs(s) ** e, cz + hz * Math.sign(c) * Math.abs(c) ** e];
    }, { col: (p) => (Math.abs(p[1]) < 0.012 && p[0] > 1.5 ? COL.creamDk : white), mat: M_EXT, ref: (p) => [p[0], 0, 0.0] });
    // friso da base do para-brisa
    m.extrude([[1.285, 0.246], [1.315, 0.255], [1.35, 0.255]], [-0.55, 0.55], { col: COL.dark, mat: M_EXT, ref: [1.32, 0.0] });
    // spinner vermelho
    const prof = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, f = t * Math.PI / 2;
      prof.push({ s: 0.36 * Math.sin(f), r: 0.17 * Math.cos(f) + 1e-4, ns: Math.sin(f) * 0.6, nr: Math.cos(f) });
    }
    m.lathe([2.92, 0, 0.02], [3.3, 0, 0.02], prof, 18, { col: COL.redExt, mat: M_EXT });
  }
  // ----- asas: parte fixa ate a articulacao + pontas vermelhas + nervura central -----
  for (const s of [-1, 1]) {
    const ys = (a, b, n) => { const r = []; for (let k = 0; k <= n; k++) r.push(s * lerp(a, b, k / n)); return s < 0 ? r.reverse() : r; };
    m.extrude(wingProf.fixed, ys(0.0, TIP_Y, 10), { col: white, mat: M_EXT, closed: true });
    // pedacos fixos atras da articulacao (entre flap e aileron, e na ponta)
    m.extrude(wingProf.mov, ys(FLAP_Y[1], AIL_Y[0], 1), { col: white, mat: M_EXT, closed: true });
    m.extrude(wingProf.mov, ys(AIL_Y[1], TIP_Y, 1), { col: white, mat: M_EXT, closed: true });
    m.extrude(wingProf.full, ys(TIP_Y, SPAN, 2), { col: COL.redExt, mat: M_EXT, closed: true, caps: [[s * SPAN, s]] });
    // luz de navegacao na ponta
    m.rbox([0.95, s * (SPAN + 0.02), 0.90], IDENT, [0.05, 0.02, 0.02], 0.015, { col: s < 0 ? COL.navRed : COL.green, mat: M_EXT });
    // montante (perfil achatado) da fuselagem ate a asa
    const a = [0.42, s * 0.58, -0.32], b = [0.42, s * 2.40, WING.zb + 0.01], ax = norm(sub(b, a));
    const side = norm(cross(ax, [1, 0, 0])), Ls = len(sub(b, a));
    const U = [], A = [];
    for (let k = 0; k <= 6; k++) U.push(k / 6);
    for (let k = 0; k <= 12; k++) A.push(k / 12 * Math.PI * 2);
    m.surf(U, A, (t, ang) => add(add(a, mul(ax, t * Ls)), add(mul([1, 0, 0], 0.055 * Math.cos(ang)), mul(side, 0.018 * Math.sin(ang)))),
      { col: white, mat: M_EXT, ref: (p) => add(a, mul(ax, dot(sub(p, a), ax))) });
  }
  // ----- cone de cauda, estabilizador, deriva -----
  {
    const st = [[X_AFT, 0.62, 0.575, -0.56], [-2.6, 0.60, 0.48, -0.40], [-3.6, 0.55, 0.33, -0.15], [-4.6, 0.48, 0.18, 0.08], [-5.30, 0.43, 0.06, 0.24]];
    const at = (x) => {
      let i = 0; while (i < st.length - 2 && x < st[i + 1][0]) i++;
      const a = st[i], b = st[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    };
    const U = [], A = [];
    for (let k = 0; k <= 10; k++) U.push(lerp(X_AFT, -5.30, k / 10));
    for (let k = 0; k <= 24; k++) A.push(k / 24 * Math.PI * 2);
    const shape = (x, a) => {
      const [top, hw, bot] = at(x), cz = (top + bot) / 2, hz = (top - bot) / 2, s = Math.sin(a), c = Math.cos(a), e = 2 / 3;
      return [x, hw * Math.sign(s) * Math.abs(s) ** e, cz + hz * Math.sign(c) * Math.abs(c) ** e];
    };
    m.surf(U, A, shape, { col: (p) => (p[2] > -0.18 && p[2] < 0.02 ? COL.blue : white), mat: M_EXT, ref: (p) => [p[0], 0, at(p[0])[1] / 2 + at(p[0])[2] / 2] });
    const cb = m.n;   // tampa da frente (aparece pela janela de tras)
    m.vert([X_AFT, 0, 0.03], [1, 0, 0], white, M_EXT);
    for (let k = 0; k <= 24; k++) m.vert(shape(X_AFT, k / 24 * Math.PI * 2), [1, 0, 0], white, M_EXT);
    for (let k = 0; k < 24; k++) m.i.push(cb, cb + 1 + k, cb + 2 + k);
    // estabilizador horizontal (parte fixa) e deriva
    const hs = [[-4.40, 0.35], [-4.55, 0.385], [-4.85, 0.39], [-5.02, 0.375], [-5.02, 0.335], [-4.85, 0.325], [-4.55, 0.33]];
    m.extrude(hs, [-1.75, 1.75], { col: white, mat: M_EXT, closed: true, caps: [[-1.75, -1], [1.75, 1]] });
    const fin = [[-4.15, 0.45], [-4.95, 1.95], [-5.25, 1.95], [-5.25, 0.45]];
    for (const sy of [-1, 1]) {   // deriva como duas faces + borda (fina)
      const P = fin.map(([x, z]) => [x, sy * 0.04, z]);
      const b = m.n;
      for (const p of P) m.vert(p, [0, sy, 0], COL.blue, M_EXT);
      m.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    m.extrude([[-4.15, 0.45], [-4.95, 1.95], [-5.25, 1.95]], [-0.04, 0.04], { col: COL.blue, mat: M_EXT, ref: [-4.9, 1.0] });
  }
}

// ---------------------------------------------------------------------------
// partes que se mexem: cada uma e uma malha fixa no seu referencial, movida por uma matriz
// (calculada a cada quadro, barata) - nada de refazer triangulos durante o voo
// ---------------------------------------------------------------------------
function ik(S, H, L1, L2, hint) {
  let d = sub(H, S);
  const D = len(d), Dm = Math.min(D, L1 + L2 - 1e-3);
  d = mul(d, 1 / (D || 1));
  const a = (L1 * L1 - L2 * L2 + Dm * Dm) / (2 * Dm), h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const perp = norm(sub(hint, mul(d, dot(hint, d))));
  const E = add(add(S, mul(d, a)), mul(perp, h));
  return [E, add(S, mul(d, Dm))];
}
// matrizes 4x4 (coluna por coluna, como o WebGL espera)
const matRT = (R, t) => new Float32Array([R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, t[0], t[1], t[2], 1]);
const MAT_I = matRT(IDENT, [0, 0, 0]);
const matT = (t) => matRT(IDENT, t);
// rotacao em torno de um eixo (unitario) que passa por c, depois translacao extra
function matAxis(ax, ang, c, extra = [0, 0, 0]) {
  const s = Math.sin(ang), k = Math.cos(ang), t = 1 - k, [x, y, z] = ax;
  const cols = [[t * x * x + k, t * x * y + s * z, t * x * z - s * y], [t * x * y - s * z, t * y * y + k, t * y * z + s * x], [t * x * z + s * y, t * y * z - s * x, t * z * z + k]];
  const rc = [0, 1, 2].map((i) => cols[0][i] * c[0] + cols[1][i] * c[1] + cols[2][i] * c[2]);
  return matRT(cols, [c[0] - rc[0] + extra[0], c[1] - rc[1] + extra[1], c[2] - rc[2] + extra[2]]);
}
// leva o eixo x local para a direcao a->b, com origem em a
function matAlong(a, b) {
  const d = norm(sub(b, a)), h = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const e1 = norm(cross(h, d)), e2 = cross(d, e1);
  return matRT([d, e1, e2], a);
}
const xform = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];

// pose do piloto e das pecas (tambem usada para posicionar os membros)
const HIP = (s) => [0.30, -0.27 + s * 0.09, -0.08];
const KNEE = (s) => [0.80, -0.27 + s * 0.10, -0.03];
const PEDAL = (y0, s) => [1.255, y0 + s * 0.09, -0.275];
const ANKLE = (s) => { const p = PEDAL(YOKE_Y[0], s); return [p[0] - 0.045, p[1], p[2] + 0.03]; };
const L_THIGH = len(sub(KNEE(-1), HIP(-1))), L_SHIN = len(sub(ANKLE(-1), KNEE(-1)));
const L_UP = 0.33, L_FORE = 0.30;
const SH_L = [0.47, -0.45, 0.24], SH_R = [0.47, -0.10, 0.23];
const GRIP_L = [YOKE_X - 0.04, YOKE_Y[0] - 0.142, YOKE_Z + 0.07];
const KNOB0 = PX - 0.028;   // botao da manete todo empurrado

function buildParts() {
  const parts = [];
  const part = (name, group, fn) => { const m = new Mesh(); fn(m); parts.push({ name, group, m }); };
  // ----- manches (montados na posicao neutra) -----
  YOKE_Y.forEach((y0, i) => part('yoke' + i, 'ctl', (m) => {
    const hubX = YOKE_X;
    m.cyl([PX + 0.10, y0, YOKE_Z], [hubX, y0, YOKE_Z], 0.012, { col: COL.chrome, mat: M_CHROME }, 10);
    m.rbox([hubX - 0.02, y0, YOKE_Z], IDENT, [0.025, 0.05, 0.034], 0.012, { col: COL.black });
    for (const s of [-1, 1]) {
      const p0 = [hubX - 0.02, y0 + s * 0.04, YOKE_Z - 0.005], p1 = [hubX - 0.035, y0 + s * 0.13, YOKE_Z - 0.01];
      const p2 = [hubX - 0.04, y0 + s * 0.15, YOKE_Z + 0.12];
      m.capsule(p0, p1, 0.016, { col: COL.black }, 8);
      m.capsule(p1, p2, 0.021, { col: COL.black }, 10);
    }
    const eu = atlasUV(R_EMBLEM), xe = hubX - 0.0465;
    m.plane([xe, y0 - 0.04, YOKE_Z + 0.0135], [xe, y0 + 0.04, YOKE_Z + 0.0135], [xe, y0 - 0.04, YOKE_Z - 0.0135], 1, 1,
      { col: [1, 1, 1], mat: M_TEX, ref: () => [xe + 1, y0, YOKE_Z], uv: (p, u, v) => [lerp(eu[0], eu[2], u), lerp(eu[1], eu[3], v)] });
  }));
  // ----- manete (preta): montada toda empurrada -----
  part('thr', 'ctl', (m) => {
    m.cyl([PX + 0.10, THROTTLE.y, THROTTLE.z], [KNOB0, THROTTLE.y, THROTTLE.z], 0.0045, { col: COL.chrome, mat: M_CHROME }, 8);
    m.capsule([KNOB0, THROTTLE.y, THROTTLE.z], [KNOB0 - 0.02, THROTTLE.y, THROTTLE.z], 0.016, { col: COL.black }, 12);
  });
  // ----- alavanca dos flaps: montada em 0 -----
  part('lever', 'ctl', (m) => {
    m.rbox([PX - 0.012, FLAPS.y, FLAPS.z0], IDENT, [0.012, 0.004, 0.006], 0.003, { col: COL.chrome, mat: M_CHROME });
    m.rbox([PX - 0.03, FLAPS.y, FLAPS.z0], IDENT, [0.008, 0.022, 0.009], 0.006, { col: COL.white });
  });
  // ----- roda do trim (com ressaltos para ver girar), ponteiro do trim e ponteiro dos flaps -----
  part('trimw', 'ctl', (m) => {
    m.cyl([TRIMW.x, TRIMW.y - TRIMW.w, TRIMW.z], [TRIMW.x, TRIMW.y + TRIMW.w, TRIMW.z], TRIMW.r, { col: COL.black }, 28);
    for (let k = 0; k < 18; k++) {
      const a = k / 18 * Math.PI * 2, c = [TRIMW.x + Math.cos(a) * TRIMW.r, TRIMW.y, TRIMW.z + Math.sin(a) * TRIMW.r];
      m.rbox(c, [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]], [0.006, TRIMW.w * 0.9, 0.007], 0.003, { col: COL.dark });
    }
  });
  part('trimp', 'ctl', (m) => {
    const y = lerp(PLATE.y0, PLATE.y1, 0.5), z = PLATE.z0;
    m.rbox([PED.x - 0.004, y, z], IDENT, [0.003, 0.012, 0.0035], 0.002, { col: COL.yellow });
  });
  part('flapp', 'ctl', (m) => {   // ponteiro laranja ao lado do trilho: mostra onde os flaps estao de fato
    const b = m.n, x = PX - 0.004, y = FLAPS.y - 0.011, z = FLAPS.z0;
    for (const p of [[x, y + 0.004, z], [x, y - 0.010, z + 0.006], [x, y - 0.010, z - 0.006]]) m.vert(p, [-1, 0, 0], hex('#ff9a1e'), M_IN);
    m.i.push(b, b + 1, b + 2);
  });
  // ----- pedais (e os pes do piloto nos da esquerda) -----
  YOKE_Y.forEach((y0, i) => [-1, 1].forEach((s) => part(`ped${i}${s}`, 'ctl', (m) => {
    const c = PEDAL(y0, s);
    m.rbox(c, tilt(rad(-22)), [0.012, 0.045, 0.065], 0.008, { col: COL.dark });
    m.cyl([c[0] + 0.01, c[1], c[2] + 0.06], [c[0] + 0.08, c[1], c[2] + 0.26], 0.008, { col: COL.dark }, 6);
    if (i === 0) m.rbox([c[0] - 0.035, c[1], c[2] + 0.005], tilt(rad(30)), [0.10, 0.042, 0.035], 0.03, { col: COL.shoe });
  })));
  // ----- piloto: tronco fixo, membros como capsulas de comprimento fixo ao longo do x local -----
  part('torso', 'body', (m) => m.capsule([0.33, -0.27, -0.06], [0.40, -0.27, 0.17], 0.145, { col: COL.shirt }, 14));
  const limb = (name, L, r, col) => part(name, 'body', (m) => m.capsule([0, 0, 0], [L, 0, 0], r, { col }, 10));
  for (const s of [-1, 1]) { limb('thigh' + s, L_THIGH, 0.075, COL.jeans); limb('shin' + s, L_SHIN, 0.056, COL.jeans); }
  for (const k of ['L', 'R']) {
    limb('up' + k, L_UP, 0.046, COL.shirt);
    limb('fore' + k, L_FORE, 0.036, COL.skin);
    part('hand' + k, 'body', (m) => m.rbox([0, 0, 0], IDENT, [0.035, 0.03, 0.035], 0.028, { col: COL.skin }));
  }
  // ----- superficies de comando (montadas neutras) -----
  for (const s of [-1, 1]) {
    const ys = (a, b, n) => { const r = []; for (let k = 0; k <= n; k++) r.push(s * lerp(a, b, k / n)); return s < 0 ? r.reverse() : r; };
    part('flap' + s, 'ext', (m) => m.extrude(wingProf.mov, ys(FLAP_Y[0], FLAP_Y[1], 3), { col: COL.white, mat: M_EXT, closed: true, caps: [[s * FLAP_Y[0], -s], [s * FLAP_Y[1], s]] }));
    part('ail' + s, 'ext', (m) => m.extrude(wingProf.mov, ys(AIL_Y[0], AIL_Y[1], 3), { col: COL.white, mat: M_EXT, closed: true, caps: [[s * AIL_Y[0], -s], [s * AIL_Y[1], s]] }));
  }
  part('elev', 'ext', (m) => m.extrude([[-5.02, 0.375], [-5.20, 0.362], [-5.40, 0.355], [-5.20, 0.348], [-5.02, 0.335]], [-1.70, 1.70],
    { col: COL.white, mat: M_EXT, closed: true, caps: [[-1.70, -1], [1.70, 1]] }));
  const rprof = [[-5.25, 0.035], [-5.45, 0.012], [-5.52, 0.0], [-5.45, -0.012], [-5.25, -0.035]];
  part('rud', 'ext', (m) => m.extrude(rprof, [0.40, 1.98], {
    col: COL.blue, mat: M_EXT, closed: true, caps: [[1.98, 1]], map: (p) => [p[0], p[2], p[1]], mapN: (n) => [n[0], n[2], n[1]] }));
  return parts;
}

// onde a mao direita vai: manete (normal), alavanca dos flaps ou roda do trim
function handTarget(what, st) {
  if (what === 'lever') return [PX - 0.048, FLAPS.y, lerp(FLAPS.z0, FLAPS.z1, st.lever / 3)];
  if (what === 'trim') return [TRIMW.x - TRIMW.r - 0.025, TRIMW.y + 0.005, TRIMW.z + 0.03];
  return [KNOB0 - 0.075 * (1 - st.thr) - 0.045, THROTTLE.y - 0.005, THROTTLE.z + 0.01];
}

// matriz de cada parte para o estado st
function partMatrices(st) {
  const M = {};
  const hub = -0.065 * st.elev, ang = -st.ail * rad(38);
  YOKE_Y.forEach((y0, i) => { M['yoke' + i] = matAxis([1, 0, 0], ang, [0, y0, YOKE_Z], [hub, 0, 0]); });
  const kd = -0.075 * (1 - st.thr);
  M.thr = matT([kd, 0, 0]);
  M.lever = matT([0, 0, (FLAPS.z1 - FLAPS.z0) * st.lever / 3]);
  M.flapp = matT([0, 0, (FLAPS.z1 - FLAPS.z0) * st.flap]);
  M.trimw = matAxis([0, 1, 0], st.trim * 9, [TRIMW.x, TRIMW.y, TRIMW.z]);
  M.trimp = matT([0, 0, (PLATE.z1 - PLATE.z0) * lerp(PED_SCALE.v0, PED_SCALE.v1, clamp((st.trim + 0.4) / 0.8, 0, 1))]);
  const pd = {};
  YOKE_Y.forEach((y0, i) => [-1, 1].forEach((s) => { pd[`${i}${s}`] = s * 0.045 * st.rud; M[`ped${i}${s}`] = matT([pd[`${i}${s}`], 0, 0]); }));
  M.torso = MAT_I;
  for (const s of [-1, 1]) {
    const ank = add(ANKLE(s), [pd[`0${s}`], 0, 0]);
    const knee = add(KNEE(s), [pd[`0${s}`] * 0.4, 0, 0]);
    M['thigh' + s] = matAlong(HIP(s), knee);
    M['shin' + s] = matAlong(knee, ank);
  }
  const grip = xform(M.yoke0, GRIP_L);
  const hand = st.hand || handTarget('thr', st);
  for (const [k, S0, H, hint] of [['L', SH_L, add(grip, [0, -0.012, 0]), [-0.3, -0.5, -1]], ['R', SH_R, hand, [-0.4, 0.4, -1]]]) {
    // longe demais: o tronco se inclina (o ombro avanca na direcao da mao)
    const dd = sub(H, S0), far = len(dd) - (L_UP + L_FORE - 0.03);
    const S = far > 0 ? add(S0, mul(norm(dd), far)) : S0;
    const [E, W] = ik(S, H, L_UP, L_FORE, hint);
    M['up' + k] = matAlong(S, E);
    M['fore' + k] = matAlong(E, W);
    M['hand' + k] = matT(W);
  }
  const H = [WING.hinge, 0, wingProf.thick(WING.hinge)[1] + 0.01];
  for (const s of [-1, 1]) {
    M['flap' + s] = matAxis([0, 1, 0], -rad(32) * st.flap, H);
    M['ail' + s] = matAxis([0, 1, 0], (s < 0 ? -1 : 1) * rad(16) * st.ail, H);   // o da esquerda desce com rolagem a direita
  }
  M.elev = matAxis([0, 1, 0], rad(22) * st.elev, [-5.02, 0, 0.355]);
  M.rud = matAxis([0, 0, 1], -rad(25) * st.rud, [-5.25, 0, 0]);
  return M;
}

// vidros (desenhados por ultimo, quase transparentes: so reflexos fracos)
function buildGlass(m) {
  const U = [];
  for (let x = X_AFT; x < X_FWD - 1e-6; x += 0.12) U.push(x);
  U.push(X_FWD);
  const S = [];
  for (let k = 0; k <= 72; k++) S.push(k / 72);
  m.surf(U, S, (x, s) => sectionPoint(x, s), { col: [1, 1, 1], mat: M_GLASS, ref: (p) => [p[0], 0, 0.2], inward: true });
  const z0 = 0.245, z1 = 0.80;
  m.plane([xws(z1), -0.575, z1], [xws(z1), 0.575, z1], [xws(z0), -0.575, z0], 8, 4, { col: [1, 1, 1], mat: M_WSHIELD, ref: () => [3, 0, 0.5] });
}

// disco da helice (desenhado por ultimo, translucido)
function buildProp(m) {
  const prof = [];
  for (let k = 0; k <= 12; k++) { const r = lerp(0.12, 0.96, k / 12); prof.push({ s: 0, r, ns: -1, nr: 0 }); }
  m.lathe([3.06, 0, 0.02], [3.07, 0, 0.02], prof, 48, { col: [0, 0, 0], mat: M_PROP });
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------
const SHELL_GLSL = `
float xws(float z) { return 1.29 - (z - 0.245) * 0.53; }
float sdRR(vec2 p, vec2 c, vec2 h, float r) { vec2 q = abs(p - c) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
// distancia (m) ate a abertura mais proxima: < 0 = janela (recortada)
float shellOpen(vec3 p) {
    float d = 1.0;
    if (p.z > 0.245) d = (xws(p.z) - p.x) * 0.88;
    if (abs(p.y) > 0.36) {
        d = min(d, max(sdRR(p.xz, vec2(0.72, 0.525), vec2(0.59, 0.215), 0.05), (p.x - xws(p.z) + 0.07) * 0.88));
        d = min(d, sdRR(p.xz, vec2(-0.49, 0.52), vec2(0.51, 0.20), 0.07));
    } else if (p.z > 0.5 && p.x < -0.5) {
        d = min(d, sdRR(p.xy, vec2(-1.08, 0.0), vec2(0.50, 0.335), 0.08));
    }
    return d;
}`;

const MESH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec3 aCol;
layout(location = 3) in float aMat;
layout(location = 4) in vec2 aUV;
layout(location = 5) in float aAO;
uniform vec3 uEye, uVF, uVR, uVU;   // olho e eixos da camera, no referencial do aviao
uniform float uTanX, uHW;
uniform mat4 uModel;                // parte movel (manche, flaps...): rotacao + translacao
out vec3 vPos, vNrm, vCol;
out vec2 vUV;
out float vMat, vAO;
void main() {
    vec3 P = (uModel * vec4(aPos, 1.0)).xyz;
    vec3 d = P - uEye;
    float x = dot(d, uVR), y = dot(d, uVU), z = dot(d, uVF);
    const float n = 0.02, f = 60.0;
    gl_Position = vec4(x / uTanX, y / (uTanX * uHW), z * (f + n) / (f - n) - 2.0 * f * n / (f - n), z);
    vPos = P; vNrm = mat3(uModel) * aNrm; vCol = aCol; vUV = aUV; vMat = aMat; vAO = aAO;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPos, vNrm, vCol;
in vec2 vUV;
in float vMat, vAO;
uniform vec3 uEye, uSunB, uLight, uShade;
uniform float uSunUp, uProp, uSweep;
uniform mat4 uShM;
uniform sampler2DShadow uShadow;
uniform sampler2D uAtlas;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${SHELL_GLSL}
// linha fina sem serrilhado: quando fica menor que um pixel, some aos poucos em vez de virar tracejado
float aaLine(float d, float w) { float fw = max(fwidth(d), 1e-5); return (1.0 - smoothstep(w, w + fw * 1.2, abs(d))) * clamp(w / fw, 0.0, 1.0); }
float shadowAt(vec3 p, vec3 n) {
    vec4 s = uShM * vec4(p + n * 0.012, 1.0);
    vec3 q = s.xyz * 0.5 + 0.5;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
    vec2 o = 0.75 / vec2(textureSize(uShadow, 0));
    float k = texture(uShadow, vec3(q.xy + vec2(-o.x, -o.y), q.z)) + texture(uShadow, vec3(q.xy + vec2(o.x, -o.y), q.z))
            + texture(uShadow, vec3(q.xy + vec2(-o.x, o.y), q.z)) + texture(uShadow, vec3(q.xy + vec2(o.x, o.y), q.z));
    return k * 0.25;
}
vec3 shellColor(vec3 p, vec3 n) {
    float roof = p.x > -0.45 ? 0.80 : 0.80 - (-0.45 - p.x) * 0.192;
    vec3 c;
    if (n.z > 0.6) c = vec3(0.29, 0.24, 0.215);                          // carpete
    else if (p.z > roof - 0.075 || n.z < -0.6) {                         // forro do teto, com costuras
        c = vec3(0.92, 0.89, 0.82);
        c *= 1.0 - 0.10 * aaLine(fract(p.x / 0.22 + 0.5) - 0.5, 0.012);
    } else if (p.z < 0.165) c = vec3(0.56, 0.165, 0.14);                 // parte de baixo vermelha
    else if (p.z < 0.185) c = vec3(0.80, 0.80, 0.78);                    // friso
    else c = vec3(0.865, 0.83, 0.735);                                   // creme
    if (abs(p.y) > 0.36 && n.z > -0.6 && n.z < 0.6) {                     // vincos das portas
        float l = aaLine(p.x - 0.075, 0.0035) * step(-0.33, p.z) * step(p.z, 0.77);
        l = max(l, aaLine(p.x - 1.12, 0.0035) * step(-0.33, p.z) * step(p.z, 0.25));
        l = max(l, aaLine(p.z + 0.33, 0.0035) * step(0.075, p.x) * step(p.x, 1.12));
        c *= 1.0 - 0.45 * l;
    }
    float d = shellOpen(p);                                              // borracha das janelas
    c = mix(c, vec3(0.13, 0.13, 0.14), 1.0 - smoothstep(0.018, 0.018 + max(fwidth(d), 1e-4), d));
    return c;
}
void main() {
    int mat = int(vMat + 0.5);
    vec3 V = normalize(uEye - vPos);
    vec3 n = normalize(vNrm);
    if (mat == 2 && shellOpen(vPos) < 0.0) discard;
    if (mat >= 7) {   // vidro: um veu bem fraco, mais forte de raspao (Fresnel), e faixas de reflexo
        if (mat == 7 && shellOpen(vPos) >= 0.0) discard;
        if (mat == 8) {   // recorta o para-brisa na secao arredondada da cabine
            float w = 0.565 - 0.14, zc = 0.80 - 0.14;
            if (vPos.z > zc && abs(vPos.y) > w && length(vec2(abs(vPos.y) - w, vPos.z - zc)) > 0.14) discard;
        }
        float c = abs(dot(n, V));
        float fres = pow(1.0 - c, 4.0);
        float k = dot(vPos, vec3(1.1, 1.9, 3.1)) + dot(V, vec3(0.6, 1.3, 0.4));
        float streak = smoothstep(0.55, 1.0, sin(k * 2.2)) * smoothstep(0.3, 1.0, sin(k * 0.7 + 1.0));
        float al = 0.025 + 0.22 * fres + 0.045 * streak * uSunUp;
        vec3 col = mix(vec3(0.82, 0.88, 0.98), uLight, 0.5);
        oC = vec4(col * al, al);
        oA = vec4(0.0);
        return;
    }
    if (mat == 4) {   // disco da helice: rastro das pas no ultimo quadro + pontas pintadas
        vec2 q = vPos.yz - vec2(0.0, 0.02);
        float r = length(q), a = atan(q.y, q.x);
        float bw = 0.075 / max(r, 0.1) * (1.0 - 0.45 * smoothstep(0.75, 0.96, r));   // largura angular da pa
        float rel = mod(uProp - a, 3.14159265);
        float cov = uSweep <= bw ? step(rel, bw) : (rel < uSweep ? bw / uSweep : 0.0);
        cov = min(cov * 1.5, 1.0) * (1.0 - smoothstep(0.945, 0.96, r));
        vec3 col = r > 0.86 ? vec3(0.95, 0.80, 0.18) : vec3(0.10, 0.10, 0.11);
        float al = cov * (uSweep > 1.0 ? (r > 0.86 ? 1.6 : 0.9) : 1.0);
        al = min(al, 0.85);
        float L = mix(0.55, 1.0, uSunUp);
        oC = vec4(col * L * al, al);
        oA = vec4(0.0);
        return;
    }
    if (dot(n, V) < 0.0) n = -n;   // superficies vistas dos dois lados
    vec3 base = vCol;
    if (mat == 1) { vec4 t = texture(uAtlas, vUV); if (t.a < 0.5) discard; base = t.rgb; }
    else if (mat == 2) base = shellColor(vPos, normalize(vNrm));
    else if (mat == 3) {   // tecido com pregas
        float f = fract(vUV.x / 0.065);
        float seam = 1.0 - smoothstep(0.0, max(0.14, fwidth(vUV.x / 0.065) * 1.5), min(f, 1.0 - f));
        base *= 1.0 - 0.32 * seam;
    }
    float ndl = max(dot(n, uSunB), 0.0);
    float sh = shadowAt(vPos, n) * uSunUp;
    float e = ndl * sh;
    float band = 0.62 * smoothstep(0.08, 0.15, e) + 0.38 * smoothstep(0.40, 0.48, e);
    bool ext = mat == 5;
    float ao = vAO;
    vec3 amb = (ext ? uShade : mix(uShade, uLight, 0.28)) * ao;   // dentro: um pouco de luz rebatida
    vec3 L = mix(amb, uLight * mix(1.0, ao, 0.35), band);
    if (mat == 1) L = max(mix(L, uLight, 0.55), vec3(0.42, 0.36, 0.32));   // instrumentos sempre legiveis
    vec3 col = base * L;
    if (mat == 6) {   // cromado: brilho do ceu e do sol
        vec3 r = reflect(-V, n);
        col = base * mix(amb, uLight, 0.35) + vec3(0.35) * smoothstep(0.2, 0.9, r.z) * mix(0.4, 1.0, uSunUp)
            + vec3(0.8) * pow(max(dot(r, uSunB), 0.0), 24.0) * sh;
    }
    oC = vec4(min(col, vec3(1.0)), 1.0);
    oA = vec4(n, length(vPos - uEye));
}`;

const MASK_FS = `#version 300 es
precision highp float;
in vec3 vPos, vNrm, vCol;
in vec2 vUV;
in float vMat, vAO;
uniform vec3 uEye;
out vec4 oD;
${SHELL_GLSL}
void main() {
    if (int(vMat + 0.5) == 2 && shellOpen(vPos) < 0.0) discard;
    oD = vec4(length(vPos - uEye), 0.0, 0.0, 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 3) in float aMat;
uniform mat4 uShM, uModel;
out vec3 vPos;
out float vMat;
void main() { vPos = (uModel * vec4(aPos, 1.0)).xyz; vMat = aMat; gl_Position = uShM * vec4(vPos, 1.0); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in float vMat;
out vec4 o;
${SHELL_GLSL}
void main() { if (int(vMat + 0.5) == 2 && shellOpen(vPos) < 0.0) discard; o = vec4(1.0); }`;

// marca, no G-buffer da cena (baixa resolucao), os pixels que a cabine cobre por inteiro:
// profundidade 0 (o raymarching depois e pulado pelo teste de profundidade) e tipo 7
const MARK_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oG;
void main() {
    ivec2 q = ivec2(gl_FragCoord.xy), sz = textureSize(uMask, 0);
    float d = texelFetch(uMask, q, 0).r;
    if (d <= 0.0) discard;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
        if (texelFetch(uMask, clamp(q + ivec2(i, j), ivec2(0), sz - 1), 0).r <= 0.0) discard;
    oColor = vec4(0.1, 0.1, 0.11, 1.0);
    oG = vec4(d, 7.0, 0.0, 0.0);
    gl_FragDepth = 0.0;
}`;

// composicao na tela: contorno de desenho nas silhuetas, degraus de profundidade e quinas
const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uC, uA;
uniform vec2 uOrigin;
uniform int uLine;
out vec4 oColor;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy - uOrigin), sz = textureSize(uC, 0);
    vec4 c = texelFetch(uC, p, 0);
    vec4 a = texelFetch(uA, p, 0);
    if (a.w > 0.0) {
        float edge = 0.0;
        ivec2 D[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
        for (int k = 0; k < 4; k++) {
            vec4 b = texelFetch(uA, clamp(p + D[k] * uLine, ivec2(0), sz - 1), 0);
            vec4 bo = texelFetch(uA, clamp(p - D[k] * uLine, ivec2(0), sz - 1), 0);
            if (b.w <= 0.0) { edge = 1.0; continue; }
            float lap = b.w + (bo.w > 0.0 ? bo.w : a.w) - 2.0 * a.w;
            if (b.w > a.w * 1.03 + 0.004 && lap > 0.025 * a.w) edge = 1.0;
            else if (dot(a.xyz, b.xyz) < 0.55 && b.w > a.w - 0.002) edge = max(edge, 0.7);
        }
        c.rgb = mix(c.rgb, c.rgb * 0.30 + vec3(0.02, 0.02, 0.045), edge * 0.85);
    }
    oColor = c;
}`;

// ---------------------------------------------------------------------------
// a cabine
// ---------------------------------------------------------------------------
export class Cabin {
  constructor(gl, compile) {
    this.gl = gl;
    this.progMain = compile(MESH_VS, MAIN_FS);
    this.progMask = compile(MESH_VS, MASK_FS);
    this.progShadow = compile(SHADOW_VS, SHADOW_FS);
    this.progCompose = compile(QUAD, COMPOSE_FS);
    this.progMark = compile(QUAD, MARK_FS);
    this.art = new PanelArt(gl);
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (this.aniso) {
      gl.bindTexture(gl.TEXTURE_2D, this.art.tex);
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    const t0 = performance.now();
    const st = new Mesh(), sdf = new SDF();
    buildStatic(st, sdf);
    st.bakeAO(sdf);
    buildExterior(st);
    this.buildMs = performance.now() - t0;
    this.stat = this.upload(st, gl.STATIC_DRAW);
    const pr = new Mesh();
    buildProp(pr);
    this.prop = this.upload(pr, gl.STATIC_DRAW);
    const gm = new Mesh();
    buildGlass(gm);
    this.glass = this.upload(gm, gl.STATIC_DRAW);
    this.parts = buildParts().map((q) => ({ name: q.name, group: q.group, buf: this.upload(q.m, gl.STATIC_DRAW) }));
    this.ntris = (st.i.length + pr.i.length) / 3 + this.parts.reduce((a, q) => a + q.buf.count / 3, 0);
    this.M = partMatrices({ elev: 0, ail: 0, thr: 0, lever: 0, rud: 0, flap: 0, trim: 0 });
    this.body = true;
    // mapa de sombra
    this.SH = 1024;
    this.shTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.SH, this.SH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastT = performance.now();
    this.lastArt = 0;
  }

  upload(m, usage, old) {
    const gl = this.gl;
    const o = old || { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer() };
    gl.bindVertexArray(o.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, o.vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.v), usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(m.i), usage);
    const S = VF * 4;
    const at = [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 1, 36], [4, 2, 40], [5, 1, 48]];
    for (const [l, n, off] of at) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); }
    gl.bindVertexArray(null);
    o.count = m.i.length;
    return o;
  }

  draw(o) {
    const gl = this.gl;
    gl.bindVertexArray(o.vao);
    gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_INT, 0);
  }
  // tudo que e opaco: a parte fixa e cada parte movel com a sua matriz
  drawAll(p) {
    const gl = this.gl, loc = p.u.uModel;
    gl.uniformMatrix4fv(loc, false, MAT_I);
    this.draw(this.stat);
    for (const q of this.parts) {
      if (q.group === 'body' && !this.body) continue;
      gl.uniformMatrix4fv(loc, false, this.M[q.name]);
      this.draw(q.buf);
    }
  }

  // estado do quadro: painel, partes moveis, camera e sol no referencial do aviao, sombra
  prepare(I, iw, ih) {
    const gl = this.gl, now = performance.now();
    this.dt = Math.min(Math.max((now - this.lastT) / 1000, 0.004), 0.1);
    this.lastT = now;
    if (now - this.lastArt > 30) {
      this.art.update({ kt: I[67], ft: I[68], hdg: I[69], pitch: I[70], roll: I[71], fpm: I[72], rpm: I[73], flaps: I[74], trim: I[75], turn: I[76], slip: I[77] });
      this.lastArt = now;
    }
    const PF = [I[28], I[29], I[30]], PR = [I[31], I[32], I[33]], PU = [I[34], I[35], I[36]];
    const toB = (v) => [dot(v, PF), dot(v, PR), dot(v, PU)];
    this.vf = toB([I[3], I[4], I[5]]); this.vr = toB([I[6], I[7], I[8]]); this.vu = toB([I[9], I[10], I[11]]);
    this.eye = [I[83], I[84], I[85]];
    this.tanX = I[12]; this.hw = ih / iw;
    const sun = [I[20], I[21], I[22]];
    this.sunB = norm(toB(sun));
    this.sunUp = sstep(-0.03, 0.06, sun[2]);
    this.light = [I[49], I[50], I[51]]; this.shade = [I[52], I[53], I[54]];
    this.propA = I[37];
    this.rpm = I[73];
    this.sweep = Math.min(Math.max(I[73] / 60 * Math.PI * 2 * this.dt, 0), Math.PI);
    // olhando para tras o corpo do piloto some (o tronco gira junto com a cabeca)
    const yaw = Math.atan2(this.vf[1], this.vf[0]);
    this.body = Math.abs(yaw) < 1.45;
    const st = { elev: I[78], ail: I[79], thr: I[80], lever: I[81], rud: I[82], flap: I[74] / 30, trim: I[75] };
    // mao direita: vai mexer na alavanca dos flaps ou na roda do trim e depois volta para a manete
    this.clock = (this.clock || 0) + this.dt;   // relogio proprio (passo limitado): igual ao real a 60 fps
    const tk = this.clock * 1000;
    if (this.lastLever === undefined) { this.lastLever = st.lever; this.lastTrim = st.trim; this.leverT = this.trimT = 0; }
    if (st.lever !== this.lastLever) { this.lastLever = st.lever; this.leverT = tk + 1500; }
    if (Math.abs(st.trim - this.lastTrim) > 1e-5) this.trimT = tk + 900;
    this.lastTrim = st.trim;
    const want = tk < this.trimT ? 'trim' : tk < this.leverT ? 'lever' : 'thr';
    const tgt = handTarget(want, st);
    if (!this.hand) this.hand = tgt;
    const kh = 1 - Math.exp(-this.dt * 8);
    this.hand = add(this.hand, mul(sub(tgt, this.hand), kh));
    st.hand = this.hand;
    this.M = partMatrices(st);
    // matriz da sombra: projecao ortografica ao longo do sol, ~8 m em volta da cabine
    const Ls = this.sunB, hint = Math.abs(Ls[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
    const lx = norm(cross(hint, Ls)), ly = cross(Ls, lx), C = [-0.3, 0, 0.3], E = 4.2, Dz = 9;
    this.shM = new Float32Array([
      lx[0] / E, ly[0] / E, -Ls[0] / Dz, 0,
      lx[1] / E, ly[1] / E, -Ls[1] / Dz, 0,
      lx[2] / E, ly[2] / E, -Ls[2] / Dz, 0,
      -dot(C, lx) / E, -dot(C, ly) / E, dot(C, Ls) / Dz, 1,
    ]);
    // passada da sombra
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFB);
    gl.viewport(0, 0, this.SH, this.SH);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3.0);
    const p = this.progShadow;
    gl.useProgram(p);
    gl.uniformMatrix4fv(p.u.uShM, false, this.shM);
    if (this.sunUp > 0) this.drawAll(p);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  camUniforms(p) {
    const gl = this.gl, u = p.u;
    gl.uniform3fv(u.uEye, this.eye);
    gl.uniform3fv(u.uVF, this.vf);
    gl.uniform3fv(u.uVR, this.vr);
    gl.uniform3fv(u.uVU, this.vu);
    gl.uniform1f(u.uTanX, this.tanX);
    gl.uniform1f(u.uHW, this.hw);
  }

  // alvos: mascara em baixa resolucao e a cabine na resolucao da tela
  targets(iw, ih, W, H) {
    const gl = this.gl;
    if (this.mw !== iw || this.mh !== ih) {
      if (this.mFB) { gl.deleteFramebuffer(this.mFB); gl.deleteTexture(this.mTex); gl.deleteRenderbuffer(this.mRB); }
      this.mw = iw; this.mh = ih;
      this.mTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.mTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, iw, ih);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.mRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.mRB);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, iw, ih);
      this.mFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.mRB);
    }
    if (this.cw !== W || this.ch !== H) {
      if (this.cFB) { gl.deleteFramebuffer(this.cFB); gl.deleteTexture(this.cTex); gl.deleteTexture(this.aTex); gl.deleteRenderbuffer(this.cRB); }
      this.cw = W; this.ch = H;
      const mk = (fmt) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, W, H);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return t;
      };
      this.cTex = mk(gl.RGBA8);
      this.aTex = mk(gl.RGBA16F);
      this.cRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.cRB);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      this.cFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.aTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.cRB);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // mascara da cabine em baixa resolucao (distancia ate a malha, 0 = nada)
  maskPass(iw, ih) {
    const gl = this.gl, p = this.progMask;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mFB);
    gl.viewport(0, 0, iw, ih);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(p);
    this.camUniforms(p);
    this.drawAll(p);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  // no FBO da cena (ja ligado, com profundidade limpa): marca os pixels cobertos
  markPass(drawQuad) {
    const gl = this.gl, p = this.progMark;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mTex);
    gl.uniform1i(p.u.uMask, 0);
    drawQuad(p);
    gl.disable(gl.DEPTH_TEST);
  }

  // a cabine na resolucao da tela
  mainPass(W, H) {
    const gl = this.gl, p = this.progMain;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cFB);
    gl.viewport(0, 0, W, H);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(p);
    this.camUniforms(p);
    const u = p.u;
    gl.uniform3fv(u.uSunB, this.sunB);
    gl.uniform3fv(u.uLight, this.light);
    gl.uniform3fv(u.uShade, this.shade);
    gl.uniform1f(u.uSunUp, this.sunUp);
    gl.uniform1f(u.uProp, this.propA);
    gl.uniform1f(u.uSweep, this.sweep);
    gl.uniformMatrix4fv(u.uShM, false, this.shM);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shTex); gl.uniform1i(u.uShadow, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.art.tex); gl.uniform1i(u.uAtlas, 1);
    this.drawAll(p);
    // helice por cima, translucida (so cor, sem gravar profundidade)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(u.uModel, false, MAT_I);
    this.draw(this.prop);
    this.draw(this.glass);   // vidros por cima da helice (estao mais perto)
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  // por cima da imagem do mundo, na tela (viewport ja ajustado pelo chamador)
  compose(drawQuad, ox, oy, line) {
    const gl = this.gl, p = this.progCompose;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cTex); gl.uniform1i(p.u.uC, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.aTex); gl.uniform1i(p.u.uA, 1);
    gl.uniform2f(p.u.uOrigin, ox, oy);
    gl.uniform1i(p.u.uLine, line);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawQuad(p);
    gl.disable(gl.BLEND);
  }
}

const QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// para testes fora do navegador (node): monta as malhas e devolve contagens
export function buildForTest() {
  const st = new Mesh(), sdf = new SDF();
  const t0 = Date.now();
  buildStatic(st, sdf);
  st.bakeAO(sdf);
  buildExterior(st);
  const parts = buildParts();
  const dy = new Mesh();
  for (const q of parts) { for (const i of q.m.i) dy.i.push(i + dy.n); dy.v.push(...q.m.v); dy.n += q.m.n; }
  const pr = new Mesh();
  buildProp(pr);
  const t1 = performance.now();
  for (let k = 0; k < 1000; k++) partMatrices({ elev: Math.sin(k), ail: 0.3, thr: 0.5, lever: 2, rud: 0.1, flap: 0.6, trim: 0.1 });
  return { st, dy, pr, ms: Date.now() - t0, matUs: (performance.now() - t1) };
}

