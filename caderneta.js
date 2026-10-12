// caderneta.js - as folhas da prancheta presa na perna do piloto (desenhadas em canvas e usadas
// como textura do papel na cabine 3D): checklist (so leitura, papel mesmo), carta visual gerada do
// proprio mundo (sem o aviaozinho: navegacao visual, VFR) e a folha dos controles.
// Olhando bem para baixo, para a perna, a visao vai para a prancheta; RB/LB (Q/E) trocam a folha.

const M_FOREST = 1, M_WATER = 6, M_TOWN = 7;
const TER_N = 2048, CELL = 8, WORLD = TER_N * CELL;
const S = 2, PX = TER_N / S;   // carta de 1024 px: 1 px = 16 m


// ---------- carta ----------
const HYPS = [[0, '#cfe2b2'], [500, '#e1e6b7'], [1000, '#eee2b0'], [2000, '#e9cf9b'], [3000, '#dcb886'], [4500, '#c99f78'], [6000, '#f2f0ea']];
const hexc = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const HC = HYPS.map(([f, c]) => [f, hexc(c)]);
function hyps(ft) {
  if (ft <= HC[0][0]) return HC[0][1];
  for (let i = 1; i < HC.length; i++) if (ft < HC[i][0]) {
    const [f0, c0] = HC[i - 1], [f1, c1] = HC[i], t = (ft - f0) / (f1 - f0);
    return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t);
  }
  return HC[HC.length - 1][1];
}
const TOWN_NAMES = ['Vila Nova', 'Santa Rita', 'Porto Velho', 'Pedra Branca', 'Ribeirão', 'São Bento', 'Alvorada', 'Boa Vista',
  'Campo Alegre', 'Serra Azul', 'Lagoa Seca', 'Monte Claro', 'Areia Branca', 'Pinhal', 'Barra Funda', 'Água Doce'];
const FREQ = ['118.30', '120.55', '119.10'], ATIS = ['127.65', '126.20', '128.85'];

function buildChart(w) {
  const mem = w.memory.buffer;
  const H = new Float32Array(mem, w.voo_h(), TER_N * TER_N);
  const CAN = new Uint8Array(mem, w.voo_canopy(), TER_N * TER_N);
  const MAT = new Uint8Array(mem, w.voo_mat(), TER_N * TER_N);
  const gnd = (ix, iy) => { const i = (iy & 2047) * TER_N + (ix & 2047); return H[i] - CAN[i]; };
  // a carta e centrada entre os aeroportos (o mundo da a volta: nada fica cortado na borda)
  const ap = new Float32Array(w.memory.buffer, w.voo_airports(), 16);
  const wd = (d) => d - Math.round(d / WORLD) * WORLD;
  const cx0 = ap[0] + wd(ap[8] - ap[0]) / 2, cy0 = ap[1] + wd(ap[9] - ap[1]) / 2;
  const ox = Math.round((cx0 - WORLD / 2) / (CELL * S)), oy = Math.round((cy0 - WORLD / 2) / (CELL * S));   // deslocamento em px da carta
  const toChart = (x, y) => [(((x / (CELL * S) - ox) % PX) + PX) % PX, PX - (((y / (CELL * S) - oy) % PX) + PX) % PX];
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const c = cv.getContext('2d');
  const img = c.createImageData(PX, PX), d = img.data;
  const ftAt = new Float32Array(PX * PX), kind = new Uint8Array(PX * PX);
  for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
    const ix = ((px + ox) * S) & 2047, iy = ((PX - 1 - py + oy) * S) & 2047, i = iy * TER_N + ix, o = py * PX + px;
    const m = MAT[i], h = gnd(ix, iy);
    ftAt[o] = Math.max(h, 0) * 3.281;
    kind[o] = h < 0 || m === M_WATER ? 1 : m === M_TOWN ? 2 : m === M_FOREST ? 3 : 0;
  }
  for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
    const o = py * PX + px, ix = ((px + ox) * S) & 2047, iy = ((PX - 1 - py + oy) * S) & 2047;
    let col;
    if (kind[o] === 1) {
      const coast = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const q = ((py + b + PX) % PX) * PX + (px + a + PX) % PX; return kind[q] !== 1; });
      col = coast ? [63, 120, 168] : (-gnd(ix, iy) < 6 ? [184, 216, 238] : [166, 204, 232]);
    } else {
      col = hyps(ftAt[o]).slice();
      // sombreamento do relevo, luz do noroeste
      const dx = gnd(ix + S, iy) - gnd(ix - S, iy), dy = gnd(ix, iy + S) - gnd(ix, iy - S);
      const sh = Math.max(-0.35, Math.min(0.3, (dx - dy) * -0.018));
      col = col.map((v) => v * (1 + sh));
      if (kind[o] === 3) col = [col[0] * 0.93, col[1] * 0.97, col[2] * 0.9];
      if (kind[o] === 2) col = [243, 211, 107];
      // curvas de nivel a cada 500 pes
      const b = Math.floor(ftAt[o] / 500);
      if (px + 1 < PX && py + 1 < PX && (Math.floor(ftAt[o + 1] / 500) !== b || Math.floor(ftAt[o + PX] / 500) !== b) && kind[o] !== 2)
        col = col.map((v, k) => v * 0.72 + [120, 85, 50][k] * 0.28);
    }
    const q = o * 4;
    d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2]; d[q + 3] = 255;
  }
  c.putImageData(img, 0, 0);

  // cidades: grupos de pixels de cidade, com nome
  const seen = new Uint8Array(PX * PX), towns = [];
  for (let o = 0; o < PX * PX; o++) {
    if (kind[o] !== 2 || seen[o]) continue;
    let n = 0, sx = 0, sy = 0; const st = [o]; seen[o] = 1;
    while (st.length) {
      const p = st.pop(), x = p % PX, y = (p / PX) | 0; n++; sx += x; sy += y;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const xx = x + a, yy = y + b; if (xx < 0 || yy < 0 || xx >= PX || yy >= PX) continue;
        const q = yy * PX + xx; if (kind[q] === 2 && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    if (n > 60) towns.push({ x: sx / n, y: sy / n, n });
  }
  towns.sort((a, b) => b.n - a.n);
  c.textAlign = 'center';
  towns.slice(0, TOWN_NAMES.length).forEach((t, i) => {
    c.font = `700 ${t.n > 400 ? 15 : 12}px "DejaVu Sans Condensed", Arial, sans-serif`;
    c.lineWidth = 3; c.strokeStyle = '#fbf6e6'; c.fillStyle = '#3b2f22';
    c.strokeText(TOWN_NAMES[i].toUpperCase(), t.x, t.y - Math.sqrt(t.n) * 0.6 - 4);
    c.fillText(TOWN_NAMES[i].toUpperCase(), t.x, t.y - Math.sqrt(t.n) * 0.6 - 4);
  });

  // ferrovia: linha preta com travessas (simbolo das cartas) e as estacoes
  const nr = w.voo_nrail();
  if (nr > 1) {
    const R = new Float32Array(w.memory.buffer, w.voo_rail(), nr * 3);
    c.strokeStyle = '#2b2622'; c.lineWidth = 2.2;
    c.beginPath();
    let prev = null;
    for (let k = 0; k < nr; k += 2) {
      const [x, y] = toChart(R[k * 3], R[k * 3 + 1]);
      if (prev && Math.hypot(x - prev[0], y - prev[1]) < 40) c.lineTo(x, y); else c.moveTo(x, y);
      prev = [x, y];
    }
    c.stroke();
    c.lineWidth = 1.4;
    for (let k = 6; k + 1 < nr; k += 12) {
      const [x, y] = toChart(R[k * 3], R[k * 3 + 1]), [x2, y2] = toChart(R[k * 3 + 3], R[k * 3 + 4]);
      const l = Math.hypot(x2 - x, y2 - y) || 1, nx = -(y2 - y) / l * 4, ny = (x2 - x) / l * 4;
      if (l > 10) continue;
      c.beginPath(); c.moveTo(x - nx, y - ny); c.lineTo(x + nx, y + ny); c.stroke();
    }
  }

  // altitude maxima por quadrante (como nas cartas: milhares grandes, centenas pequenas)
  const Q = 4, qs = PX / Q;
  c.strokeStyle = '#2b4f9e55'; c.lineWidth = 1;
  for (let k = 1; k < Q; k++) { c.beginPath(); c.moveTo(k * qs, 0); c.lineTo(k * qs, PX); c.moveTo(0, k * qs); c.lineTo(PX, k * qs); c.stroke(); }
  for (let qy = 0; qy < Q; qy++) for (let qx = 0; qx < Q; qx++) {
    let mx = 0;
    for (let y = qy * qs; y < (qy + 1) * qs; y++) for (let x = qx * qs; x < (qx + 1) * qs; x++) mx = Math.max(mx, ftAt[y * PX + x]);
    const v = Math.ceil((mx + 200) / 100);   // + arvores/obstaculos, arredonda para cima
    const big = String(Math.floor(v / 10)), small = String(v % 10);
    const cx = qx * qs + qs * 0.5, cy = qy * qs + qs * 0.5;
    c.fillStyle = '#2b4f9e'; c.globalAlpha = 0.75;
    c.font = '700 34px "DejaVu Sans", Arial, sans-serif'; c.textAlign = 'right'; c.fillText(big, cx, cy + 12);
    c.font = '700 20px "DejaVu Sans", Arial, sans-serif'; c.textAlign = 'left'; c.fillText(small, cx + 1, cy - 2);
    c.globalAlpha = 1;
  }

  // aeroportos
  const str = (p) => { const b = new Uint8Array(w.memory.buffer, p, 16); let n = 0; while (n < 16 && b[n]) n++; return new TextDecoder().decode(b.subarray(0, n)); };
  const airports = [];
  for (let i = 0; i < w.voo_nairports(); i++) {
    const [cx, cy, ca, sa, len, wid, elev, num] = ap.subarray(i * 8, i * 8 + 8);
    const [x, y] = toChart(cx, cy);
    airports.push({ x, y });
    const L = len / 16, R = L * 0.62 + 6;
    c.save(); c.translate(x, y);
    c.strokeStyle = '#2a5ba8'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
    c.rotate(-Math.atan2(sa, ca));
    c.fillStyle = '#2a5ba8'; c.fillRect(-L / 2, -2.2, L, 4.4);
    for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) { c.save(); c.rotate(a); c.fillRect(R - 1, -1.5, 5, 3); c.restore(); }
    c.restore();
    const n1 = num | 0, n2 = (n1 + 18 - 1) % 36 + 1, f = (v) => String(v).padStart(2, '0');
    const lines = [`${str(w.voo_ap_name(i)).toUpperCase()} (${str(w.voo_ap_code(i))})`, `TWR ${FREQ[i % 3]}  ATIS ${ATIS[i % 3]}`,
      `${Math.round(elev * 3.281)}  L ${Math.round(len * 3.281 / 100)}  ${f(Math.min(n1, n2))}/${f(Math.max(n1, n2))}`];
    const lx = x + R + 10, ly = y - 20;
    c.textAlign = 'left';
    lines.forEach((t, k) => {
      c.font = k === 0 ? '700 15px "DejaVu Sans Condensed", Arial, sans-serif' : '600 12px "DejaVu Sans Condensed", Arial, sans-serif';
      c.lineWidth = 3; c.strokeStyle = '#fbf6e6'; c.fillStyle = '#1f3f80';
      c.strokeText(t, lx, ly + k * 15); c.fillText(t, lx, ly + k * 15);
    });
  }

  // titulo, escala e norte
  c.fillStyle = '#fbf6e6e8'; c.fillRect(10, PX - 74, 300, 64);
  c.strokeStyle = '#3b2f22'; c.lineWidth = 1; c.strokeRect(10, PX - 74, 300, 64);
  c.fillStyle = '#3b2f22'; c.textAlign = 'left';
  c.font = '700 14px "DejaVu Sans Condensed", Arial, sans-serif'; c.fillText('CARTA DE NAVEGAÇÃO VISUAL', 18, PX - 56);
  c.font = '11px "DejaVu Sans Condensed", Arial, sans-serif';
  c.fillText('Altitudes em pés · o mundo continua do outro lado', 18, PX - 41);
  const nm = 1852 / 16;
  for (let k = 0; k < 3; k++) { c.fillStyle = k % 2 ? '#fbf6e6' : '#3b2f22'; c.fillRect(18 + k * nm, PX - 30, nm, 6); }
  c.strokeRect(18, PX - 30, nm * 3, 6);
  c.fillStyle = '#3b2f22'; c.font = '10px "DejaVu Sans Condensed", Arial, sans-serif';
  ['0', '1', '2', '3 NM'].forEach((t, k) => c.fillText(t, 15 + k * nm, PX - 15));
  c.save(); c.translate(PX - 34, 40);
  c.fillStyle = '#3b2f22'; c.beginPath(); c.moveTo(0, -22); c.lineTo(8, 10); c.lineTo(0, 4); c.lineTo(-8, 10); c.closePath(); c.fill();
  c.font = '700 14px "DejaVu Sans", Arial'; c.textAlign = 'center'; c.fillText('N', 0, 26); c.restore();
  return { canvas: cv, airports, toChart };
}


// ---------- papel ----------
export const PAPER_W = 1024, PAPER_H = 1400;
const INK = '#23201c', RED = '#8a2420', FADE = '#6b5c4c';
function paper(title, sub) {
  const cv = document.createElement('canvas');
  cv.width = PAPER_W; cv.height = PAPER_H;
  const c = cv.getContext('2d');
  c.fillStyle = '#f4efe2'; c.fillRect(0, 0, PAPER_W, PAPER_H);
  // fibras e sombra leve nas bordas
  for (let i = 0; i < 2500; i++) { c.fillStyle = `rgba(120,100,70,${Math.random() * 0.04})`; c.fillRect(Math.random() * PAPER_W, Math.random() * PAPER_H, 2, 2); }
  const g = c.createRadialGradient(PAPER_W / 2, PAPER_H / 2, PAPER_H * 0.3, PAPER_W / 2, PAPER_H / 2, PAPER_H * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,70,40,0.12)');
  c.fillStyle = g; c.fillRect(0, 0, PAPER_W, PAPER_H);
  c.fillStyle = RED; c.fillRect(0, 150, PAPER_W, 8);
  c.fillStyle = INK; c.textBaseline = 'alphabetic';
  c.font = 'italic 700 72px "DejaVu Serif", Georgia, serif'; c.fillText(title, 56, 110);
  c.font = '600 28px "DejaVu Sans Condensed", Arial, sans-serif'; c.fillStyle = FADE;
  c.textAlign = 'right'; c.fillText(sub, PAPER_W - 56, 108); c.textAlign = 'left';
  return [cv, c];
}
// linha "item ........ VALOR"
function leader(c, y, a, b, size = 34) {
  c.font = `500 ${size}px "DejaVu Sans Condensed", Arial, sans-serif`; c.fillStyle = INK;
  c.fillText(a, 70, y);
  c.font = `700 ${size}px "DejaVu Sans Condensed", Arial, sans-serif`;
  const wb = c.measureText(b).width, wa = c.measureText(a).width;
  c.textAlign = 'right'; c.fillText(b, PAPER_W - 64, y); c.textAlign = 'left';
  c.fillStyle = '#9a8b74';
  for (let x = 70 + wa + 14; x < PAPER_W - 64 - wb - 14; x += 14) c.fillRect(x, y - 6, 4, 4);
}
function head(c, y, t) {
  c.font = '700 30px "DejaVu Sans Condensed", Arial, sans-serif'; c.fillStyle = RED;
  c.fillText(t.toUpperCase(), 56, y);
  c.fillRect(56, y + 10, PAPER_W - 112, 2);
}

const CHECK = [
  ['Antes da decolagem', [['Freios', 'APLICADOS'], ['Comandos', 'LIVRES E CORRETOS'], ['Cheque do motor', '1800 RPM'], ['Flaps', '0° – 10°'], ['Compensador', 'DECOLAGEM'], ['Luzes', 'NAV · STROBE']]],
  ['Decolagem', [['Luz de pouso', 'LIGADA'], ['Motor', 'CHEIO'], ['Velocímetro', 'SUBINDO'], ['Rodar', '55 KT'], ['Subida', '75 – 80 KT']]],
  ['Cruzeiro', [['Flaps', 'RECOLHIDOS'], ['Potência', '2200 – 2400 RPM'], ['Compensador', 'MANCHE ALIVIADO']]],
  ['Antes do pouso', [['Luz de pouso', 'LIGADA'], ['Flaps', '20° – 30°'], ['Aproximação', '60 – 70 KT'], ['PAPI', '2 BRANCAS · 2 VERMELHAS']]],
  ['Após o pouso', [['Flaps', 'RECOLHIDOS'], ['Luz de pouso', 'DESLIGADA'], ['Táxi', 'ABAIXO DE 15 KT'], ['Estacionado', 'FREIO PRESO']]],
  ['Emergência: pane do motor', [['Planeio', '68 KT'], ['Campo', 'ESCOLHER À FRENTE'], ['Flaps', 'SÓ COM O POUSO GARANTIDO']]],
];
function sheetChecklist() {
  const [cv, c] = paper('Checklist', 'CESSNA 172');
  let y = 214;
  for (const [t, items] of CHECK) {
    head(c, y, t); y += 48;
    for (const [a, b] of items) { leader(c, y, a, b, 28); y += 33; }
    y += 12;
  }
  return cv;
}

function sheetChart(w) {
  const [cv, c] = paper('Carta visual', 'VFR');
  const ch = buildChart(w).canvas;
  const sz = PAPER_W - 80;
  c.drawImage(ch, 40, 190, sz, sz);
  c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(40, 190, sz, sz);
  let y = 190 + sz + 60;
  head(c, y, 'Aeródromos'); y += 56;
  const ap = new Float32Array(w.memory.buffer, w.voo_airports(), 16);
  const str = (p) => { const b = new Uint8Array(w.memory.buffer, p, 16); let n = 0; while (n < 16 && b[n]) n++; return new TextDecoder().decode(b.subarray(0, n)); };
  for (let i = 0; i < w.voo_nairports(); i++) {
    const elev = ap[i * 8 + 6], len = ap[i * 8 + 4], num = ap[i * 8 + 7] | 0, n2 = (num + 18 - 1) % 36 + 1, f = (v) => String(v).padStart(2, '0');
    leader(c, y, `${str(w.voo_ap_name(i))} (${str(w.voo_ap_code(i))})  TWR ${FREQ[i % 3]}`, `${Math.round(elev * 3.281)} ft · ${f(Math.min(num, n2))}/${f(Math.max(num, n2))} · ${Math.round(len)} m`, 28);
    y += 44;
  }
  c.font = '500 24px "DejaVu Sans Condensed", Arial, sans-serif'; c.fillStyle = FADE;
  c.fillText('Altitudes em pés. Azul: altitude máxima do quadrante. Linha com travessas: ferrovia.', 56, y + 14);
  return cv;
}

const PAD = [['Analógico esquerdo', 'manche'], ['Analógico direito', 'olhar (para baixo: prancheta)'], ['RB · LB', 'motor (na prancheta: folha)'],
  ['RT · LT', 'leme e bequilha'], ['A · B', 'flaps desce · sobe'], ['X · Y', 'compensador nariz acima · abaixo'],
  ['Seta ←', 'navegação, farol rotativo e painel'], ['Seta →', 'strobes'], ['Seta ↑', 'pouso e táxi'],
  ['Seta ↓', 'freio · dois toques: estacionamento'], ['SELECT', 'câmera'], ['START', 'menu'], ['L3', 'soltar / pegar os comandos'], ['R3 (segurar)', 'falar']];
const KEYS = [['Setas', 'manche'], ['W · S', 'motor'], ['A · D', 'leme'], ['F · V', 'flaps'], [', · .', 'compensador acima · abaixo'],
  ['I J K L', 'olhar (K: prancheta)'], ['Q · E', 'folha da prancheta'], ['1 · 2 · 3', 'navegação · strobes · pouso'],
  ['Espaço', 'freio · dois toques: estacionamento'], ['C', 'câmera'], ['Esc', 'menu'], ['G', 'voar junto'], ['T', 'soltar / pegar os comandos'],
  ['B (segurar)', 'falar'], ['Enter', 'chat']];
function sheetControls() {
  const [cv, c] = paper('Controles', 'CONTROLE · TECLADO');
  let y = 214;
  head(c, y, 'Controle'); y += 52;
  for (const [a, b] of PAD) { leader(c, y, a, b, 27); y += 34; }
  y += 20;
  head(c, y, 'Teclado'); y += 52;
  for (const [a, b] of KEYS) { leader(c, y, a, b, 27); y += 34; }
  return cv;
}

// as tres folhas: 0 checklist, 1 carta, 2 controles
export function buildSheets(w) { return [sheetChecklist(), sheetChart(w), sheetControls()]; }
