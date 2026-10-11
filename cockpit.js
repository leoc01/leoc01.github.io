// cockpit.js - arte do painel (Canvas 2D) para a cabine 3D (ver cabin.js).
//
// Os seis instrumentos no arranjo padrao ("six-pack"): velocimetro, horizonte e altimetro em
// cima; coordenador de curva (com a bolinha), proa e variometro embaixo; o RPM a direita,
// embaixo, como em varios 172 antigos. Estilo de jogo (claros, com mostrador digital).
// O trilho da alavanca dos flaps fica no painel; o trim e uma roda no pedestal (placa propria). A parte fixa e desenhada uma vez; os
// ponteiros sao redesenhados quando os valores mudam, em recortes pequenos enviados a GPU.
// A bussola da pala tem a sua propria regiao no atlas.

export const PANEL = { PX: 1.20, PW: 1.04, PZ0: -0.06, TOP: 0.245 };   // painel no referencial do aviao (m)
const S = 1536;                       // texels por metro no painel
const PW = PANEL.PW, PZ0 = PANEL.PZ0, TOP = PANEL.TOP;
const PH = TOP - PZ0;
const ATW = 2048, ATH = 1024;

const C = {
  cream: '#e7dec8', creamSh: '#cec4ac', creamHi: '#f2ebda', leather: '#1a191b', leatherHi: '#403e42',
  red: '#b22c24', seat: '#8c2a26', redSh: '#801e1c', black: '#161619', blackHi: '#46464e', face: '#121318',
  mark: '#f4f1e8', out: '#141214', green: '#4fcf55', yellow: '#ffd23c', redArc: '#ff5a3c',
  orange: '#ff9a1e', sky: '#4f9fe8', ground: '#a0683a', amber: '#ffb33c', chrome: '#ced0d4',
  chromeSh: '#787a82', ink: '#3c332e', lcd: '#2a2d34',
};
const FONT = (px) => `bold ${Math.round(px)}px "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif`;
const P = (y, z) => [(y + PW / 2) * S, (TOP - z) * S];
const M = (m) => m * S;
const rad = (d) => d * Math.PI / 180;

// ---------- primitivas ----------
function circle(c, x, y, r, fill, stroke, lw) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
function rrect(c, x0, y0, x1, y1, r, fill, stroke, lw) {
  c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, r);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
const angPt = (x, y, R, deg) => [x + R * Math.sin(rad(deg)), y - R * Math.cos(rad(deg))];
function line(c, a, b, col, w, cap = 'round') { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.strokeStyle = col; c.lineWidth = w; c.lineCap = cap; c.stroke(); }
function text(c, x, y, s, px, col, align = 'center') { c.font = FONT(px); c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); }
// ponteiro grosso, branco, com ponta laranja
function needle(c, x, y, R, deg, len = 0.86, w = 0.085) {
  const tip = angPt(x, y, R * len, deg), mid = angPt(x, y, R * (len - 0.22), deg), tail = angPt(x, y, R * 0.16, deg + 180);
  line(c, tail, tip, '#000', R * w + 3);
  line(c, tail, mid, C.mark, R * w);
  line(c, mid, tip, C.orange, R * w);
  circle(c, x, y, R * 0.11, '#2a2a30', C.mark, R * 0.03);
}
function ticks(c, x, y, R, a0, a1, n, major, L = 0.16) {
  for (let i = 0; i <= n; i++) {
    const d = a0 + (a1 - a0) * i / n, big = i % major === 0;
    line(c, angPt(x, y, R * 0.96, d), angPt(x, y, R * (0.96 - (big ? L : L * 0.5)), d), C.mark, R * (big ? 0.055 : 0.03), 'butt');
  }
}
function band(c, x, y, R, a0, a1, col, w) { c.beginPath(); c.arc(x, y, R, rad(a0 - 90), rad(a1 - 90)); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt'; c.stroke(); }
const label = (c, x, y, R, deg, s, px, rr = 0.62, col = C.mark) => { const p = angPt(x, y, R * rr, deg); text(c, p[0], p[1], s, px, col); };
// mostrador digital dentro do instrumento
function readout(c, x, y, R, s, dy = 0.5, w = 0.78) {
  rrect(c, x - R * w / 2, y + R * dy - R * 0.19, x + R * w / 2, y + R * dy + R * 0.19, R * 0.06, C.lcd, '#000', R * 0.025);
  text(c, x, y + R * dy + R * 0.01, s, R * 0.3, C.mark);
}

// aro preto fino sobre o creme
function gaugeBase(c, cy, cz, r) {
  const [x, y] = P(cy, cz), R = M(r);
  circle(c, x, y, R * 1.2, C.creamSh);
  circle(c, x, y, R * 1.13, C.black, C.out, R * 0.04);
  c.beginPath(); c.arc(x, y, R * 1.08, rad(200 - 90), rad(340 - 90)); c.strokeStyle = C.blackHi; c.lineWidth = R * 0.05; c.stroke();
  circle(c, x, y, R, C.face);
  return [x, y, R];
}

// ---------- instrumentos ----------
const r6 = 0.037, z1 = 0.19, z2 = 0.102, xs = [-0.37, -0.27, -0.17], RPM_Y = -0.065;
const ASI = (v) => -140 + 280 * Math.min(Math.max(v, 0), 180) / 180;
const VSIA = (v) => -90 + Math.max(-2000, Math.min(2000, v)) / 2000 * 115;
const TACH = (v) => -130 + 260 * Math.min(Math.max(v, 0), 3500) / 3500;
const round = (v, k) => Math.round(v / k) * k;
const GAUGES = [
  { y: xs[0], z: z1, r: r6, face(c, x, y, R) {          // velocimetro
      band(c, x, y, R * 0.86, ASI(48), ASI(129), C.green, R * 0.12);
      band(c, x, y, R * 0.86, ASI(129), ASI(163), C.yellow, R * 0.12);
      line(c, angPt(x, y, R * 0.96, ASI(163)), angPt(x, y, R * 0.7, ASI(163)), C.redArc, R * 0.07, 'butt');
      ticks(c, x, y, R, ASI(0), ASI(180), 9, 2);
      for (const v of [40, 80, 120, 160]) label(c, x, y, R, ASI(v), String(v), R * 0.25, 0.6);
    }, hands(c, x, y, R, I) {   // abaixo de ~20 kt o velocimetro de verdade nao registra (o vento parado nao aparece)
      const kt = I.kt * Math.min(1, Math.max(0, (I.kt - 15) / 15)) ** 1.5;   // sai do batente de leve entre 15 e 30 kt
      readout(c, x, y, R, String(Math.round(kt))); text(c, x, y + R * 0.78, 'KT', R * 0.15, C.mark); needle(c, x, y, R, ASI(kt)); } },
  { y: xs[1], z: z1, r: r6, dynamicFace: true, hands(c, x, y, R, I) {   // horizonte artificial
      c.save(); c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.clip();
      c.translate(x, y); c.rotate(rad(-I.roll));
      const off = Math.max(-1.2, Math.min(1.2, I.pitch / 25)) * R;
      c.fillStyle = C.sky; c.fillRect(-R * 2, -R * 2, R * 4, R * 4);
      c.fillStyle = C.ground; c.fillRect(-R * 2, off, R * 4, R * 4);
      line(c, [-R * 2, off], [R * 2, off], C.mark, R * 0.06, 'butt');
      for (const k of [-20, -10, 10, 20]) { const yy = off - k / 25 * R, w = R * (Math.abs(k) === 20 ? 0.34 : 0.2); line(c, [-w, yy], [w, yy], C.mark, R * 0.04, 'butt'); }
      c.restore();
      for (const d of [-60, -30, 30, 60]) line(c, angPt(x, y, R * 0.98, d), angPt(x, y, R * 0.82, d), C.mark, R * 0.05, 'butt');
      const p0 = angPt(x, y, R * 0.8, -I.roll), p1 = angPt(x, y, R * 0.62, -I.roll - 9), p2 = angPt(x, y, R * 0.62, -I.roll + 9);
      c.beginPath(); c.moveTo(...p0); c.lineTo(...p1); c.lineTo(...p2); c.fillStyle = C.orange; c.fill();
      // aviaozinho grande
      c.lineJoin = 'round'; c.lineCap = 'round';
      for (const [col, w] of [['#000', R * 0.16], [C.orange, R * 0.1]]) {
        c.beginPath(); c.moveTo(x - R * 0.62, y); c.lineTo(x - R * 0.2, y); c.lineTo(x - R * 0.1, y + R * 0.12);
        c.moveTo(x + R * 0.62, y); c.lineTo(x + R * 0.2, y); c.lineTo(x + R * 0.1, y + R * 0.12);
        c.strokeStyle = col; c.lineWidth = w; c.stroke();
      }
      circle(c, x, y, R * 0.07, C.orange, '#000', R * 0.03);
    } },
  { y: xs[2], z: z1, r: r6, face(c, x, y, R) {           // altimetro
      ticks(c, x, y, R, 0, 360, 10, 1);
      for (let i = 0; i < 10; i++) label(c, x, y, R, i * 36, String(i), R * 0.24, 0.64);
    }, hands(c, x, y, R, I) {
      readout(c, x, y, R, String(Math.round(I.ft / 10) * 10), 0.36, 0.86);
      text(c, x, y + R * 0.6, 'FT', R * 0.15, C.mark);
      needle(c, x, y, R, ((I.ft % 10000) + 10000) % 10000 / 10000 * 360, 0.5, 0.12);
      needle(c, x, y, R, ((I.ft % 1000) + 1000) % 1000 / 1000 * 360, 0.86, 0.07);
    } },
  { y: xs[0], z: z2, r: r6, face(c, x, y, R) {    // coordenador de curva: aviaozinho e bolinha
      for (const d of [-90, 90]) line(c, angPt(x, y, R * 0.96, d), angPt(x, y, R * 0.76, d), C.mark, R * 0.06, 'butt');
      for (const d of [-110, 110]) line(c, angPt(x, y, R * 0.96, d), angPt(x, y, R * 0.76, d), C.mark, R * 0.06, 'butt');
      text(c, x - R * 0.72, y + R * 0.48, 'L', R * 0.2, C.mark); text(c, x + R * 0.72, y + R * 0.48, 'R', R * 0.2, C.mark);
      text(c, x, y - R * 0.55, 'TURN', R * 0.13, C.mark);
      // tubo da bolinha (curvo, embaixo)
      c.beginPath(); c.arc(x, y - R * 1.15, R * 1.62, rad(90 - 17), rad(90 + 17)); c.strokeStyle = '#000'; c.lineWidth = R * 0.24; c.lineCap = 'round'; c.stroke();
      c.beginPath(); c.arc(x, y - R * 1.15, R * 1.62, rad(90 - 16), rad(90 + 16)); c.strokeStyle = '#d8d2bd'; c.lineWidth = R * 0.17; c.stroke();
      for (const s of [-1, 1]) { const a = rad(90 + s * 4.2); line(c, [x + R * 1.62 * Math.cos(a), y - R * 1.15 + R * 1.62 * Math.sin(a) - R * 0.11], [x + R * 1.62 * Math.cos(a), y - R * 1.15 + R * 1.62 * Math.sin(a) + R * 0.11], '#000', R * 0.035, 'butt'); }
    }, hands(c, x, y, R, I) {
      // bolinha: cai para o lado para onde o aviao escorrega (beta > 0 = escorregando a direita); "pise na bola"
      const k = Math.max(-1, Math.min(1, I.slip * 57.3 / 8)), a = rad(90 - k * 13);
      circle(c, x + R * 1.62 * Math.cos(a), y - R * 1.15 + R * 1.62 * Math.sin(a), R * 0.08, '#111', '#000', R * 0.02);
      // aviaozinho: curva padrao (3 graus/s) encosta na marca L ou R
      const bank = Math.max(-28, Math.min(28, I.turn / 3 * 20));
      c.save(); c.translate(x, y); c.rotate(rad(bank)); c.lineJoin = 'round'; c.lineCap = 'round';
      for (const [col, w] of [['#000', R * 0.15], [C.mark, R * 0.09]]) {
        c.beginPath(); c.moveTo(-R * 0.78, 0); c.lineTo(R * 0.78, 0); c.moveTo(0, -R * 0.2); c.lineTo(0, R * 0.02);
        c.moveTo(-R * 0.2, -R * 0.14); c.lineTo(R * 0.2, -R * 0.14); c.strokeStyle = col; c.lineWidth = w; c.stroke();
      }
      circle(c, 0, 0, R * 0.1, C.mark, '#000', R * 0.03);
      c.restore();
    } },
  { y: xs[1], z: z2, r: r6, dynamicFace: true, hands(c, x, y, R, I) {   // proa: a rosa gira
      for (let i = 0; i < 36; i++) {
        const d = i * 10 - I.hdg, big = i % 3 === 0;
        line(c, angPt(x, y, R * 0.96, d), angPt(x, y, R * (big ? 0.78 : 0.86), d), C.mark, R * (big ? 0.05 : 0.03), 'butt');
      }
      const names = { 0: 'N', 9: 'E', 18: 'S', 27: 'W' };
      for (const k of [0, 9, 18, 27]) label(c, x, y, R, k * 10 - I.hdg, names[k], R * 0.28, 0.6, k === 0 ? C.orange : C.mark);
      line(c, [x, y - R * 0.3], [x, y + R * 0.18], C.orange, R * 0.08);
      line(c, [x - R * 0.22, y - R * 0.08], [x + R * 0.22, y - R * 0.08], C.orange, R * 0.08);
      c.beginPath(); c.moveTo(x, y - R * 0.99); c.lineTo(x - R * 0.11, y - R * 0.8); c.lineTo(x + R * 0.11, y - R * 0.8); c.fillStyle = C.orange; c.fill();
      readout(c, x, y, R, String(Math.round(((I.hdg % 360) + 360) % 360)).padStart(3, '0'), 0.46, 0.66);
    } },
  { y: xs[2], z: z2, r: r6, face(c, x, y, R) {           // variometro
      ticks(c, x, y, R, VSIA(-2000), VSIA(2000), 8, 2);
      for (const v of [-2000, -1000, 0, 1000, 2000]) label(c, x, y, R, VSIA(v), String(Math.abs(v) / 1000), R * 0.25, 0.62);
      text(c, x - R * 0.12, y - R * 0.33, 'UP', R * 0.15, C.mark); text(c, x - R * 0.12, y + R * 0.33, 'DN', R * 0.15, C.mark);
    }, hands(c, x, y, R, I) {
      const v = round(I.fpm, 50);
      rrect(c, x + R * 0.2, y - R * 0.17, x + R * 0.94, y + R * 0.17, R * 0.06, C.lcd, '#000', R * 0.025);
      text(c, x + R * 0.57, y + R * 0.01, (v > 0 ? '+' : '') + v, R * 0.24, C.mark);
      needle(c, x, y, R, VSIA(I.fpm));
    } },
  { y: RPM_Y, z: z2, r: r6, face(c, x, y, R) {    // conta-giros (a direita, embaixo)
      band(c, x, y, R * 0.86, TACH(2100), TACH(2700), C.green, R * 0.12);
      line(c, angPt(x, y, R * 0.96, TACH(2700)), angPt(x, y, R * 0.7, TACH(2700)), C.redArc, R * 0.07, 'butt');
      ticks(c, x, y, R, TACH(0), TACH(3500), 7, 1);
      for (const v of [10, 20, 30]) label(c, x, y, R, TACH(v * 100), String(v), R * 0.25, 0.6);
    }, hands(c, x, y, R, I) { readout(c, x, y, R, String(round(I.rpm, 10))); text(c, x, y + R * 0.78, 'RPM', R * 0.15, C.mark); needle(c, x, y, R, TACH(I.rpm)); } },
];

// trilho da alavanca dos flaps (a alavanca e o ponteiro sao 3D), manete e mistura
export const FLAPS = { y: 0.05, z0: 0.205, z1: 0.085 };          // posicoes 0 (em cima) a 30 (embaixo)
export const THROTTLE = { y: 0.005, z: 0.03 };                  // manete (empurrar = potencia)
export const MIXTURE = { y: 0.05, z: 0.03 };
// pala: borda de baixo reta no meio e descendo arredondada nos cantos (y, z do centro do arco, raio)
export const GLARE = { z: 0.252, yc: 0.405, r: 0.16 };   // o arco dos cantos chega ate a parede (y = 0.565)
export const glareEdgeZ = (y) => { const d = Math.abs(y) - GLARE.yc; return d <= 0 ? GLARE.z : (GLARE.z - GLARE.r) + Math.sqrt(Math.max(GLARE.r * GLARE.r - d * d, 0)); };

function drawStatic(c) {
  // painel creme com a borda de cima arredondada; faixa vermelho-escura embaixo
  c.clearRect(0, 0, M(PW), M(PH));
  let a = P(-PW / 2, TOP), b = P(PW / 2, PZ0);
  rrect(c, a[0], a[1], b[0], b[1], M(0.03), C.cream);
  a = P(-PW / 2, 0.012); c.fillStyle = C.redSh; c.fillRect(a[0], a[1], M(PW), M(0.012 - PZ0));
  // moldura funda dos instrumentos (sombra embaixo)
  a = P(-0.43, 0.243); b = P(-0.11, 0.052);
  rrect(c, a[0], a[1], b[0], b[1], M(0.02), C.creamSh);
  a = P(-0.115, 0.152); b = P(-0.015, 0.052);
  rrect(c, a[0], a[1], b[0], b[1], M(0.02), C.creamSh);
  for (const g of GAUGES) {
    const [x, y, R] = gaugeBase(c, g.y, g.z, g.r);
    if (g.face) g.face(c, x, y, R);
  }
  // trilho dos flaps
  { const p0 = P(FLAPS.y - 0.006, FLAPS.z0 + 0.01), p1 = P(FLAPS.y + 0.006, FLAPS.z1 - 0.01);
    rrect(c, p0[0], p0[1], p1[0], p1[1], M(0.005), '#2a2622', C.out, M(0.0015));
    [0, 10, 20, 30].forEach((v, k) => { const [, yy] = P(0, FLAPS.z0 - (FLAPS.z0 - FLAPS.z1) * k / 3);
      line(c, [p1[0] + M(0.006), yy], [p1[0] + M(0.014), yy], C.ink, M(0.002)); text(c, p1[0] + M(0.018), yy, String(v), M(0.012), C.ink, 'left'); });
    text(c, (p0[0] + p1[0]) / 2, p0[1] - M(0.01), 'FLAPS', M(0.0105), C.ink); }
  // furos da manete e da mistura, rotulos
  for (const [Q, t] of [[THROTTLE, 'THROTTLE'], [MIXTURE, 'MIX']]) {
    const [x, y] = P(Q.y, Q.z); circle(c, x, y, M(0.012), '#2a2622', C.out, 1.5);
    text(c, x, y - M(0.022), t, M(0.0075), '#e8e0cc');
  }
  // difusores de ar e porta-luvas
  for (const [vy, vz] of [[-0.455, 0.15], [0.30, 0.205], [0.445, 0.205]]) { const [x, y] = P(vy, vz); circle(c, x, y, M(0.022), C.blackHi, C.out, 2); circle(c, x, y, M(0.012), '#1a1a1e'); circle(c, x - M(0.005), y - M(0.005), M(0.004), '#5a5a62'); }
  a = P(0.21, 0.165); b = P(0.47, 0.05); rrect(c, a[0], a[1], b[0], b[1], M(0.012), C.creamHi, C.creamSh, M(0.003));   // porta-luvas
  a = P(0.30, 0.15); b = P(0.38, 0.14); rrect(c, a[0], a[1], b[0], b[1], M(0.004), C.chrome, C.out, 1.5);
  // interruptores na faixa de baixo (desenhados de novo com a posicao: em cima = ligado)
  SWITCHES.forEach((nm, i) => { const [x, y] = P(SW_Y0 + i * SW_DY, SW_Z); text(c, x, y - M(0.024), nm, M(0.0072), '#e8e0cc'); drawSwitch(c, x, y, false); });
  { const [x, y] = P(-0.20, -0.02); circle(c, x, y, M(0.014), C.chromeSh, C.out, 2); circle(c, x, y, M(0.006), '#222'); }
  // cantos de cima arredondados: acima da borda da pala o painel e recortado (transparente):
  // ali aparece o capuz de couro e, mais para fora, o para-brisa que desce pelos lados
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  for (let i = 0; i <= 120; i++) { const yy = -PW / 2 + PW * i / 120; const q = P(yy, glareEdgeZ(yy) - 0.004); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
  a = P(PW / 2, TOP + 0.01); c.lineTo(a[0], a[1]); a = P(-PW / 2, TOP + 0.01); c.lineTo(a[0], a[1]); c.closePath();
  c.fill();
  c.globalCompositeOperation = 'source-over';
}

// placa do pedestal (trim): 160 x 300 texels, escala com "DN" em cima e "UP" embaixo
function drawPed(c) {
  rrect(c, 2, 2, 158, 298, 18, '#2c2b2f', '#111', 3);
  text(c, 80, 26, 'TRIM', 24, '#e8e2d0');
  rrect(c, 60, 48, 100, 262, 8, '#121214', '#000', 2);
  for (let k = 0; k <= 8; k++) { const yy = 58 + k * 24.5; line(c, [104, yy], [k % 4 === 0 ? 128 : 118, yy], '#e8e2d0', 3, 'butt'); }
  text(c, 136, 60, 'DN', 18, '#e8e2d0', 'left'); text(c, 136, 254, 'UP', 18, '#e8e2d0', 'left');
  rrect(c, 108, 150, 156, 166, 4, '#3a8a3a');
  text(c, 30, 158, 'T.O.', 16, '#9fd59f');
  text(c, 80, 284, 'NOSE', 16, '#bdb6a4');
}

// interruptores de balancim: MASTER e as luzes
const SWITCHES = ['MSTR', 'BCN', 'LAND', 'TAXI', 'NAV', 'STRB'], SW_Y0 = -0.47, SW_DY = 0.035, SW_Z = -0.025;
function drawSwitch(c, x, y, on) {
  const w = M(0.009), h = M(0.016);
  rrect(c, x - w - 2, y - h - 2, x + w + 2, y + h + 2, 4, '#3a1210');
  rrect(c, x - w, y - h, x + w, y + h, 3, '#d9d4c8', C.out, 1.5);
  const t = on ? y - h : y, b = on ? y : y + h;   // metade apertada fica mais escura
  rrect(c, x - w + 2, t + 2, x + w - 2, b - 2, 2, on ? '#fbf8f0' : '#a9a397');
  rrect(c, x - w + 2, (on ? y : y - h) + 2, x + w - 2, (on ? y + h : y) - 2, 2, on ? '#bdb7aa' : '#f4f0e6');
}
const switchOn = (lv) => [true, lv >= 1, lv >= 3, lv >= 3, lv >= 1, lv >= 2];

function drawCompass(c, hdg) {   // 200 x 120: faixa de proa grande e legivel
  c.fillStyle = '#0e0f12'; c.fillRect(0, 0, 200, 120);
  c.fillStyle = '#ece8dc'; c.fillRect(8, 14, 184, 92);
  const base = Math.round(hdg / 5) * 5;
  for (let k = -40; k <= 40; k += 5) {
    const v = (((base + k) % 360) + 360) % 360, x = 100 + (k - (hdg - base)) * 2.6;
    if (x < 10 || x > 190) continue;
    line(c, [x, 14], [x, v % 10 === 0 ? 34 : 26], '#141414', 3, 'butt');
    if (v % 30 === 0) text(c, x, 70, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v] || String(v / 10), 34, '#141414');
  }
  line(c, [100, 8], [100, 112], C.orange, 4, 'butt');
}
function drawEmblem(c) {   // 300 x 100: emblema do manche
  rrect(c, 4, 4, 296, 96, 18, C.chrome, C.out, 3);
  rrect(c, 14, 14, 286, 86, 13, '#781a1a');
  c.font = 'italic bold 46px "DejaVu Serif", Georgia, serif'; c.fillStyle = C.chrome; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('Skyhawk', 150, 52);
}

// regioes do atlas (x, y, largura, altura em texels) e coordenadas de textura
export const R_PANEL = [0, 0, Math.ceil(M(PW)), Math.ceil(M(PH))];
export const R_COMP = [16, 560, 200, 120];
export const R_EMBLEM = [240, 560, 300, 100];
export const R_PED = [560, 560, 160, 300];
export const PED_SCALE = { v0: 58 / 300, v1: 254 / 300 };   // fracao da placa: DN (trim -0.4) e UP (+0.4)
export const atlasUV = (R) => [R[0] / ATW, R[1] / ATH, (R[0] + R[2]) / ATW, (R[1] + R[3]) / ATH];

export class PanelArt {
  constructor(gl) {
    this.gl = gl;
    const at = document.createElement('canvas');
    at.width = ATW; at.height = ATH;
    const c = at.getContext('2d');
    drawStatic(c);
    c.save(); c.translate(R_EMBLEM[0], R_EMBLEM[1]); drawEmblem(c); c.restore();
    c.save(); c.translate(R_PED[0], R_PED[1]); drawPed(c); c.restore();
    this.atlas = at;
    this.dyn = GAUGES.map((g) => {
      const [x, y] = P(g.y, g.z), h = Math.ceil(g.r * S * 1.22);
      const bx = Math.floor(x - h), by = Math.floor(y - h), w = 2 * h + 2;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = w;
      return { g, bx, by, cv, x: x - bx, y: y - by, R: g.r * S };
    });
    { const a = P(SW_Y0 - 0.014, SW_Z + 0.02), b = P(SW_Y0 + 5 * SW_DY + 0.014, SW_Z - 0.02);
      const bx = Math.floor(a[0]), by = Math.floor(a[1]), cv = document.createElement('canvas');
      cv.width = Math.ceil(b[0] - a[0]); cv.height = Math.ceil(b[1] - a[1]);
      this.dyn.push({ g: { hands: (c, x, y, R, I) => SWITCHES.forEach((nm, i) => { const q = P(SW_Y0 + i * SW_DY, SW_Z); drawSwitch(c, q[0] - bx, q[1] - by, switchOn(I.lights)[i]); }) }, bx, by, cv }); }
    this.comp = document.createElement('canvas'); this.comp.width = R_COMP[2]; this.comp.height = R_COMP[3];
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, at);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.last = '';
  }

  // I: valores dos instrumentos; redesenha so o que mudou
  update(I) {
    const gl = this.gl;
    const key = [I.kt, I.ft, I.hdg, I.pitch, I.roll, I.fpm / 10, I.rpm / 10, I.turn * 4, I.slip * 200, I.lights].map((v) => v.toFixed(1)).join(',');
    if (key === this.last) return;
    this.last = key;
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const d of this.dyn) {
      const c = d.cv.getContext('2d');
      c.clearRect(0, 0, d.cv.width, d.cv.height);
      c.drawImage(this.atlas, d.bx, d.by, d.cv.width, d.cv.height, 0, 0, d.cv.width, d.cv.height);
      if (d.g.hands) d.g.hands(c, d.x, d.y, d.R, I);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, d.bx, d.by, gl.RGBA, gl.UNSIGNED_BYTE, d.cv);
    }
    drawCompass(this.comp.getContext('2d'), I.hdg);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, R_COMP[0], R_COMP[1], gl.RGBA, gl.UNSIGNED_BYTE, this.comp);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}
