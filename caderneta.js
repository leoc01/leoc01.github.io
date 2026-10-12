// caderneta.js - a "caderneta do piloto" no navegador: carta visual (gerada do proprio mundo),
// checklist que se marca sozinho conforme o piloto faz as coisas, e o manual resumido.
// Abre com M (carta), H (checklist), U (manual) ou D-pad para cima (passa pelas tres).
// O estado (qual pagina) vem do C (info[95]); aqui so desenha e confere os itens.

const M_FOREST = 1, M_WATER = 6, M_TOWN = 7;
const TER_N = 2048, CELL = 8, WORLD = TER_N * CELL;
const S = 2, PX = TER_N / S;   // carta de 1024 px: 1 px = 16 m

const CSS = `
#cad { position: fixed; inset: 0; pointer-events: none; font-family: "DejaVu Sans Condensed", "Roboto Condensed", "Arial Narrow", Arial, sans-serif; }
#cad .card { pointer-events: auto; background: #efe6d1; color: #2b211d; border-radius: 14px; box-shadow: 0 2px 0 #c9a24a inset, 0 18px 50px #000a; overflow: hidden; }
#cad .band { background: linear-gradient(#8a2420, #6e1a17); color: #f6efe0; padding: 9px 16px 7px; display: flex; justify-content: space-between; align-items: baseline; position: relative; }
#cad .band::after { content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 3px; background: #c9a24a; }
#cad .band b { font: italic 700 19px/1 "DejaVu Serif", Georgia, serif; }
#cad .band span { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.8; }
#cad .chart { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(94vw, 88vh); }
#cad .chart .wrap { position: relative; }
#cad .chart canvas { display: block; width: 100%; height: auto; }
#cad .chart .foot { display: flex; justify-content: space-between; align-items: center; padding: 7px 14px; font-size: 12px; color: #6b5c4c; }
#cad button { font: 700 12px/1 inherit; background: #8a2420; color: #f6efe0; border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
#cad .list { position: absolute; right: 14px; top: 14px; width: min(330px, 46vw); max-height: calc(100vh - 28px); overflow-y: auto; opacity: 0.96; }
#cad .ph { padding: 6px 14px 2px; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #8a7a68; }
#cad .ph.cur { color: #8a2420; font-weight: 700; }
#cad .it { display: flex; gap: 8px; align-items: baseline; padding: 3px 14px; font-size: 14px; cursor: pointer; }
#cad .it i { flex: 1; font-style: normal; }
#cad .it em { font-style: normal; color: #6e1a17; font-weight: 700; font-size: 13px; }
#cad .it .bx { width: 13px; height: 13px; border: 1.5px solid #8a7a68; border-radius: 3px; flex: none; position: relative; top: 2px; }
#cad .it.ok .bx { background: #3f7d3a; border-color: #3f7d3a; }
#cad .it.ok .bx::after { content: "✓"; color: #fff; font-size: 11px; position: absolute; left: 1px; top: -2px; }
#cad .it.ok i, #cad .it.ok em { color: #8a7a68; }
#cad .grp:not(.cur) .it { display: none; }
#cad .grp.cur { background: #e7dcc2; padding-bottom: 6px; }
#cad .list .hint { padding: 6px 14px 10px; font-size: 11px; color: #8a7a68; }
#cad .man { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(760px, 94vw); max-height: 90vh; display: flex; flex-direction: column; }
#cad .man .body { overflow-y: auto; padding: 8px 20px 16px; columns: 2 300px; column-gap: 26px; font-size: 13.5px; line-height: 1.38; }
#cad .man h4 { margin: 10px 0 4px; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #8a2420; break-after: avoid; }
#cad .man table { border-collapse: collapse; width: 100%; break-inside: avoid; }
#cad .man td { padding: 2px 0; border-bottom: 1px dotted #cdbd9c; }
#cad .man td:last-child { text-align: right; font-weight: 700; white-space: nowrap; }
#cad .man ol { margin: 0; padding-left: 18px; break-inside: avoid; }
#cad .man p { margin: 0 0 6px; }
`;

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

// ---------- checklist ----------
// cada item: texto, valor esperado e como o jogo confere (I = info do quadro, s = estado da conferencia)
const PHASES = [
  { id: 'antes', name: 'Antes da decolagem', items: [
    ['Freios', 'aplicados', (I) => I[97] > 0.5 && I[86] > 0.5],
    ['Comandos', 'livres e corretos', (I, s) => s.ctl === 63],
    ['Cheque do motor', '1800 RPM', (I) => I[86] > 0.5 && I[67] < 25 && I[73] > 1700 && I[73] < 1950],
    ['Flaps', '0° a 10°', (I) => I[81] <= 1],
    ['Compensador', 'decolagem', (I) => Math.abs(I[75] - 0.05) < 0.07],
    ['Farol e navegação', 'ligados', (I) => I[88] >= 1],
  ] },
  { id: 'decol', name: 'Decolagem', items: [
    ['Luz de pouso', 'ligada', (I) => I[88] >= 3],
    ['Motor', 'cheio', (I) => I[80] > 0.95],
    ['Velocímetro', 'subindo', (I) => I[67] > 35],
    ['Rodar', '55 kt', (I, s) => s.liftoff],
  ] },
  { id: 'sub', name: 'Subida', items: [
    ['Velocidade', '75–80 kt', (I, s) => s.climbSpd > 4],
    ['Flaps', 'recolhidos', (I) => I[81] === 0 && I[86] < 0.5 && I[96] > 60],
  ] },
  { id: 'cruz', name: 'Cruzeiro', items: [
    ['Potência', '2200–2450 RPM', (I) => I[86] < 0.5 && I[73] >= 2200 && I[73] <= 2450],
    ['Compensador', 'manche aliviado', (I, s) => s.trimmed > 4],
  ] },
  { id: 'pouso', name: 'Antes do pouso', items: [
    ['Luz de pouso', 'ligada', (I) => I[88] >= 3],
    ['Flaps', '20° a 30°', (I) => I[81] >= 2],
    ['Aproximação', '60–70 kt', (I) => I[81] >= 2 && I[67] > 58 && I[67] < 72 && I[86] < 0.5],
  ] },
  { id: 'apos', name: 'Após o pouso', items: [
    ['Flaps', 'recolhidos', (I) => I[81] === 0 && I[86] > 0.5],
    ['Luz de pouso', 'desligada', (I) => I[88] < 3 && I[86] > 0.5],
    ['Táxi', 'abaixo de 15 kt', (I) => I[86] > 0.5 && I[67] < 15],
  ] },
];

const MANUAL = `
<h4>Velocidades (KIAS)</h4>
<table>
<tr><td>Estol, flaps 30° (V<sub>S0</sub>)</td><td>40 kt</td></tr>
<tr><td>Estol, sem flaps (V<sub>S1</sub>)</td><td>48 kt</td></tr>
<tr><td>Rotação (V<sub>R</sub>)</td><td>55 kt</td></tr>
<tr><td>Melhor ângulo (V<sub>X</sub>)</td><td>62 kt</td></tr>
<tr><td>Melhor razão de subida (V<sub>Y</sub>)</td><td>74 kt</td></tr>
<tr><td>Melhor planeio</td><td>68 kt</td></tr>
<tr><td>Aproximação, flaps 30°</td><td>60–70 kt</td></tr>
<tr><td>Manobra (V<sub>A</sub>)</td><td>99 kt</td></tr>
<tr><td>Flaps estendidos (V<sub>FE</sub>)</td><td>85 kt</td></tr>
<tr><td>Normal máxima (V<sub>NO</sub>), fim do arco verde</td><td>129 kt</td></tr>
<tr><td>Nunca exceder (V<sub>NE</sub>), risco vermelho</td><td>163 kt</td></tr>
</table>
<h4>Motor e desempenho</h4>
<table>
<tr><td>Cheque de motor no solo</td><td>1800 RPM</td></tr>
<tr><td>Cruzeiro (~95 kt)</td><td>2200–2400 RPM</td></tr>
<tr><td>Planeio, motor em marcha lenta</td><td>~9 : 1</td></tr>
<tr><td>Sem flaps, 65 kt, motor reduzido</td><td>~750 pés/min</td></tr>
</table>
<h4>Decolagem normal</h4>
<ol><li>Flaps 0°–10°, compensador em decolagem.</li><li>Alinhe no eixo, motor cheio, mantenha a reta com o pedal.</li>
<li>A 55 kt puxe suave até ~8° de nariz acima.</li><li>Suba a 75–80 kt; acima de 200 pés recolha os flaps.</li></ol>
<h4>Pouso normal</h4>
<ol><li>Na perna do vento: luz de pouso, flaps 10°.</li><li>Base: flaps 20°, 70 kt. Final: flaps 30°, 60–65 kt.</li>
<li>PAPI: 2 brancas e 2 vermelhas = na rampa.</li><li>Sobre a cabeceira: reduza tudo e arredonde; toque com as rodas principais.</li>
<li>Freios só com o nariz no chão.</li></ol>
<h4>Glissada frontal (chegou alto)</h4>
<p>Asa do lado do vento para baixo com o aileron, pedal todo para o outro lado e nariz um pouco abaixo para não ganhar velocidade.
O avião segue reto com o nariz torto e desce quase o dobro. Para sair, alivie o pedal e nivele as asas antes do arredondamento.
Evite com flaps acima de 20°: o profundor vibra.</p>
<h4>Pane de motor em voo</h4>
<ol><li>Velocidade de planeio: 68 kt (compense).</li><li>Escolha um campo à frente, de preferência contra o vento.</li>
<li>Flaps só quando o pouso no campo estiver garantido.</li><li>Toque na menor velocidade possível, nariz acima.</li></ol>
<h4>Estol</h4>
<p>A buzina toca uns 5 kt antes. Recuperação: manche à frente até a buzina parar, motor cheio, asas niveladas com o pedal, e suba de novo devagar.</p>
<h4>Limites</h4>
<table><tr><td>Fator de carga, flaps recolhidos</td><td>+3,8 / −1,52 g</td></tr><tr><td>Fator de carga, flaps baixados</td><td>+3,0 g</td></tr>
<tr><td>Vento cruzado demonstrado</td><td>15 kt</td></tr></table>
<h4>Caderneta</h4>
<p><b>M</b> carta · <b>H</b> checklist · <b>U</b> manual · no controle, ↑ passa pelas três.</p>
`;

export class Caderneta {
  constructor(w) {
    this.w = w;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.id = 'cad';
    document.body.appendChild(this.el);
    this.page = 0;
    this.chart = null;
    this.reset();
  }

  reset() {
    this.done = PHASES.map((p) => p.items.map(() => false));
    this.s = { ctl: 0, liftoff: false, climbSpd: 0, trimmed: 0, flown: false, landed: false };
    this.phase = 0;
  }

  // em que fase do voo estamos (a lista mostra esta aberta)
  phaseOf(I) {
    const ground = I[86] > 0.5, kt = I[67], s = this.s;
    if (ground) {
      if (s.flown) { s.landed = true; return 5; }
      return kt > 25 || I[80] > 0.9 ? 1 : 0;
    }
    s.flown = true;
    if (I[81] >= 1 && I[72] < -150 && I[96] < 500) return 4;     // flaps e descendo baixo: aproximação
    if (I[72] > 300 && I[96] < 900) return 2;                     // subindo
    return this.phase === 4 ? 4 : 3;
  }

  check(I, dt) {
    const s = this.s, pos = [I[25], I[26], I[27]];
    if (this.prev && Math.hypot(pos[0] - this.prev[0], pos[1] - this.prev[1], pos[2] - this.prev[2]) > 50) this.reset();   // cenario novo
    this.prev = pos;
    if (I[86] > 0.5) {   // comandos livres: cada lado de cada comando (6 bits)
      const bits = [I[78] > 0.7, I[78] < -0.7, I[79] > 0.7, I[79] < -0.7, I[82] > 0.7, I[82] < -0.7];
      bits.forEach((b, k) => { if (b) s.ctl |= 1 << k; });
    }
    if (I[86] < 0.5 && !s.liftoff && I[67] > 48) s.liftoff = true;
    s.climbSpd = I[86] < 0.5 && I[72] > 200 && I[67] > 72 && I[67] < 83 ? s.climbSpd + dt : 0;
    s.trimmed = I[86] < 0.5 && Math.abs(I[78]) < 0.05 && Math.abs(I[72]) < 300 ? s.trimmed + dt : 0;
    this.phase = this.phaseOf(I);
    PHASES.forEach((p, i) => p.items.forEach((it, k) => { if (!this.done[i][k] && it[2](I, s)) this.done[i][k] = true; }));
  }

  update(I, started, dt) {
    if (started) this.check(I, dt);
    const page = started ? I[95] | 0 : 0;
    if (page !== this.page) { this.page = page; this.render(); }
    else if (page === 2) this.renderList(false);
    if (page === 1) this.drawPlane(I);
  }

  render() {
    const p = this.page;
    this.el.innerHTML = '';
    this.listKey = '';
    if (p === 1) {
      if (!this.chart) this.chart = buildChart(this.w);
      const card = document.createElement('div');
      card.className = 'card chart';
      card.innerHTML = `<div class="band"><b>Carta visual</b><span>M fecha</span></div><div class="wrap"></div>
        <div class="foot"><span>Seu avião em vermelho. Altitude máxima por quadrante em azul (milhares e centenas de pés).</span><button>Imprimir</button></div>`;
      this.live = document.createElement('canvas');
      this.live.width = this.live.height = PX;
      const wrap = card.querySelector('.wrap');
      wrap.appendChild(this.live);
      card.querySelector('button').onclick = () => this.print();
      this.el.appendChild(card);
    } else if (p === 2) {
      const card = document.createElement('div');
      card.className = 'card list';
      this.el.appendChild(card);
      this.listCard = card;
      this.renderList(true);
    } else if (p === 3) {
      const card = document.createElement('div');
      card.className = 'card man';
      card.innerHTML = `<div class="band"><b>Manual resumido · Cessna 172</b><span>U fecha</span></div><div class="body">${MANUAL}</div>`;
      this.el.appendChild(card);
    }
  }

  renderList(force) {
    const key = this.phase + '|' + this.done.map((a) => a.map(Number).join('')).join(',');
    if (!force && key === this.listKey) return;
    this.listKey = key;
    let h = '<div class="band"><b>Checklist</b><span>H fecha</span></div>';
    PHASES.forEach((ph, i) => {
      h += `<div class="grp ${i === this.phase ? 'cur' : ''}"><div class="ph ${i === this.phase ? 'cur' : ''}">${ph.name}</div>`;
      ph.items.forEach((it, k) => { h += `<div class="it ${this.done[i][k] ? 'ok' : ''}" data-p="${i}" data-k="${k}"><span class="bx"></span><i>${it[0]}</i><em>${it[1]}</em></div>`; });
      h += '</div>';
    });
    h += '<div class="hint">Os itens se marcam sozinhos quando você faz a ação; clique para marcar à mão.</div>';
    this.listCard.innerHTML = h;
    this.listCard.querySelectorAll('.it').forEach((e) => { e.onclick = () => { this.done[+e.dataset.p][+e.dataset.k] = true; this.renderList(true); }; });
    this.listCard.querySelectorAll('.ph').forEach((e, i) => { e.style.cursor = 'pointer'; e.onclick = () => { this.phase = i; this.renderList(true); }; });
  }

  drawPlane(I) {
    const c = this.live.getContext('2d');
    c.drawImage(this.chart.canvas, 0, 0);
    const [x, y] = this.chart.toChart(I[25], I[26]);
    const hdg = Math.atan2(I[28], I[29]);   // 0 = norte, horario
    c.save(); c.translate(x, y); c.rotate(hdg);
    c.fillStyle = '#d42a1e'; c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -13); c.lineTo(2.5, -4); c.lineTo(12, 0); c.lineTo(12, 3); c.lineTo(2.5, 2); c.lineTo(1.8, 9); c.lineTo(5, 11.5); c.lineTo(5, 13.5);
    c.lineTo(-5, 13.5); c.lineTo(-5, 11.5); c.lineTo(-1.8, 9); c.lineTo(-2.5, 2); c.lineTo(-12, 3); c.lineTo(-12, 0); c.lineTo(-2.5, -4); c.closePath();
    c.stroke(); c.fill();
    c.restore();
  }

  print() {
    const url = this.chart.canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<title>Carta visual - VOO</title><style>@page{size:auto;margin:8mm}body{margin:0}img{width:100%;}</style><img src="${url}" onload="setTimeout(()=>print(),200)">`);
    win.document.close();
  }
}
