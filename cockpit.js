// cockpit.js - interior do 172 (estilo Skyhawk anos 70) para a camera de cabine.
//
// A arte fica num atlas de textura desenhado com Canvas 2D: o que e fixo (couro, painel creme,
// faixa vermelha, radios, escalas) e desenhado uma vez; ponteiros, mostradores digitais,
// horizonte artificial, rosa da proa, bussola, trim e flaps sao redesenhados quando mudam, em
// recortes pequenos enviados a GPU com texSubImage2D. O interior em si sao paralelogramos no
// referencial do aviao (x frente, y direita, z cima, metros): ficam presos ao aviao, nao a
// cabeca. O shader da cena usa a mesma geometria (profundidade) e uma passada propria desenha
// o interior na resolucao nativa da tela, nitido. Os manches seguem o profundor e o aileron.
//
// Instrumentos "de jogo": menos realistas e mais claros - ponteiros grossos, poucas marcas,
// numeros grandes e um mostrador digital em cada um.

const S = 1536;                       // texels por metro no painel
const PW = 1.32, PZ0 = -0.05, TOP = 0.29, PX = 1.25;
const PH = TOP - PZ0;                 // altura do painel (z)
const CREAM_TOP = 0.282, CREAM_BOT = 0.115;
const ATW = 2048, ATH = 1024;

const C = {
  cream: '#e7dec8', creamSh: '#cec4ac', creamHi: '#f2ebda', leather: '#1a191b', leatherHi: '#403e42',
  red: '#b22c24', redSh: '#801e1c', black: '#161619', blackHi: '#46464e', face: '#121318',
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
const r6 = 0.037, z1 = 0.236, z2 = 0.152, xs = [-0.345, -0.253, -0.161];
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
    }, hands(c, x, y, R, I) { readout(c, x, y, R, String(Math.max(0, Math.round(I.kt)))); text(c, x, y + R * 0.78, 'KT', R * 0.15, C.mark); needle(c, x, y, R, ASI(I.kt)); } },
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
  { y: xs[0], z: z2, r: r6, face(c, x, y, R) {           // coordenador de curva
      for (const d of [-90, 90, -110, 110]) line(c, angPt(x, y, R * 0.96, d), angPt(x, y, R * 0.76, d), C.mark, R * 0.07, 'butt');
      text(c, x - R * 0.6, y - R * 0.42, 'L', R * 0.22, C.mark); text(c, x + R * 0.6, y - R * 0.42, 'R', R * 0.22, C.mark);
      rrect(c, x - R * 0.46, y + R * 0.36, x + R * 0.46, y + R * 0.62, R * 0.13, '#3a4048', C.mark, R * 0.035);
      line(c, [x - R * 0.11, y + R * 0.36], [x - R * 0.11, y + R * 0.62], C.mark, R * 0.025);
      line(c, [x + R * 0.11, y + R * 0.36], [x + R * 0.11, y + R * 0.62], C.mark, R * 0.025);
    }, hands(c, x, y, R, I) {
      const a = rad(Math.max(-30, Math.min(30, I.turn / 3 * 20)));   // 3 graus/s = marca de 2 min
      const cs = Math.cos(a), sn = Math.sin(a), cy = y - R * 0.06;
      line(c, [x - R * 0.66 * cs, cy - R * 0.66 * sn], [x + R * 0.66 * cs, cy + R * 0.66 * sn], '#000', R * 0.17);
      line(c, [x - R * 0.64 * cs, cy - R * 0.64 * sn], [x + R * 0.64 * cs, cy + R * 0.64 * sn], C.mark, R * 0.11);
      circle(c, x, cy, R * 0.12, C.mark, '#000', R * 0.03);
      const bx = x + Math.max(-1, Math.min(1, -I.slip * 6)) * R * 0.34;
      circle(c, bx, y + R * 0.49, R * 0.11, '#0a0a0a', C.mark, R * 0.02);
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
  { y: -0.445, z: 0.194, r: 0.036, face(c, x, y, R) {    // conta-giros
      band(c, x, y, R * 0.86, TACH(2100), TACH(2700), C.green, R * 0.12);
      line(c, angPt(x, y, R * 0.96, TACH(2700)), angPt(x, y, R * 0.7, TACH(2700)), C.redArc, R * 0.07, 'butt');
      ticks(c, x, y, R, TACH(0), TACH(3500), 7, 1);
      for (const v of [10, 20, 30]) label(c, x, y, R, TACH(v * 100), String(v), R * 0.25, 0.6);
    }, hands(c, x, y, R, I) { readout(c, x, y, R, String(round(I.rpm, 10))); text(c, x, y + R * 0.78, 'RPM', R * 0.15, C.mark); needle(c, x, y, R, TACH(I.rpm)); } },
];

// trim e flaps: reguas verticais com marcador
const TRIM = { y0: -0.104, z0: 0.256, y1: -0.084, z1: 0.135 };
const FLAPS = { y0: 0.248, z0: 0.256, y1: 0.27, z1: 0.135 };

function drawStatic(c) {
  // couro de fundo, faixa vermelha embaixo, painel creme de cantos redondos
  c.fillStyle = C.leather; c.fillRect(0, 0, M(PW), M(PH));
  let a = P(-0.66, CREAM_BOT + 0.004), b = P(0.66, PZ0);
  c.fillStyle = C.red; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  a = P(-0.645, CREAM_TOP); b = P(0.645, CREAM_BOT);
  rrect(c, a[0], a[1], b[0], b[1], M(0.035), C.cream, C.out, M(0.003));
  a = P(-0.638, CREAM_TOP - 0.003); b = P(0.638, CREAM_TOP - 0.012);
  rrect(c, a[0], a[1], b[0], b[1], M(0.03), C.creamHi);
  // radios
  a = P(-0.008, 0.278); b = P(0.214, 0.118);
  rrect(c, a[0], a[1], b[0], b[1], M(0.01), '#3a3634', C.out, M(0.002));
  [['122.80', 'COM'], ['114.10', 'NAV'], ['1200', 'XPDR']].forEach(([t, sub], i) => {
    const top = 0.272 - i * 0.052;
    const p0 = P(0.004, top), p1 = P(0.202, top - 0.046), h = p1[1] - p0[1];
    rrect(c, p0[0], p0[1], p1[0], p1[1], M(0.004), '#eee7d6', C.out, M(0.0015));
    const wx0 = p0[0] + M(0.045), wx1 = p0[0] + M(0.13);
    rrect(c, wx0, p0[1] + h * 0.18, wx1, p1[1] - h * 0.18, M(0.003), '#0e0e10');
    text(c, (wx0 + wx1) / 2, (p0[1] + p1[1]) / 2 + 1, t, h * 0.5, C.amber);
    text(c, p0[0] + M(0.022), (p0[1] + p1[1]) / 2, sub, h * 0.24, '#50463c');
    for (const kx of [p1[0] - M(0.018), p1[0] - M(0.048)]) {
      const ky = (p0[1] + p1[1]) / 2;
      circle(c, kx, ky, M(0.011), C.black, C.out, 1.5);
      circle(c, kx - M(0.002), ky - M(0.003), M(0.005), C.blackHi);
    }
  });
  // instrumentos: aros e escalas fixas
  for (const g of GAUGES) {
    const [x, y, R] = gaugeBase(c, g.y, g.z, g.r);
    if (g.face) g.face(c, x, y, R);
  }
  // trim e flaps
  for (const [Q, lab] of [[TRIM, 'TRIM'], [FLAPS, 'FLAPS']]) {
    const p0 = P(Q.y0, Q.z0), p1 = P(Q.y1, Q.z1);
    rrect(c, p0[0], p0[1], p1[0], p1[1], M(0.004), C.face, C.blackHi, M(0.002));
    text(c, (p0[0] + p1[0]) / 2, p0[1] - M(0.009), lab, M(0.0105), C.ink);
  }
  { const p0 = P(TRIM.y0, TRIM.z0), p1 = P(TRIM.y1, TRIM.z1);
    text(c, p0[0] - M(0.004), p0[1] + M(0.012), 'DN', M(0.0085), C.ink, 'right');
    text(c, p0[0] - M(0.004), p1[1] - M(0.012), 'UP', M(0.0085), C.ink, 'right');
    const ym = (p0[1] + p1[1]) / 2; line(c, [p0[0] + 3, ym], [p1[0] - 3, ym], C.mark, M(0.0015)); }
  { const p0 = P(FLAPS.y0, FLAPS.z0), p1 = P(FLAPS.y1, FLAPS.z1);
    [0, 10, 20, 30].forEach((v, k) => { const yy = p0[1] + M(0.012) + (p1[1] - p0[1] - M(0.024)) * k / 3; line(c, [p1[0] + M(0.004), yy], [p1[0] + M(0.01), yy], C.ink, M(0.002)); text(c, p1[0] + M(0.012), yy, String(v), M(0.012), C.ink, 'left'); }); }
  // relogio e luzes
  { const [x, y, R] = gaugeBase(c, 0.40, 0.205, 0.03); ticks(c, x, y, R, 0, 360, 12, 3); needle(c, x, y, R, 150, 0.5, 0.1); needle(c, x, y, R, 300, 0.82, 0.06); }
  ['#d23c28', '#f0b428', '#5abe5a'].forEach((col, i) => { const [x, y] = P(0.48 + i * 0.035, 0.205); circle(c, x, y, M(0.009), C.black, C.out, 1.5); circle(c, x, y, M(0.0055), col); c.globalAlpha = 0.45; circle(c, x, y, M(0.0055), '#000'); c.globalAlpha = 1; });
  // faixa vermelha: interruptores, botoes cromados, disjuntores (quase nao aparece de frente)
  for (let i = 0; i < 8; i++) { const [x, y] = P(-0.6 + i * 0.032, 0.07); rrect(c, x - M(0.01), y - M(0.017), x + M(0.01), y + M(0.017), 3, '#eeeae2', C.out, 1.5); }
  for (let i = 0; i < 3; i++) { const [x, y] = P(0.03 + i * 0.07, 0.07); circle(c, x, y, M(0.014), C.chromeSh, C.out, 2); circle(c, x - 3, y - 2, M(0.009), C.chrome); }
  for (let i = 0; i < 10; i++) { const [x, y] = P(0.30 + i * 0.03, 0.075); circle(c, x, y, M(0.006), C.black, C.out, 1); }
  c.strokeStyle = C.out; c.lineWidth = 4; c.strokeRect(0, 0, M(PW), M(PH));
}

function drawYoke(c) {   // 600 x 280, fundo transparente
  const W = 600, H = 280;
  const shape = (o, col) => {
    rrect(c, o, 165 + o, W - o, 220 - o, 25, col);
    rrect(c, o, 15 + o, 95 - o, 220 - o, 45, col);
    rrect(c, W - 95 + o, 15 + o, W - o, 220 - o, 45, col);
    rrect(c, 190 + o, 115 + o, 410 - o, H - o, 30, col);
  };
  shape(0, C.out); shape(5, C.black);
  c.beginPath(); c.arc(47, 60, 38, rad(200 - 90), rad(330 - 90)); c.strokeStyle = C.blackHi; c.lineWidth = 5; c.stroke();
  c.beginPath(); c.arc(W - 47, 60, 38, rad(210 - 90), rad(340 - 90)); c.stroke();
  line(c, [210, 125], [390, 125], C.blackHi, 4);
  rrect(c, 225, 150, 375, 210, 12, C.chrome, C.out, 2);
  rrect(c, 233, 157, 367, 203, 9, '#781a1a');
  c.font = 'italic bold 26px "DejaVu Serif", Georgia, serif'; c.fillStyle = C.chrome; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('Skyhawk', 300, 181);
}
function drawGlare(c) {  // 600 x 60: couro em cima da pala (fina)
  for (let i = 0; i < 60; i++) {
    const g = 1 - i / 60, k = Math.max(0, 1 - Math.abs(g - 0.75) / 0.2);
    c.fillStyle = `rgb(${26 + 30 * k},${25 + 29 * k},${27 + 31 * k})`; c.fillRect(0, i, 600, 1);
  }
}
function drawRoll(c) {   // 600 x 40 (frente arredondada da pala)
  for (let i = 0; i < 40; i++) {
    const b = Math.sin(Math.PI * (1 - i / 40) * 0.9) * 0.9;
    c.fillStyle = `rgb(${26 + 38 * b},${25 + 37 * b},${27 + 39 * b})`; c.fillRect(0, i, 600, 1);
  }
}
function drawDoor(c) {   // 400 x 150: creme em cima, vermelho embaixo, friso cromado
  c.fillStyle = C.red; c.fillRect(0, 0, 400, 150);
  c.fillStyle = C.cream; c.fillRect(0, 0, 400, 55);
  c.fillStyle = C.creamHi; c.fillRect(0, 0, 400, 8);
  c.fillStyle = C.chrome; c.fillRect(0, 52, 400, 7);
  rrect(c, 220, 75, 288, 88, 5, C.chrome, C.out, 1.5);
  c.strokeStyle = C.redSh; c.lineWidth = 1.5; for (let x = 0; x < 400; x += 30) { c.beginPath(); c.moveTo(x, 65); c.lineTo(x, 150); c.stroke(); }
}
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

// ---------- regioes do atlas (x, y, largura, altura em texels) ----------
const R_PANEL = [0, 0, Math.ceil(M(PW)), Math.ceil(M(PH))];
const R_YOKE = [16, 560, 600, 280];
const R_GLARE = [640, 560, 600, 60];
const R_ROLL = [640, 640, 600, 40];
const R_DOOR = [1260, 560, 400, 150];
const R_COMP = [1700, 560, 200, 120];

export class Cockpit {
  constructor(gl) {
    this.gl = gl;
    const at = document.createElement('canvas');
    at.width = ATW; at.height = ATH;
    const c = at.getContext('2d');
    drawStatic(c);
    const sub = (R, fn) => { c.save(); c.translate(R[0], R[1]); c.beginPath(); c.rect(0, 0, R[2], R[3]); c.clip(); fn(c); c.restore(); };
    sub(R_YOKE, drawYoke); sub(R_GLARE, drawGlare); sub(R_ROLL, drawRoll); sub(R_DOOR, drawDoor);
    this.atlas = at;
    // recortes dinamicos: um canvas pequeno por instrumento, com o fundo fixo copiado do atlas
    this.dyn = GAUGES.map((g) => {
      const [x, y] = P(g.y, g.z), h = Math.ceil(g.r * S * 1.22);
      const bx = Math.floor(x - h), by = Math.floor(y - h), w = 2 * h + 2;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = w;
      return { g, bx, by, cv, x: x - bx, y: y - by, R: g.r * S };
    });
    for (const Q of [TRIM, FLAPS]) {
      const p0 = P(Q.y0, Q.z0), p1 = P(Q.y1, Q.z1);
      const bx = Math.floor(p0[0] - 4), by = Math.floor(p0[1] - 2), w = Math.ceil(p1[0] - p0[0] + 8), h = Math.ceil(p1[1] - p0[1] + 4);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      this.dyn.push({ bar: Q, bx, by, cv, p0, p1 });
    }
    this.comp = document.createElement('canvas'); this.comp.width = R_COMP[2]; this.comp.height = R_COMP[3];
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE15);          // unidade so para envio: nao mexe nas da cena
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, at);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.quads = new Float32Array(24 * 16);
    this.n = 0;
    this.last = '';
  }

  // I: valores dos instrumentos; redesenha so o que mudou
  update(I) {
    const gl = this.gl;
    const key = [I.kt, I.ft, I.hdg, I.pitch, I.roll, I.fpm / 10, I.rpm / 10, I.flaps, I.trim * 100, I.turn, I.slip * 100].map((v) => v.toFixed(1)).join(',');
    if (key === this.last) return;
    this.last = key;
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const d of this.dyn) {
      const c = d.cv.getContext('2d');
      c.clearRect(0, 0, d.cv.width, d.cv.height);
      c.drawImage(this.atlas, d.bx, d.by, d.cv.width, d.cv.height, 0, 0, d.cv.width, d.cv.height);
      if (d.g) d.g.hands(c, d.x, d.y, d.R, I);
      else {
        const Q = d.bar, x0 = d.p0[0] - d.bx, y0 = d.p0[1] - d.by, x1 = d.p1[0] - d.bx, y1 = d.p1[1] - d.by;
        const w = x1 - x0;
        if (Q === TRIM) {
          const ty = y0 + (y1 - y0) * (0.5 - I.trim / 0.8);
          c.fillStyle = C.amber; c.fillRect(x0 + w * 0.15, ty - w * 0.22, w * 0.7, w * 0.44);
        } else {
          const fy = y0 + M(0.012) + (y1 - y0 - M(0.024)) * Math.max(0, Math.min(1, I.flaps / 30));
          c.fillStyle = C.amber; c.fillRect(x0 + w * 0.15, fy - w * 0.22, w * 0.7, w * 0.44);
        }
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, d.bx, d.by, gl.RGBA, gl.UNSIGNED_BYTE, d.cv);
    }
    drawCompass(this.comp.getContext('2d'), I.hdg);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, R_COMP[0], R_COMP[1], gl.RGBA, gl.UNSIGNED_BYTE, this.comp);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // paralelogramos do interior (com os manches na posicao dos comandos)
  build(elev, ail) {
    const q = this.quads;
    let n = 0;
    const uv = (R) => [R[0] / ATW, R[1] / ATH, R[2] / ATW, R[3] / ATH];
    // mode: 0 cor chapada, 1 textura, 2 textura com recorte. dens: texels por metro ao longo de U
    const add = (O, U, V, mode, a, dens = 0) => {
      q.set([O[0], O[1], O[2], mode, U[0], U[1], U[2], dens, V[0], V[1], V[2], 0, a[0], a[1], a[2], a[3] || 0], n * 16);
      n++;
    };
    const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 0];
    // manches: andam com o profundor (puxar = vem para tras) e giram com o aileron
    const yoke = (yc) => {
      const W = 0.40, H = 0.187, zb = 0.03, x = 1.0 - 0.06 * elev;
      const hubZ = zb + H * (1 - 200 / 280), th = -ail * 0.7;
      const rot = (y, z) => [y * Math.cos(th) - z * Math.sin(th), y * Math.sin(th) + z * Math.cos(th)];
      const o = rot(-W / 2, zb - hubZ), u = rot(W, 0), v = rot(0, H);
      add([x, yc + o[0], hubZ + o[1]], [0, u[0], u[1]], [0, v[0], v[1]], 2, uv(R_YOKE), R_YOKE[2] / W);
    };
    yoke(-0.25); yoke(0.35);
    add([PX, -0.66, PZ0], [0, PW, 0], [0, 0, PH], 1, uv(R_PANEL), S);
    add([PX, -0.70, -0.45], [0, 1.40, 0], [0, 0, 0.40], 0, hex(C.redSh));
    add([PX - 0.015, -0.68, TOP - 0.006], [0, 1.36, 0], [0.015, 0, 0.016], 1, uv(R_ROLL), R_ROLL[2] / 1.36);
    add([PX, -0.68, TOP + 0.01], [0, 1.36, 0], [0.05, 0, 0.008], 1, uv(R_GLARE), R_GLARE[2] / 1.36);
    add([PX + 0.015, -0.035, TOP + 0.018], [0, 0.07, 0], [0, 0, 0.042], 1, uv(R_COMP), R_COMP[2] / 0.07);
    add([PX + 0.06, -0.71, TOP + 0.018], [0, 0.06, 0], [-0.45, 0, 0.7], 0, hex(C.leather));
    add([PX + 0.06, 0.65, TOP + 0.018], [0, 0.06, 0], [-0.45, 0, 0.7], 0, hex(C.leather));
    add([0.92, -0.72, 1.0], [0, 1.44, 0], [0.02, 0, 0.06], 0, hex(C.leather));
    add([0.93, -0.72, 1.05], [0, 1.44, 0], [-1.6, 0, 0], 0, hex('#d6cebc'));
    add([-0.7, -0.70, -0.4], [2.2, 0, 0], [0, 0, 0.66], 1, uv(R_DOOR), R_DOOR[2] / 2.2);
    add([1.5, 0.70, -0.4], [-2.2, 0, 0], [0, 0, 0.66], 1, uv(R_DOOR), R_DOOR[2] / 2.2);
    add([-0.62, -0.70, 0.26], [0.09, 0, 0], [0, 0, 0.79], 0, hex(C.creamSh));
    add([-0.62, 0.70, 0.26], [0.09, 0, 0], [0, 0, 0.79], 0, hex(C.creamSh));
    add([-0.62, -0.70, 0.23], [2.0, 0, 0], [0, 0.04, 0.03], 0, hex(C.leather));
    add([-0.62, 0.66, 0.26], [2.0, 0, 0], [0, 0.04, -0.03], 0, hex(C.leather));
    add([-0.75, -0.72, -0.4], [0, 1.44, 0], [0, 0, 1.45], 0, hex('#b3a890'));          // parede de tras (forro)
    add([-0.75, -0.72, -0.4], [2.0, 0, 0], [0, 1.44, 0], 0, hex('#3a2a28'));            // piso
    this.n = n;
    return q;
  }
}
