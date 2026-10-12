// aviao-c172.js - o Cessna 172 em malha: cabine, painel, piloto, partes que se mexem, o aviao
// por fora, e o GLSL que recorta as janelas e pinta a fuselagem. Outro aviao (ex.: 152 Aerobat)
// e outro arquivo com as mesmas exportacoes; web/aviao.js escolhe qual usar.
// Referencial do aviao: x para frente, y para a direita, z para cima (metros, origem no CG).
import { PanelArt, PANEL, FLAPS, THROTTLE, MIXTURE, GLARE, glareEdgeZ, R_PANEL, R_COMP, R_EMBLEM, R_PED, PED_SCALE, atlasUV } from './cockpit.js';
import { add, sub, mul, dot, cross, len, norm, lerp, clamp, sstep, hex, rad, M_IN, M_TEX, M_SHELL, M_SEAT, M_PROP, M_EXT, M_CHROME, M_GLASS, M_WSHIELD, M_NAV, M_COWL, M_SKIN, M_LIVERY, VF, SDF, Mesh, IDENT, tilt, ik, matRT, MAT_I, matT, matAxis, matAlong, xform } from './malha.js';

// ---------------------------------------------------------------------------
// vetores
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// cores e materiais
// ---------------------------------------------------------------------------
const COL = {
  cream: hex('#ddd3bb'), creamDk: hex('#c9bea4'), red: hex('#8e2a24'), redDk: hex('#6e1f1b'), seat: hex('#a3322b'),
  carpet: hex('#4a3d37'), leather: hex('#2b292d'), black: hex('#19191c'), dark: hex('#2e2d31'), chrome: hex('#b9bcc2'),
  white: hex('#eeeeea'), redExt: hex('#c72a24'), blue: hex('#29408c'), tyre: hex('#111111'),
  shirt: hex('#9fb9d4'), skin: hex('#d9a582'), jeans: hex('#34486b'), shoe: hex('#3a2a20'), knobRed: hex('#c2241c'),
  green: hex('#2fd04a'), navRed: hex('#ff2a1a'), yellow: hex('#f2c230'), wine: hex('#8f2621'), gold: hex('#c9a24a'),
  hair: hex('#3b2a20'), headset: hex('#56603f'),
};
// materiais (o shader decide a luz): 0 interior liso, 1 textura do painel, 2 casco (janelas e
// zonas de cor), 3 tecido dos bancos, 4 disco da helice, 5 exterior, 6 cromado, 7 vidro das janelas
// (copia do casco, so onde ha janela), 8 vidro do para-brisa

// ---------------------------------------------------------------------------
// geometria da cabine (precisa bater com o shader: ver SHELL_GLSL)
// ---------------------------------------------------------------------------
const X_AFT = -1.70, X_FWD = 1.46;
const ROOF_BRK = -0.85;   // o teto desce atras do bordo de fuga da asa
const roofZ = (x) => x > ROOF_BRK ? 0.80 : 0.80 - (ROOF_BRK - x) * 0.282;
const floorZ = (x) => -0.40 + 0.12 * sstep(-0.6, -1.70, x);
const halfW = (x) => 0.565 - 0.095 * sstep(-0.7, -1.70, x);
const RB = 0.12, RT = 0.14;          // raios dos cantos de baixo e de cima da secao
const xws = (z) => 1.29 - (z - 0.245) * 0.81;   // linha do para-brisa no meio: (1.29, 0.245) a (1.0, 0.80)
// o para-brisa abraca os lados: a base desce acompanhando o arco da pala e, em cima, os lados
// recuam (as colunas ficam mais para tras e para fora, como no 172)
const zbase = (y) => glareEdgeZ(y) - 0.006;
// coluna (A) na parede lateral: comeca logo atras do canto do painel e recua ate o teto
const xpil = (z) => 1.13 - (z - 0.10) * 0.47;
const xw = (y, z) => lerp(xws(Math.max(z, zbase(y))), xpil(z), sstep(0.22, 0.565, Math.abs(y)));
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
    }
    m.plane([PX, -0.57, PANEL.PZ0], [PX, 0.57, PANEL.PZ0], [PX, -0.57, -0.16], 12, 1, { col: COL.redDk, ao: true, ref: () => [PX + 1, 0, 0.1] });
    m.plane([PX, -0.57, -0.16], [PX, 0.57, -0.16], [X_FWD, -0.57, -0.42], 12, 3, { col: COL.carpet, ao: true, ref: () => [PX + 1, 0, 0.3] });
  }
  // ----- pala de couro preto, arredondada, por cima do painel -----
  {
    // tampo: da borda arredondada ate a base do para-brisa
    const top = GLARE.z + 0.011;
    {   // capuz: da borda arredondada (que segue o arco dos cantos) ate a base do para-brisa
      const Y = []; for (let k = 0; k <= 64; k++) Y.push(-0.567 + 1.134 * k / 64);
      const V = [0, 0.15, 0.35, 0.6, 0.85, 1];
      m.surf(Y, V, (y, v) => {
        const zf = glareEdgeZ(y) + 0.011, zb = zbase(y) - 0.002, xb = Math.max(xw(y, zb) + 0.006, PX + 0.035);
        return [lerp(PX - 0.004, xb, v), y, lerp(zf, zb, v) + 0.009 * Math.sin(Math.PI * Math.min(v * 1.15, 1))];
      }, { col: COL.leather, ao: true, ref: (p) => [p[0], p[1] * 0.9, p[2] - 0.3] });
    }
    sdf.box([1.25, 0, 0.255], IDENT, [0.05, 0.57, 0.012], 0.0);
    // friso arredondado da borda: reto no meio e descendo em arco nos cantos (varrido ao longo do caminho)
    const yEnd = 0.565, zEnd = GLARE.z - GLARE.r;
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
    m.cyl([0.55, s * 0.45, 0.80], [0.55, s * 0.45, 0.72], 0.032, { col: COL.creamDk, ao: true });
    m.cyl([0.55, s * 0.45, 0.721], [0.55, s * 0.45, 0.70], 0.02, { col: COL.dark });
  }
  m.cyl([0.10, 0, 0.80], [0.10, 0, 0.785], 0.05, { col: COL.creamDk });
  // ----- bancos -----
  const fabric = { col: COL.seat, mat: M_SEAT, ao: true, sdf, uv: seatUV, step: 0.09 };
  for (const y0 of YOKE_Y) {
    m.rbox([0.43, y0, -0.235], IDENT, [0.235, 0.215, 0.07], 0.055, fabric);
    m.rbox([0.14, y0, 0.08], tilt(rad(12)), [0.055, 0.215, 0.26], 0.05, fabric);
    m.rbox([0.43, y0, -0.35], IDENT, [0.16, 0.15, 0.035], 0.015, { col: COL.dark, ao: true, sdf });
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
  sdf.box([0.43, -0.27, -0.235], IDENT, [0.18, 0.16, 0.015], 0.055);
}

// ----- o aviao visto de dentro (fixo) -----
const WING = { le: 0.80, te: -0.80, hinge: -0.52, zb: 0.83, t: 0.16 };   // bordo de ataque ~0,65 m atras da parede de fogo, como no 172
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
    const st = [[1.22, 0.25, 0.578, -0.56], [1.75, 0.262, 0.555, -0.50], [2.20, 0.255, 0.515, -0.42], [2.55, 0.205, 0.445, -0.33],
                [2.78, 0.150, 0.355, -0.25], [2.93, 0.105, 0.27, -0.19]];
    const at = (x) => {
      let i = 0; while (i < st.length - 2 && x > st[i + 1][0]) i++;
      const a = st[i], b = st[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1), s = t * t * (3 - 2 * t);
      return [lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)];
    };
    const U = [], A = [];
    U.push(1.22, 1.26); for (let x = 1.30; x < 2.93; x += 0.1) U.push(x);
    U.push(2.93);
    for (let k = 0; k <= 32; k++) A.push(-Math.PI + 2 * Math.PI * k / 32);
    const cowlPt = (x, a) => {
      const [top, hw, bot] = at(x), cz = (top + bot) / 2, hz = (top - bot) / 2;
      const s = Math.sin(a), c = Math.cos(a), e = 2 / (3.2 + 3.5 * (1 - sstep(1.22, 2.3, x)));   // atras mais quadrado (encosta no para-brisa)
      return [x, hw * Math.sign(s) * Math.abs(s) ** e, cz + hz * Math.sign(c) * Math.abs(c) ** e];
    };
    m.surf(U, A, cowlPt, { col: (p) => (Math.abs(p[1]) < 0.012 && p[0] > 1.5 && p[2] > 0 ? COL.creamDk : white), mat: M_COWL, ref: (p) => [p[0], 0, at(p[0])[2] / 2 + at(p[0])[0] / 2] });
    // frente do capo (grade escura) com as duas entradas de ar
    const cb = m.n;
    m.vert([2.935, 0, -0.04], [1, 0, 0], COL.dark, M_EXT);
    for (const a of A) m.vert(cowlPt(2.93, a), [1, 0, 0], COL.dark, M_EXT);
    for (let k = 0; k < A.length - 1; k++) m.i.push(cb, cb + 1 + k, cb + 2 + k);
    for (const s of [-1, 1]) m.rbox([2.94, s * 0.155, -0.03], IDENT, [0.006, 0.085, 0.05], 0.03, { col: COL.black, mat: M_EXT });
    // spinner vermelho
    const prof = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, f = t * Math.PI / 2;
      prof.push({ s: 0.36 * Math.sin(f), r: 0.17 * Math.cos(f) + 1e-4, ns: Math.sin(f) * 0.6, nr: Math.cos(f) });
    }
    m.lathe([2.92, 0, 0.02], [3.3, 0, 0.02], prof, 18, { col: COL.wine, mat: M_EXT });
  }
  // ----- asas: parte fixa ate a articulacao + pontas vermelhas + nervura central -----
  for (const s of [-1, 1]) {
    const ys = (a, b, n) => { const r = []; for (let k = 0; k <= n; k++) r.push(s * lerp(a, b, k / n)); return s < 0 ? r.reverse() : r; };
    m.extrude(wingProf.fixed, ys(0.0, TIP_Y, 10), { col: white, mat: M_EXT, closed: true });
    // pedacos fixos atras da articulacao (entre flap e aileron, e na ponta)
    m.extrude(wingProf.mov, ys(FLAP_Y[1], AIL_Y[0], 1), { col: white, mat: M_EXT, closed: true });
    m.extrude(wingProf.mov, ys(AIL_Y[1], TIP_Y, 1), { col: white, mat: M_EXT, closed: true });
    m.extrude(wingProf.full, ys(TIP_Y, SPAN, 2), { col: COL.wine, mat: M_EXT, closed: true, caps: [[s * SPAN, s]] });
    // luz de navegacao na ponta
    m.rbox([0.10, s * (SPAN + 0.02), 0.90], IDENT, [0.10, 0.02, 0.02], 0.015, { col: s < 0 ? COL.navRed : COL.green, mat: M_NAV });
    // montante (perfil achatado) da fuselagem ate a asa
    const a = [0.30, s * 0.58, -0.32], b = [0.30, s * 2.40, WING.zb + 0.01], ax = norm(sub(b, a));
    const side = norm(cross(ax, [1, 0, 0])), Ls = len(sub(b, a));
    const U = [], A = [];
    for (let k = 0; k <= 6; k++) U.push(k / 6);
    for (let k = 0; k <= 12; k++) A.push(k / 12 * Math.PI * 2);
    m.surf(U, A, (t, ang) => add(add(a, mul(ax, t * Ls)), add(mul([1, 0, 0], 0.055 * Math.cos(ang)), mul(side, 0.018 * Math.sin(ang)))),
      { col: white, mat: M_EXT, ref: (p) => add(a, mul(ax, dot(sub(p, a), ax))) });
  }
  // ----- cone de cauda, estabilizador, deriva -----
  {
    const st = [[X_AFT, 0.58, 0.483, -0.56], [-2.6, 0.585, 0.43, -0.40], [-3.6, 0.55, 0.33, -0.15], [-4.6, 0.48, 0.18, 0.08], [-5.30, 0.43, 0.06, 0.24]];
    const at = (x) => {
      let i = 0; while (i < st.length - 2 && x < st[i + 1][0]) i++;
      const a = st[i], b = st[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    };
    const U = [], A = [];
    for (let k = 0; k <= 10; k++) U.push(lerp(X_AFT, -5.30, k / 10));
    for (let k = 0; k <= 24; k++) A.push(k / 24 * Math.PI * 2);
    // mesma secao da fuselagem (sem degrau na emenda), com os raios diminuindo ate a cauda
    const shape = (x, a) => {
      const [top, hw, bot] = at(x), k = clamp((x - -5.3) / (X_AFT - -5.3), 0, 1);
      return rrSection(x, hw, top, bot, 0.06 + 0.16 * k, 0.05 + 0.11 * k, a / (Math.PI * 2) + 0.75);
    };
    m.surf(U, A, shape, { col: white, mat: M_LIVERY, ref: (p) => [p[0], 0, at(p[0])[0] / 2 + at(p[0])[2] / 2] });
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
      for (const p of P) m.vert(p, [0, sy, 0], white, M_LIVERY);
      m.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    m.extrude([[-4.15, 0.45], [-4.95, 1.95], [-5.25, 1.95]], [-0.04, 0.04], { col: white, mat: M_LIVERY, ref: [-4.9, 1.0] });
  }
}

// ----- so de fora: pele da fuselagem, trem de pouso, escapamento, cabeca do piloto -----
const SKIN_BOT = -0.56;
const skinTop = (x) => x > ROOF_BRK ? 0.865 : lerp(0.58, 0.865, sstep(X_AFT, ROOF_BRK, x));
function skinPoint(x, s) { return rrSection(x, halfW(x) + 0.013, skinTop(x), SKIN_BOT, 0.22, 0.16, s); }
// secao de retangulo arredondado (largura w, topo r, fundo f, raios de baixo e de cima), por comprimento de arco s
function rrSection(x, w, r, f, rb, rt, s) {
  rb = Math.min(rb, w - 1e-3, (r - f) / 2 - 1e-3); rt = Math.min(rt, w - 1e-3, (r - f) / 2 - 1e-3);
  const segs = [
    ['l', [0, f], [w - rb, f]], ['a', [w - rb, f + rb], rb, -Math.PI / 2, 0], ['l', [w, f + rb], [w, r - rt]],
    ['a', [w - rt, r - rt], rt, 0, Math.PI / 2], ['l', [w - rt, r], [-(w - rt), r]], ['a', [-(w - rt), r - rt], rt, Math.PI / 2, Math.PI],
    ['l', [-w, r - rt], [-w, f + rb]], ['a', [-(w - rb), f + rb], rb, Math.PI, Math.PI * 1.5], ['l', [-(w - rb), f], [0, f]],
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
function buildOutside(m) {
  const U = [];
  for (let x = X_AFT; x < 1.24 - 1e-6; x += 0.08) U.push(x);
  U.push(1.24);
  const S = []; for (let k = 0; k <= 64; k++) S.push(k / 64);
  m.surf(U, S, skinPoint, { col: COL.white, mat: M_SKIN, ref: (p) => [p[0], 0, 0.15] });
  // trem principal: molas achatadas, rodas e carenagens
  const flat = (a, b, wx, wy, col) => {
    const ax = norm(sub(b, a)), side = norm(cross(ax, [1, 0, 0])), Ls = len(sub(b, a)), T = [], A = [];
    for (let k = 0; k <= 4; k++) T.push(k / 4);
    for (let k = 0; k <= 12; k++) A.push(k / 12 * Math.PI * 2);
    m.surf(T, A, (t, g) => add(add(a, mul(ax, t * Ls)), add(mul([1, 0, 0], wx * Math.cos(g)), mul(side, wy * Math.sin(g)))),
      { col, mat: M_EXT, ref: (p) => add(a, mul(ax, dot(sub(p, a), ax))) });
  };
  const wheel = (c, r, w) => {
    m.cyl([c[0], c[1] - w, c[2]], [c[0], c[1] + w, c[2]], r, { col: COL.tyre, mat: M_EXT }, 20);
    m.cyl([c[0], c[1] - w - 0.004, c[2]], [c[0], c[1] + w + 0.004, c[2]], r * 0.42, { col: COL.chrome, mat: M_EXT }, 14);
  };
  // carenagem da roda em gota: secao eliptica, mais gorda na frente e afinando atras
  const pant = (c, hx, hy, hz) => {
    const T = [], A = [];
    for (let k = 0; k <= 14; k++) T.push(k / 14);
    for (let k = 0; k <= 18; k++) A.push(k / 18 * Math.PI * 2);
    m.surf(T, A, (t, a) => {
      const f = t < 0.45 ? Math.sqrt(Math.sin(Math.PI * t / 0.9)) : 1 - 0.75 * ((t - 0.45) / 0.55) ** 1.6;   // mais gorda no meio (onde fica a roda)
      return [c[0] + hx * 0.9 - 2 * hx * t, c[1] + hy * f * Math.cos(a), c[2] + hz * f * Math.sin(a)];
    }, { col: COL.white, mat: M_LIVERY, ref: (p) => [p[0], c[1], c[2]] });
  };
  for (const s of [-1, 1]) {
    flat([-0.12, s * 0.40, SKIN_BOT + 0.04], [-0.40, s * 1.15, -0.93], 0.05, 0.016, COL.white);   // mola inclinada para tras
    wheel([-0.40, s * 1.22, -0.99], 0.21, 0.065);
    pant([-0.40, s * 1.22, -0.93], 0.42, 0.10, 0.23);
  }
  // trem do nariz: perna com amortecedor cromado, roda e carenagem
  m.cyl([2.18, 0, -0.40], [2.24, 0, -0.74], 0.04, { col: COL.white, mat: M_EXT }, 10);
  m.cyl([2.24, 0, -0.74], [2.28, 0, -0.92], 0.026, { col: COL.chrome, mat: M_CHROME }, 10);
  wheel([2.29, 0, -1.03], 0.17, 0.05);
  pant([2.29, 0, -0.985], 0.33, 0.08, 0.18);
  // escapamento embaixo do capo, a direita
  m.cyl([2.50, 0.20, -0.36], [2.60, 0.24, -0.50], 0.028, { col: COL.dark, mat: M_EXT }, 10);
  // farol rotativo no alto da deriva
  m.rbox([-5.06, 0, 1.975], IDENT, [0.045, 0.03, 0.028], 0.022, { col: hex('#c0281c'), mat: M_EXT });
}
// cabeca do piloto (so de fora: de dentro a camera esta nela), com fone de ouvido verde
function buildHead(m) {
  const c = [0.415, -0.27, 0.50];
  m.rbox(c, IDENT, [0.10, 0.082, 0.115], 0.08, { col: COL.skin });
  m.rbox([c[0] - 0.03, c[1], c[2] + 0.04], IDENT, [0.088, 0.086, 0.085], 0.075, { col: COL.hair });
  for (const s of [-1, 1]) m.cyl([c[0] - 0.01, c[1] + s * 0.08, c[2] - 0.005], [c[0] - 0.01, c[1] + s * 0.115, c[2] - 0.005], 0.045, { col: COL.headset }, 14);
  m.capsule([c[0] - 0.01, c[1] - 0.10, c[2] + 0.02], [c[0] - 0.01, c[1], c[2] + 0.125], 0.012, { col: COL.black }, 6);
  m.capsule([c[0] - 0.01, c[1] + 0.10, c[2] + 0.02], [c[0] - 0.01, c[1], c[2] + 0.125], 0.012, { col: COL.black }, 6);
  m.capsule([c[0] - 0.01, c[1] - 0.115, c[2] - 0.02], [c[0] + 0.10, c[1] - 0.04, c[2] - 0.07], 0.007, { col: COL.black }, 6);
}

// ---------------------------------------------------------------------------
// partes que se mexem: cada uma e uma malha fixa no seu referencial, movida por uma matriz
// (calculada a cada quadro, barata) - nada de refazer triangulos durante o voo
// ---------------------------------------------------------------------------

// pose do piloto e das pecas (tambem usada para posicionar os membros)
const HIP = (s) => [0.30, -0.27 + s * 0.09, -0.12];
const KNEE = (s) => [0.80, -0.27 + s * 0.10, -0.07];
const PEDAL = (y0, s) => [1.255, y0 + s * 0.09, -0.275];
const ANKLE = (s) => { const p = PEDAL(YOKE_Y[0], s); return [p[0] - 0.045, p[1], p[2] + 0.03]; };
const L_THIGH = len(sub(KNEE(-1), HIP(-1))), L_SHIN = len(sub(ANKLE(-1), KNEE(-1)));
const L_UP = 0.33, L_FORE = 0.30;
const SH_L = [0.47, -0.45, 0.20], SH_R = [0.47, -0.10, 0.19];
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
  // sapatos de quem senta a direita (so com dois no aviao): presos aos pedais da direita
  [-1, 1].forEach((s) => part('shoe2' + s, 'body2', (m) => {
    const c = PEDAL(YOKE_Y[1], s);
    m.rbox([c[0] - 0.035, c[1], c[2] + 0.005], tilt(rad(30)), [0.10, 0.042, 0.035], 0.03, { col: COL.shoe });
  }));
  // ----- piloto: tronco fixo, membros como capsulas de comprimento fixo ao longo do x local -----
  part('torso', 'body', (m) => m.capsule([0.33, -0.27, -0.10], [0.40, -0.27, 0.13], 0.145, { col: COL.shirt }, 14));
  const limb = (name, L, r, col) => part(name, 'body', (m) => m.capsule([0, 0, 0], [L, 0, 0], r, { col }, 10));
  for (const s of [-1, 1]) { limb('thigh' + s, L_THIGH, 0.075, COL.jeans); limb('shin' + s, L_SHIN, 0.056, COL.jeans); }
  // ----- prancheta na coxa (de dentro): tabua, presilha e o papel (textura das folhas, material 14) -----
  // centro na origem; x ao longo da coxa (o "cima" do papel aponta para o joelho), y para a direita
  const BW = 0.115, BL = 0.155;   // meia largura e meio comprimento
  const board = (m, flip) => {
    m.rbox([0, 0, -0.006], IDENT, [BL, BW, 0.005], 0.004, { col: hex('#7a5638') });
    m.rbox([BL - 0.012, 0, 0.004], IDENT, [0.016, 0.05, 0.006], 0.004, { col: COL.chrome, mat: M_CHROME });
    m.rbox([0, BW + 0.004, -0.02], IDENT, [0.05, 0.004, 0.02], 0.003, { col: COL.black });   // elastico na perna
    m.rbox([0, -BW - 0.004, -0.02], IDENT, [0.05, 0.004, 0.02], 0.003, { col: COL.black });
    const x0 = -BL + 0.008, x1 = BL - 0.03, y0 = -BW + 0.008, y1 = BW - 0.008;
    m.plane([x1, y0, 0.0005], [x1, y1, 0.0005], [x0, y0, 0.0005], 1, 1, {
      col: [1, 1, 1], mat: 14, ref: () => [0, 0, -1],
      uv: (p) => [flip ? 1 - (p[1] - y0) / (y1 - y0) : (p[1] - y0) / (y1 - y0), (x1 - p[0]) / (x1 - x0)] });
  };
  part('board', 'body', (m) => board(m, false));
  part('boardM', 'boardM', (m) => board(m, true));   // a do banco da direita (desenhada espelhada)
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
  const rprof = [[-5.25, 0.04], [-5.45, 0.014], [-5.52, 0.0], [-5.45, -0.014], [-5.25, -0.04]];   // mesma espessura da deriva na articulacao
  part('rud', 'ext', (m) => m.extrude(rprof, [0.44, 1.95], {
    col: COL.white, mat: M_LIVERY, closed: true, caps: [[1.95, 1]], map: (p) => [p[0], p[2], p[1]], mapN: (n) => [n[0], n[2], n[1]] }));
  return parts;
}

// onde a mao direita vai: manete (normal), alavanca dos flaps ou roda do trim
function handTarget(what, st) {
  if (what === 'lever') return [PX - 0.048, FLAPS.y, lerp(FLAPS.z0, FLAPS.z1, st.lever / 3)];
  if (what === 'trim') return [TRIMW.x - TRIMW.r - 0.025, TRIMW.y + 0.005, TRIMW.z + 0.03];
  return [KNOB0 - 0.075 * (1 - st.thr) - 0.045, THROTTLE.y - 0.005, THROTTLE.z + 0.01];
}


// corpo de uma pessoa no banco da esquerda: pernas nos pedais; maos no manche e na manete (quem
// pilota) ou no colo (quem nao esta com os comandos). opt.hand: alvo da mao direita.
const LAP = (s) => add(lerp3(HIP(s), KNEE(s), 0.62), [0.0, -s * 0.01, 0.085]);
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function bodyMatrices(st, opt) {
  const M = {};
  M.torso = MAT_I;
  for (const s of [-1, 1]) {
    const pd = s * 0.045 * st.rud;
    const ank = add(ANKLE(s), [pd, 0, 0]);
    const knee = add(KNEE(s), [pd * 0.4, 0, 0]);
    M['thigh' + s] = matAlong(HIP(s), knee);
    M['shin' + s] = matAlong(knee, ank);
  }
  {   // prancheta em cima da coxa de dentro, seguindo a coxa
    const pd = 0.045 * st.rud;
    const hip = HIP(1), knee = add(KNEE(1), [pd * 0.4, 0, 0]);
    const d = norm(sub(knee, hip)), c = add(lerp3(hip, knee, 0.72), [0, 0, 0.11]);
    const y = norm(sub([0, 1, 0], mul(d, d[1]))), z = cross(d, y);
    // inclinada para o rosto: a ponta do joelho sobe e a borda de dentro levanta um pouco
    const rx = rad(-10), ry = rad(-12);
    const d1 = norm(add(mul(d, Math.cos(ry)), mul(z, -Math.sin(ry)))), z1 = cross(d1, y);
    const y2 = norm(add(mul(y, Math.cos(rx)), mul(z1, Math.sin(rx)))), z2 = cross(d1, y2);
    M.board = matRT([d1, y2, z2], c);
  }
  const yoke0 = matAxis([1, 0, 0], -st.ail * rad(38), [0, YOKE_Y[0], YOKE_Z], [-0.065 * st.elev, 0, 0]);
  const grip = xform(yoke0, GRIP_L);
  // pesos: 1 = mao no comando, 0 = mao no colo (a troca de comandos anima entre os dois)
  const wY = opt.wY ?? (opt.lap ? 0 : 1), wT = opt.wT ?? (opt.lap ? 0 : 1);
  const hL = lerp3(LAP(-1), add(grip, [0, -0.012, 0]), wY);
  const hR = lerp3(LAP(1), opt.hand || handTarget('thr', st), wT);
  for (const [k, S0, H, hint] of [['L', SH_L, hL, [-0.3, -0.5, -1]], ['R', SH_R, hR, [-0.4, 0.4, -1]]]) {
    // longe demais: o tronco se inclina (o ombro avanca na direcao da mao)
    const dd = sub(H, S0), far = len(dd) - (L_UP + L_FORE - 0.03);
    const S = far > 0 ? add(S0, mul(norm(dd), far)) : S0;
    const [E, W] = ik(S, H, L_UP, L_FORE, hint);
    M['up' + k] = matAlong(S, E);
    M['fore' + k] = matAlong(E, W);
    M['hand' + k] = matT(W);
  }
  return M;
}
// espelho no plano y = 0: o banco da esquerda vira o da direita
const MIRROR = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul4(A, B) {
  const R = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += A[k * 4 + r] * B[c * 4 + k];
    R[c * 4 + r] = v;
  }
  return R;
}
// a pessoa do banco da direita: o mesmo corpo espelhado (manche e pedais da direita; a manete e a
// alavanca continuam no lugar de verdade: o alvo da mao e espelhado antes)
function rightPersonMatrices(st, opt) {
  const mir = (p) => [p[0], -p[1], p[2]];
  const B = bodyMatrices({ ...st, ail: -st.ail, rud: -st.rud }, { lap: opt.lap, wY: opt.wY, wT: opt.wT, hand: opt.hand ? mir(opt.hand) : mir(handTarget('thr', st)) });
  const M = {};
  for (const k in B) M[k] = mul4(MIRROR, B[k]);
  M.head = MIRROR;
  return M;
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
  Object.assign(M, bodyMatrices(st, { lap: st.lap, wY: st.wY, wT: st.wT, hand: st.hand }));
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
  const Y = []; for (let k = 0; k <= 24; k++) Y.push(-0.575 + 1.15 * k / 24);
  m.surf(Y, [0, 0.25, 0.5, 0.75, 1], (y, v) => { const z = lerp(zbase(y), 0.80, v); return [xw(y, z), y, z]; },
    { col: [1, 1, 1], mat: M_WSHIELD, ref: (p) => [p[0] + 1, 0, 0.5] });
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
float xws(float z) { return 1.29 - (z - 0.245) * 0.81; }
float glareEdge(float y) { float d = abs(y) - ${GLARE.yc.toFixed(4)}; return d <= 0.0 ? ${GLARE.z.toFixed(4)} : ${(GLARE.z - GLARE.r).toFixed(4)} + sqrt(max(${(GLARE.r * GLARE.r).toFixed(6)} - d * d, 0.0)); }
float zbase(float y) { return glareEdge(y) - 0.006; }
float xpil(float z) { return 1.13 - (z - 0.10) * 0.47; }
float xw(float y, float z) { return mix(xws(max(z, zbase(y))), xpil(z), smoothstep(0.22, 0.565, abs(y))); }
// cantos de cima do painel (recortados na textura): fora da mascara e da sombra tambem
bool panelCut(vec3 p) { return abs(p.x - ${PANEL.PX.toFixed(3)}) < 0.002 && p.z > glareEdge(p.y) - 0.004; }
float sdRR(vec2 p, vec2 c, vec2 h, float r) { vec2 q = abs(p - c) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
// pedaco do capo que cairia dentro da cabine (recortado em todas as passadas)
bool cowlInside(vec3 p) { return p.x < xw(p.y, p.z) + 0.003 && abs(p.y) < 0.566 && p.z < 0.8 && p.z > zbase(p.y) - 0.03; }
// distancia (m) ate a abertura mais proxima: < 0 = janela (recortada)
float shellOpen(vec3 p) {
    float d = 1.0;
    if (p.z > zbase(p.y)) d = (xw(p.y, p.z) - p.x) * 0.88;
    if (abs(p.y) > 0.36) {
        d = min(d, max(sdRR(p.xz, vec2(0.72, 0.52), vec2(0.59, 0.19), 0.05), (p.x - xw(p.y, p.z) + 0.07) * 0.88));
        // janela de tras: menor e afinando para tras (o topo desce acompanhando a fuselagem)
        vec2 q = p.xz - vec2(-0.45, 0.51);
        d = min(d, max(sdRR(p.xz, vec2(-0.45, 0.51), vec2(0.45, 0.17), 0.08), (q.y - 0.12 - q.x * 0.10) * 0.9));
    } else if (p.z > 0.5 && p.x < -0.85) {
        d = min(d, sdRR(p.xy, vec2(-1.27, 0.0), vec2(0.33, 0.30), 0.08));
    }
    return d;
}
// pele de fora: as mesmas janelas; embaixo do para-brisa a lateral fica fechada
bool skinCut(vec3 p) { return shellOpen(p) < 0.0 && !(abs(p.y) > 0.5 && p.z < 0.10 + max(p.x - 1.13, 0.0) * 0.95 && p.x > xpil(p.z) - 0.1); }
// para-brisa: recortado na secao arredondada da cabine
bool wshieldCut(vec3 p) { float w = 0.565 - 0.14, zc = 0.80 - 0.14; return p.z > zc && abs(p.y) > w && length(vec2(abs(p.y) - w, p.z - zc)) > 0.14; }`;

// cores da cabine por dentro e pintura de fora (usa aaLine do shader principal)
const PAINT_GLSL = `
vec3 shellColor(vec3 p, vec3 n) {
    float roof = p.x > -0.85 ? 0.80 : 0.80 - (-0.85 - p.x) * 0.282;
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
// pintura: branco com faixa vinho e filete dourado que sobem para a cauda; topo da deriva vinho
vec3 livery(vec3 p, vec3 base) {
    float zc = -0.13 + max(0.0, -1.2 - p.x) * 0.11;
    float d = p.z - zc, aa = max(fwidth(p.z), 1e-4);
    float band = 1.0 - smoothstep(0.055, 0.055 + aa, abs(d));
    float gold = 1.0 - smoothstep(0.0065, 0.0065 + aa, abs(d - 0.078));
    if (p.x < -4.05 && p.z > 0.47) {   // deriva e leme
        float f = p.z + (p.x + 4.9) * 0.18;
        band = smoothstep(1.62, 1.62 + aa, f);
        gold = 1.0 - smoothstep(0.008, 0.008 + aa, abs(f - 1.575));
    }
    return mix(mix(base, vec3(0.56, 0.15, 0.13), band), vec3(0.79, 0.64, 0.29), gold);
}
`;


// distancia ate as paredes do casco, por dentro (positiva dentro): base da oclusao ambiente
function shellInner(p) {
  const x = p[0], y = p[1], z = p[2];
  let fx = PX - x;
  if (z < -0.16) fx = PX + (-0.16 - z) / 0.24 * 0.26 - x;
  return Math.min(z - floorZ(x), roofZ(x) - z, halfW(x) - Math.abs(y), x - X_AFT, fx);
}

// luzes no referencial do aviao (x frente, y direita, z cima): posicao, raio do brilho, cor, nivel minimo
const LIGHTS = [
  { p: [0.10, -5.69, 0.90], r: 0.9, c: [1.0, 0.12, 0.08], bit: 1, tol: 1.05 },                 // navegacao esquerda
  { p: [0.10, 5.69, 0.90], r: 0.9, c: [0.15, 1.0, 0.30], bit: 1, tol: 1.05 },                  // direita
  { p: [-5.56, 0, 0.50], r: 0.7, c: [1.0, 0.98, 0.92], bit: 1 },                    // cauda
  { p: [-5.05, 0, 2.00], r: 1.2, c: [1.0, 0.10, 0.05], bit: 1, kind: 'beacon' },     // farol rotativo
  { p: [0.00, -5.72, 0.90], tol: 1.2, r: 2.4, c: [1.0, 1.0, 1.0], bit: 2, kind: 'strobe' },    // strobes nas pontas
  { p: [0.00, 5.72, 0.90], tol: 1.2, r: 2.4, c: [1.0, 1.0, 1.0], bit: 2, kind: 'strobe' },
  { p: [3.02, 0, -0.24], r: 1.4, c: [1.0, 0.93, 0.78], bit: 4, kind: 'land' },        // farol de pouso no nariz
];

export { MIRROR, rightPersonMatrices, LIGHTS, shellInner, SHELL_GLSL, PAINT_GLSL, buildStatic, buildExterior, buildOutside, buildHead, buildGlass, buildProp, buildParts, partMatrices, handTarget };
