// cockpit.js - interior do 172 (estilo Skyhawk anos 70) para a camera de cabine.
//
// A arte fica num atlas de textura desenhado com Canvas 2D: o que e fixo (couro, painel creme,
// faixa vermelha, radios, escalas) e desenhado uma vez; ponteiros, horizonte artificial,
// rosa da proa, bussola, trim e flaps sao redesenhados a cada quadro em recortes pequenos
// enviados a GPU com texSubImage2D. O interior em si sao paralelogramos no referencial do
// aviao (x frente, y direita, z cima, metros) tracados no shader da cena: fica preso ao
// aviao, nao a cabeca. Os manches andam com o profundor e giram com o aileron.

const S = 1024;                       // texels por metro no painel
const PW = 1.32, PH = 0.405, PZ0 = -0.05, PX = 1.25;
const TOP = PZ0 + PH;                 // borda de cima do painel (z)
const ATW = 2048, ATH = 1024;

const C = {
  cream: '#e7dec8', creamSh: '#cec4ac', creamHi: '#f2ebda', leather: '#1a191b', leatherHi: '#403e42',
  red: '#b22c24', redSh: '#801e1c', black: '#161619', blackHi: '#46464e', face: '#181a20',
  mark: '#ece8de', out: '#141214', green: '#5cbe5c', yellow: '#f2c84b', redArc: '#e0533d',
  orange: '#ff9628', sky: '#56a0e2', ground: '#96643c', amber: '#ffb046', chrome: '#ced0d4',
  chromeSh: '#787a82', ink: '#463c37',
};
const FONT = (px) => `bold ${px}px "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif`;
const P = (y, z) => [(y + PW / 2) * S, (TOP - z) * S];
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
function line(c, a, b, col, w) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.stroke(); }
function text(c, x, y, s, px, col, align = 'center') { c.font = FONT(px); c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); }
function needle(c, x, y, R, deg, w = 5, col = C.mark) {
  line(c, angPt(x, y, R * 0.18, deg + 180), angPt(x, y, R, deg), col, w);
  circle(c, x, y, w * 1.1, '#28282e', col, 1.5);
}
function ticks(c, x, y, R, a0, a1, n, major, L = 0.14, w = 2.6) {
  for (let i = 0; i <= n; i++) {
    const d = a0 + (a1 - a0) * i / n, big = i % major === 0;
    line(c, angPt(x, y, R * 0.97, d), angPt(x, y, R * (0.97 - (big ? L : L * 0.55)), d), C.mark, big ? w : w * 0.55);
  }
}
function band(c, x, y, R, a0, a1, col, w) { c.beginPath(); c.arc(x, y, R, rad(a0 - 90), rad(a1 - 90)); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt'; c.stroke(); }
const label = (c, x, y, R, deg, s, px, rr = 0.64, col = C.mark) => { const p = angPt(x, y, R * rr, deg); text(c, p[0], p[1], s, px, col); };

// aro preto sobre o creme (como no Skyhawk)
function gaugeBase(c, cy, cz, r) {
  const [x, y] = P(cy, cz), R = r * S;
  circle(c, x, y, R * 1.24, C.creamSh);
  circle(c, x, y, R * 1.18, C.black, C.out, 2.5);
  c.beginPath(); c.arc(x, y, R * 1.12, rad(200 - 90), rad(340 - 90)); c.strokeStyle = C.blackHi; c.lineWidth = 3; c.stroke();
  circle(c, x, y, R, C.face);
  return [x, y, R];
}

// ---------- instrumentos: parte fixa (escalas) e parte movel (ponteiros) ----------
const r6 = 0.040, z1 = 0.279, z2 = 0.177, xs = [-0.345, -0.245, -0.145];
const ASI = (v) => -150 + 300 * Math.min(Math.max(v, 0), 200) / 200;
const VSIA = (v) => -90 + Math.max(-2000, Math.min(2000, v)) / 2000 * 170;
const TACH = (v) => -135 + 270 * Math.min(Math.max(v, 0), 3500) / 3500;

const GAUGES = [
  { y: xs[0], z: z1, r: r6, face(c, x, y, R) {
      band(c, x, y, R * 0.9, ASI(40), ASI(85), '#e6e6e6', 8);
      band(c, x, y, R * 0.84, ASI(48), ASI(129), C.green, 8);
      band(c, x, y, R * 0.84, ASI(129), ASI(163), C.yellow, 8);
      line(c, angPt(x, y, R * 0.95, ASI(163)), angPt(x, y, R * 0.72, ASI(163)), C.redArc, 4.5);
      ticks(c, x, y, R, ASI(40), ASI(200), 32, 4);
      for (const v of [40, 80, 120, 160]) label(c, x, y, R, ASI(v), String(v), 13, 0.6);
      text(c, x, y + R * 0.32, 'KNOTS', 8, C.mark);
    }, hands(c, x, y, R, I) { needle(c, x, y, R * 0.86, ASI(I.kt)); } },
  { y: xs[1], z: z1, r: r6, dynamicFace: true, hands(c, x, y, R, I) {   // horizonte artificial
      c.save(); c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.clip();
      c.translate(x, y); c.rotate(rad(-I.roll));
      const off = I.pitch / 30 * R * 0.9;
      c.fillStyle = C.sky; c.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 3);
      c.fillStyle = C.ground; c.fillRect(-R * 1.5, off, R * 3, R * 3);
      line(c, [-R * 1.5, off], [R * 1.5, off], C.mark, 3);
      for (const k of [-20, -10, 10, 20]) { const yy = off - k / 30 * R * 0.9, w = R * (Math.abs(k) === 20 ? 0.32 : 0.2); line(c, [-w, yy], [w, yy], C.mark, 2); }
      c.restore();
      for (const d of [-60, -30, -20, -10, 10, 20, 30, 60]) line(c, angPt(x, y, R * 0.98, d), angPt(x, y, R * 0.84, d), C.mark, 2.5);
      const p0 = angPt(x, y, R * 0.83, -I.roll), p1 = angPt(x, y, R * 0.7, -I.roll - 6), p2 = angPt(x, y, R * 0.7, -I.roll + 6);
      c.beginPath(); c.moveTo(...p0); c.lineTo(...p1); c.lineTo(...p2); c.fillStyle = C.orange; c.fill();
      c.beginPath(); c.moveTo(x, y - R * 0.97); c.lineTo(x - 6, y - R * 0.85); c.lineTo(x + 6, y - R * 0.85); c.fillStyle = C.mark; c.fill();
      c.lineJoin = 'round';
      c.beginPath(); c.moveTo(x - R * 0.55, y); c.lineTo(x - R * 0.18, y); c.lineTo(x - R * 0.08, y + R * 0.1); c.strokeStyle = C.orange; c.lineWidth = 6; c.stroke();
      c.beginPath(); c.moveTo(x + R * 0.55, y); c.lineTo(x + R * 0.18, y); c.lineTo(x + R * 0.08, y + R * 0.1); c.stroke();
      circle(c, x, y, 4, C.orange);
    } },
  { y: xs[2], z: z1, r: r6, face(c, x, y, R) {
      ticks(c, x, y, R, 0, 360, 50, 5);
      for (let i = 0; i < 10; i++) label(c, x, y, R, i * 36, String(i), 15, 0.66);
      text(c, x, y + R * 0.33, 'ALT', 8, C.mark);
    }, hands(c, x, y, R, I) {
      needle(c, x, y, R * 0.55, ((I.ft % 10000) + 10000) % 10000 / 10000 * 360, 8);
      needle(c, x, y, R * 0.88, ((I.ft % 1000) + 1000) % 1000 / 1000 * 360, 4.5);
    } },
  { y: xs[0], z: z2, r: r6, face(c, x, y, R) {
      for (const d of [-90, 90, -110, 110]) line(c, angPt(x, y, R * 0.95, d), angPt(x, y, R * 0.78, d), C.mark, 3.5);
      text(c, x - R * 0.62, y - R * 0.42, 'L', 11, C.mark); text(c, x + R * 0.62, y - R * 0.42, 'R', 11, C.mark);
      rrect(c, x - R * 0.42, y + R * 0.38, x + R * 0.42, y + R * 0.58, 8, '#3c4046', C.mark, 1.5);
      text(c, x, y + R * 0.78, '2 MIN', 7, C.mark);
    }, hands(c, x, y, R, I) {
      const a = rad(Math.max(-30, Math.min(30, I.turn / 3 * 20)));   // 3 graus/s = marca de 2 min
      const cs = Math.cos(a), sn = Math.sin(a), cy = y - R * 0.08;
      line(c, [x - R * 0.62 * cs, cy - R * 0.62 * sn], [x + R * 0.62 * cs, cy + R * 0.62 * sn], C.mark, 6);
      circle(c, x, cy, 8, C.mark);
      const bx = x + Math.max(-1, Math.min(1, -I.slip * 6)) * R * 0.32;
      circle(c, bx, y + R * 0.48, 6.5, '#141414');
    } },
  { y: xs[1], z: z2, r: r6, dynamicFace: true, hands(c, x, y, R, I) {   // indicador de proa (rosa gira)
      for (let i = 0; i < 72; i++) {
        const d = i * 5 - I.hdg, big = i % 2 === 0;
        line(c, angPt(x, y, R * 0.97, d), angPt(x, y, R * (big ? 0.86 : 0.91), d), C.mark, big ? 2.5 : 1.5);
      }
      const names = { 0: 'N', 9: 'E', 18: 'S', 27: 'W' };
      for (let k = 0; k < 36; k += 3) label(c, x, y, R, k * 10 - I.hdg, names[k] || String(k), names[k] !== undefined ? 14 : 10, 0.68, k === 0 ? C.orange : C.mark);
      line(c, [x, y - R * 0.45], [x, y + R * 0.4], C.orange, 5);
      line(c, [x - R * 0.3, y - R * 0.05], [x + R * 0.3, y - R * 0.05], C.orange, 5);
      line(c, [x - R * 0.13, y + R * 0.35], [x + R * 0.13, y + R * 0.35], C.orange, 4);
      c.beginPath(); c.moveTo(x, y - R * 0.98); c.lineTo(x - 7, y - R * 0.84); c.lineTo(x + 7, y - R * 0.84); c.fillStyle = C.orange; c.fill();
    } },
  { y: xs[2], z: z2, r: r6, face(c, x, y, R) {
      ticks(c, x, y, R, VSIA(-2000), VSIA(2000), 40, 5);
      for (const v of [-2000, -1000, 0, 1000, 2000]) label(c, x, y, R, VSIA(v), String(Math.abs(v) / 100), 13, 0.64);
      text(c, x + R * 0.1, y - R * 0.38, 'UP', 8, C.mark); text(c, x + R * 0.1, y + R * 0.38, 'DOWN', 8, C.mark);
    }, hands(c, x, y, R, I) { needle(c, x, y, R * 0.86, VSIA(I.fpm)); } },
  { y: -0.47, z: 0.228, r: 0.040, face(c, x, y, R) {
      band(c, x, y, R * 0.86, TACH(2100), TACH(2700), C.green, 7);
      line(c, angPt(x, y, R * 0.95, TACH(2700)), angPt(x, y, R * 0.72, TACH(2700)), C.redArc, 4.5);
      ticks(c, x, y, R, TACH(0), TACH(3500), 35, 5);
      for (let v = 0; v <= 35; v += 5) label(c, x, y, R, TACH(v * 100), String(v), 10, 0.63);
      text(c, x, y + R * 0.42, 'RPM', 8, C.mark);
    }, hands(c, x, y, R, I) { needle(c, x, y, R * 0.86, TACH(I.rpm)); } },
];

// trim e flaps: reguas verticais com marcador
const TRIM = { y0: -0.074, z0: 0.31, y1: -0.044, z1: 0.145 };
const FLAPS = { y0: 0.27, z0: 0.31, y1: 0.295, z1: 0.16 };

function drawStatic(c) {
  // couro de fundo, faixa vermelha, painel creme de cantos redondos
  c.fillStyle = C.leather; c.fillRect(0, 0, PW * S, PH * S);
  const [ra, rb] = [P(-0.66, 0.128), P(0.66, PZ0)];
  c.fillStyle = C.red; c.fillRect(ra[0], ra[1], rb[0] - ra[0], rb[1] - ra[1]);
  const rs = P(-0.66, 0.122); c.fillStyle = C.redSh; c.fillRect(rs[0], ra[1], rb[0] - ra[0], rs[1] - ra[1]);
  let a = P(-0.645, 0.338), b = P(0.645, 0.126);
  rrect(c, a[0], a[1], b[0], b[1], 0.06 * S, C.cream, C.out, 3);
  a = P(-0.638, 0.334); b = P(0.638, 0.322);
  rrect(c, a[0], a[1], b[0], b[1], 0.05 * S, C.creamHi);
  // moldura dos radios
  a = P(-0.008, 0.335); b = P(0.214, 0.126);
  rrect(c, a[0], a[1], b[0], b[1], 0.012 * S, '#3a3634', C.out, 2.5);
  const radios = [['122.80', 'COM'], ['114.10', 'NAV'], ['1200', 'XPDR']];
  radios.forEach(([t, sub], i) => {
    const top = 0.325 - i * 0.065;
    const p0 = P(0.004, top), p1 = P(0.202, top - 0.056);
    rrect(c, p0[0], p0[1], p1[0], p1[1], 4, '#eee7d6', C.out, 2);
    const wx0 = p0[0] + 46, wx1 = p0[0] + 128;
    rrect(c, wx0, p0[1] + 11, wx1, p1[1] - 11, 3, '#0e0e10');
    text(c, (wx0 + wx1) / 2, (p0[1] + p1[1]) / 2 + 1, t, 15, C.amber);
    text(c, p0[0] + 23, (p0[1] + p1[1]) / 2, sub, 7, '#50463c');
    for (const kx of [p1[0] - 20, p1[0] - 51]) {
      const ky = (p0[1] + p1[1]) / 2;
      circle(c, kx, ky, 12, C.black, C.out, 1.5);
      circle(c, kx - 2, ky - 3, 6, C.blackHi);
    }
  });
  // instrumentos: aros e escalas fixas
  for (const g of GAUGES) {
    const [x, y, R] = gaugeBase(c, g.y, g.z, g.r);
    if (g.face) g.face(c, x, y, R);
  }
  // trim
  for (const [Q, lab] of [[TRIM, 'TRIM'], [FLAPS, 'FLAPS']]) {
    const p0 = P(Q.y0, Q.z0), p1 = P(Q.y1, Q.z1);
    rrect(c, p0[0], p0[1], p1[0], p1[1], 3, C.face, C.blackHi, 2.5);
    text(c, (p0[0] + p1[0]) / 2, p1[1] + 12, lab, 8, C.ink);
  }
  { const p0 = P(TRIM.y0, TRIM.z0), p1 = P(TRIM.y1, TRIM.z1);
    for (let k = 0; k < 9; k++) { const yy = p0[1] + 7 + (p1[1] - p0[1] - 14) * k / 8; line(c, [p0[0] + 4, yy], [p0[0] + (k % 4 === 0 ? 13 : 8), yy], C.mark, 1.5); } }
  { const p0 = P(FLAPS.y0, FLAPS.z0), p1 = P(FLAPS.y1, FLAPS.z1);
    [0, 10, 20, 30].forEach((v, k) => { const yy = p0[1] + 10 + (p1[1] - p0[1] - 20) * k / 3; line(c, [p1[0] + 7, yy], [p1[0] + 15, yy], C.ink, 2); text(c, p1[0] + 19, yy, String(v), 10, C.ink, 'left'); }); }
  // relogio e luzes
  { const [x, y, R] = gaugeBase(c, 0.44, 0.27, 0.034); ticks(c, x, y, R, 0, 360, 12, 3, 0.18); needle(c, x, y, R * 0.55, 150, 4); needle(c, x, y, R * 0.85, 300, 2.5); }
  ['#d23c28', '#f0b428', '#5abe5a'].forEach((col, i) => { const [x, y] = P(0.38 + i * 0.04, 0.17); circle(c, x, y, 9, C.black, C.out, 1.5); circle(c, x, y, 5.5, col); c.globalAlpha = 0.45; circle(c, x, y, 5.5, '#000'); c.globalAlpha = 1; });
  // faixa vermelha: interruptores, botoes cromados, disjuntores
  for (let i = 0; i < 8; i++) { const [x, y] = P(-0.6 + i * 0.032, 0.085); rrect(c, x - 10, y - 17, x + 10, y + 17, 3, '#eeeae2', C.out, 1.5); c.fillStyle = '#cdc8be'; c.fillRect(x - 8, y - 15, 16, 14); }
  for (let i = 0; i < 3; i++) { const [x, y] = P(0.03 + i * 0.07, 0.08); circle(c, x, y, 15, C.chromeSh, C.out, 2); circle(c, x - 3, y - 2, 10, C.chrome); }
  for (let i = 0; i < 10; i++) { const [x, y] = P(0.30 + i * 0.03, 0.09); circle(c, x, y, 6, C.black, C.out, 1); circle(c, x - 1.5, y - 2, 2.5, C.blackHi); }
  c.strokeStyle = C.out; c.lineWidth = 4; c.strokeRect(0, 0, PW * S, PH * S);
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
function drawGlare(c) {  // 600 x 150 (couro em cima da pala; embaixo da textura = borda da frente)
  for (let i = 0; i < 150; i++) {
    const g = 1 - i / 150, k = Math.max(0, 1 - Math.abs(g - 0.82) / 0.12);
    c.fillStyle = `rgb(${26 + 38 * k},${25 + 37 * k},${27 + 39 * k})`; c.fillRect(0, i, 600, 1);
  }
  c.strokeStyle = '#3c3a3e'; c.lineWidth = 1.5;
  for (let x = 4; x < 600; x += 11) { c.beginPath(); c.moveTo(x, 115); c.lineTo(x + 5, 115); c.stroke(); }
}
function drawRoll(c) {   // 600 x 60 (frente arredondada da pala)
  for (let i = 0; i < 60; i++) {
    const b = Math.sin(Math.PI * (1 - i / 60) * 0.9) * 0.9;
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
function drawCompass(c, hdg) {   // 160 x 120
  c.fillStyle = '#0e0f12'; c.fillRect(0, 0, 160, 120);
  c.fillStyle = '#e8e4d8'; c.fillRect(12, 22, 136, 76);
  for (let k = -30; k <= 30; k += 5) {
    const v = (((Math.round(hdg / 5) * 5 + k) % 360) + 360) % 360, x = 80 + (k - (hdg - Math.round(hdg / 5) * 5)) * 2.2;
    line(c, [x, 22], [x, v % 10 === 0 ? 36 : 30], '#141414', 2);
    if (v % 30 === 0) text(c, x, 62, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v] || String(v / 10), 22, '#141414');
  }
  line(c, [80, 18], [80, 102], C.orange, 3);
}

// ---------- regioes do atlas (x, y, largura, altura em texels) ----------
const R_PANEL = [0, 0, Math.ceil(PW * S), Math.ceil(PH * S)];
const R_YOKE = [16, 460, 600, 280];
const R_GLARE = [640, 460, 600, 150];
const R_ROLL = [640, 630, 600, 60];
const R_DOOR = [1260, 460, 400, 150];
const R_COMP = [1400, 16, 160, 120];

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
      const [x, y] = P(g.y, g.z), h = Math.ceil(g.r * S * 1.3);
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
    const key = [I.kt, I.ft, I.hdg, I.pitch, I.roll, I.fpm, I.rpm, I.flaps, I.trim, I.turn, I.slip].map((v) => v.toFixed(1)).join(',');
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
        if (Q === TRIM) {
          const ty = y0 + (y1 - y0) * (0.5 - I.trim / 0.8);
          c.beginPath(); c.moveTo(x1 - 3, ty); c.lineTo(x0 + 15, ty - 6); c.lineTo(x0 + 15, ty + 6); c.fillStyle = C.amber; c.fill();
        } else {
          const fy = y0 + 10 + (y1 - y0 - 20) * Math.max(0, Math.min(1, I.flaps / 30));
          c.fillStyle = C.amber; c.fillRect(x0 + 3, fy - 4, x1 - x0 - 6, 8);
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
      const W = 0.40, H = 0.187, zb = 0.085, x = 1.0 - 0.06 * elev;
      const hubZ = zb + H * (1 - 200 / 280), th = -ail * 0.7;
      const rot = (y, z) => [y * Math.cos(th) - z * Math.sin(th), y * Math.sin(th) + z * Math.cos(th)];
      const o = rot(-W / 2, zb - hubZ), u = rot(W, 0), v = rot(0, H);
      add([x, yc + o[0], hubZ + o[1]], [0, u[0], u[1]], [0, v[0], v[1]], 2, uv(R_YOKE), R_YOKE[2] / W);
    };
    yoke(-0.25); yoke(0.35);
    add([PX, -0.66, PZ0], [0, PW, 0], [0, 0, PH], 1, uv(R_PANEL), S);
    add([PX, -0.70, -0.45], [0, 1.40, 0], [0, 0, 0.40], 0, hex(C.redSh));
    add([PX - 0.03, -0.68, TOP - 0.01], [0, 1.36, 0], [0.03, 0, 0.035], 1, uv(R_ROLL), R_ROLL[2] / 1.36);
    add([PX, -0.68, TOP + 0.025], [0, 1.36, 0], [0.08, 0, 0.02], 1, uv(R_GLARE), R_GLARE[2] / 1.36);
    add([PX + 0.03, -0.03, TOP + 0.035], [0, 0.06, 0], [0, 0, 0.045], 1, uv(R_COMP), R_COMP[2] / 0.06);
    add([PX + 0.12, -0.71, TOP + 0.05], [0, 0.06, 0], [-0.5, 0, 0.62], 0, hex(C.leather));
    add([PX + 0.12, 0.65, TOP + 0.05], [0, 0.06, 0], [-0.5, 0, 0.62], 0, hex(C.leather));
    add([0.92, -0.72, 1.0], [0, 1.44, 0], [0.02, 0, 0.06], 0, hex(C.leather));
    add([0.93, -0.72, 1.05], [0, 1.44, 0], [-1.6, 0, 0], 0, hex('#d6cebc'));
    add([-0.7, -0.70, -0.4], [2.2, 0, 0], [0, 0, 0.7], 1, uv(R_DOOR), R_DOOR[2] / 2.2);
    add([1.5, 0.70, -0.4], [-2.2, 0, 0], [0, 0, 0.7], 1, uv(R_DOOR), R_DOOR[2] / 2.2);
    add([-0.62, -0.70, 0.30], [0.09, 0, 0], [0, 0, 0.75], 0, hex(C.creamSh));
    add([-0.62, 0.70, 0.30], [0.09, 0, 0], [0, 0, 0.75], 0, hex(C.creamSh));
    add([-0.62, -0.70, 0.27], [2.0, 0, 0], [0, 0.04, 0.03], 0, hex(C.leather));
    add([-0.62, 0.66, 0.30], [2.0, 0, 0], [0, 0.04, -0.03], 0, hex(C.leather));
    add([-0.75, -0.72, -0.4], [0, 1.44, 0], [0, 0, 1.45], 0, hex('#b3a890'));          // parede de tras (forro)
    add([-0.75, -0.72, -0.4], [2.0, 0, 0], [0, 1.44, 0], 0, hex('#3a2a28'));            // piso
    this.n = n;
    return q;
  }
}
