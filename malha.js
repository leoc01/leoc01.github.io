// malha.js - pecas genericas para montar avioes em malha: vetores, malha de triangulos,
// campo de distancia (oclusao ambiente por vertice) e matrizes. Nada aqui e de um aviao especifico.

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

// materiais (o shader decide a luz): 0 interior liso, 1 textura do painel, 2 casco (janelas e
// zonas de cor), 3 tecido dos bancos, 4 disco da helice, 5 exterior, 6 cromado, 7 vidro das janelas,
// 8 para-brisa, 9 luzes de navegacao, 10 capo, 11 pele de fora, 12 pintado (10-12 levam a pintura)
const M_IN = 0, M_TEX = 1, M_SHELL = 2, M_SEAT = 3, M_PROP = 4, M_EXT = 5, M_CHROME = 6, M_GLASS = 7, M_WSHIELD = 8, M_NAV = 9, M_COWL = 10,
  M_SKIN = 11, M_LIVERY = 12;   // 11: pele de fora da fuselagem (janelas recortadas); 10-12 levam a pintura (faixa vinho e filete dourado)
const VF = 13;   // floats por vertice: pos3 normal3 cor3 material uv2 oclusao

// ---------------------------------------------------------------------------
// campo de distancia (so para a oclusao ambiente por vertice)
// ---------------------------------------------------------------------------
class SDF {
  // inner(p): distancia ate as paredes por dentro (positiva dentro), propria de cada aviao
  constructor(inner) { this.prims = []; this.inner = inner || (() => 1e9); }
  // caixa arredondada orientada: c centro, ax eixos (3 vetores unitarios), h meia-medida, r raio
  box(c, ax, h, r) { this.prims.push({ t: 0, c, ax, h, r, R: len(h) + r }); }
  cap(a, b, r) { this.prims.push({ t: 1, a, b, r, c: mul(add(a, b), 0.5), R: len(sub(b, a)) / 2 + r }); }
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

export { add, sub, mul, dot, cross, len, norm, lerp, clamp, sstep, hex, rad, M_IN, M_TEX, M_SHELL, M_SEAT, M_PROP, M_EXT, M_CHROME, M_GLASS, M_WSHIELD, M_NAV, M_COWL, M_SKIN, M_LIVERY, VF, SDF, Mesh, IDENT, tilt, ik, matRT, MAT_I, matT, matAxis, matAlong, xform };
