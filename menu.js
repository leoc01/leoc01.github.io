// menu.js - menu de pausa em HTML, no estilo do painel (folheto Skyhawk dos anos 70):
// papel creme, faixa vinho, filete dourado. O estado e a logica continuam no C (menu.c):
// este arquivo so desenha o que o C descreve e manda comandos (teclas virtuais) de volta.
// Teclado e controle funcionam como antes; o mouse escolhe e clica.

const KEY_LEFT = 258, KEY_RIGHT = 259, KEY_ESC = 261, KEY_ENTER = 262;

// rotulos e valores com acento (o C fala ASCII)
const LABELS = ['Continuar voo', 'Cenário', 'Reiniciar no aeroporto', 'Horário', 'Câmera externa', 'Pixel da imagem',
  'Suavizar bordas', 'Quadros por segundo', 'Som', 'Sair do jogo'];
const GROUPS = { 0: 'Voo', 3: 'Ambiente', 4: 'Imagem', 8: 'Som', 9: '' };
const VALUES = { manha: 'manhã', 'meio-dia': 'meio-dia', tarde: 'tarde', 'por do sol': 'pôr do sol', noite: 'noite',
  nao: 'não', sim: 'sim', baixa: 'baixa', normal: 'normal', alta: 'alta', 'sem limite': 'sem limite',
  desligado: 'desligado', 'alto-falantes': 'alto-falantes', 'fones 3D': 'fones 3D' };
const pretty = (v) => VALUES[v] ?? v.replace(/^pixel (\d)x$/, '$1×');

const KEYS = [
  ['↑ ↓ ← →', 'manche'], ['W  S', 'motor'], ['A  D', 'leme'], ['F  V', 'flaps'], [',  .', 'trim (nariz acima / abaixo)'],
  ['Espaço', 'freios'], ['I J K L', 'olhar em volta'], ['N', 'luzes do avião'], ['C', 'câmera'], ['M  H  U', 'carta, checklist, manual'], ['G', 'voar junto'], ['T', 'troca de comandos'], ['B', 'falar (segurar)'], ['Esc', 'menu'],
];
const PAD = [
  ['L', 'manche'], ['RB  LB', 'motor'], ['RT  LT', 'leme'], ['A  B', 'flaps'], ['X  Y', 'trim (nariz acima / abaixo)'],
  ['↓', 'freios'], ['R', 'olhar em volta'], ['←  →', 'luzes do avião'], ['SELECT', 'câmera'], ['↑', 'carta, checklist, manual'], ['L3', 'troca de comandos'], ['R3', 'falar (segurar)'], ['START', 'menu'],
];

const CSS = `
#menu { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; gap: 28px; padding: 24px;
  box-sizing: border-box; background: radial-gradient(ellipse at 50% 45%, #1a0d0cb0 0%, #0b0606e6 75%);
  font-family: "DejaVu Sans Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
  user-select: none; flex-wrap: wrap; overflow: auto; }
#menu .card { background: #efe6d1; color: #2b211d; border-radius: 18px; width: min(460px, 92vw); max-height: calc(100vh - 32px); overflow-y: auto;
  box-shadow: 0 2px 0 #c9a24a inset, 0 24px 60px #000a, 0 0 0 1px #00000040; overflow: hidden; }
#menu .band { background: linear-gradient(#8a2420, #6e1a17); color: #f6efe0; padding: 14px 26px 11px; position: relative; }
#menu .band::after { content: ""; position: absolute; left: 0; right: 0; bottom: -5px; height: 3px; background: #c9a24a; }
#menu .brand { font: italic 700 30px/1 "DejaVu Serif", Georgia, serif; letter-spacing: 0.02em; }
#menu .brand small { font: 600 12px/1 inherit; font-style: normal; letter-spacing: 0.28em; opacity: 0.75; margin-left: 10px;
  font-family: "DejaVu Sans Condensed", "Arial Narrow", sans-serif; vertical-align: middle; }
#menu .rows { padding: 10px 12px 12px; }
#menu .grp { font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: #8a7a68; margin: 8px 14px 2px; }
#menu .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 14px; border-radius: 10px;
  font-size: 16px; cursor: pointer; position: relative; transition: background 0.08s; }
#menu .row.sel { background: #e2d5ba; }
#menu .row.sel::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 4px; border-radius: 2px; background: #8a2420; }
#menu .row.act { font-weight: 700; }
#menu .row.quit { color: #8a2420; }
#menu .val { display: flex; align-items: center; gap: 2px; font-weight: 700; color: #6e1a17; }
#menu .val b { display: inline-block; min-width: 116px; text-align: center; background: #f8f2e4; border: 1px solid #d3c3a3;
  border-radius: 8px; padding: 3px 10px; font-size: 15px; }
#menu .arr { width: 26px; height: 26px; border-radius: 13px; display: grid; place-items: center; color: #8a2420; font-size: 14px; }
#menu .arr:hover { background: #d9c9a8; }
#menu .row:not(.sel) .arr { opacity: 0.35; }
#menu .go { font-size: 13px; color: #8a7a68; font-weight: 600; letter-spacing: 0.04em; }
#menu .row.sel .go { color: #6e1a17; }
#menu .foot { border-top: 1px solid #d8caa9; margin: 4px 14px 0; padding: 10px 0 0; font-size: 12px; color: #8a7a68; display: flex; justify-content: space-between; }
#menu .help { width: min(320px, 92vw); color: #efe6d1; background: #1c1413cc; border: 1px solid #c9a24a55; border-radius: 16px; padding: 18px 20px; }
#menu .help h3 { margin: 0 0 12px; font-size: 12px; letter-spacing: 0.24em; text-transform: uppercase; color: #c9a24a; font-weight: 700; }
#menu .help table { border-collapse: collapse; width: 100%; font-size: 14px; }
#menu .help td { padding: 4px 0; vertical-align: middle; }
#menu .help td:first-child { width: 42%; padding-right: 10px; }
#menu kbd { display: inline-block; font: 700 12px/1 "DejaVu Sans Mono", Menlo, monospace; color: #2b211d; background: #efe6d1;
  border-radius: 5px; padding: 4px 6px; box-shadow: 0 2px 0 #9c8a6a; margin: 0 2px 2px 0; }
`;

export class MenuUI {
  constructor(w, extra) {
    this.w = w;
    this.extra = extra;   // linha so do navegador (ex.: voar junto)
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.last = '';
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) { if (e.target === this.el) this.w.voo_keypress(KEY_ESC); return; }
      if (row.dataset.i === 'x') { this.extra?.onClick(); return; }
      const i = +row.dataset.i;
      this.w.voo_menu_sel(i);
      const arr = e.target.closest('.arr');
      if (arr) this.w.voo_keypress(arr.dataset.d === '-' ? KEY_LEFT : KEY_RIGHT);
      else this.w.voo_keypress(row.dataset.k === 'v' ? KEY_RIGHT : KEY_ENTER);
    });
    this.el.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.row');
      if (row && row.dataset.i !== 'x' && !row.classList.contains('sel')) this.w.voo_menu_sel(+row.dataset.i);
    });
  }

  readState() {
    const w = this.w, p = w.voo_menu_text(), mem = new Uint8Array(w.memory.buffer, p, 2048);
    let n = 0;
    while (n < 2048 && mem[n]) n++;
    return new TextDecoder().decode(mem.subarray(0, n));
  }

  update(open) {
    if (!open) { if (!this.el.hidden) { this.el.hidden = true; this.last = ''; } return; }
    const pad = this.w.voo_pad_active();
    const txt = this.readState() + '|' + pad;
    if (txt === this.last && !this.el.hidden) return;
    this.last = txt;
    this.el.hidden = false;
    const lines = txt.split('|')[0].trim().split('\n');
    const sel = +lines[0];
    let rows = '';
    lines.slice(1).forEach((ln, i) => {
      const [, val, kind] = ln.split('\t');
      if (i in GROUPS && GROUPS[i]) rows += `<div class="grp">${GROUPS[i]}</div>`;
      if (i === 9 && this.extra) rows += `<div class="grp">Junto</div><div class="row" data-i="x"><span>${this.extra.label}</span><span class="go">G</span></div>`;
      if (i === 9) rows += '<div style="height:10px"></div>';
      const cls = ['row', i === sel ? 'sel' : '', kind === 'a' ? 'act' : '', i === 9 ? 'quit' : ''].join(' ');
      let right = '';
      if (kind === 'v' || kind === 's') right = `<span class="val"><span class="arr" data-d="-">◀</span><b>${pretty(val)}</b><span class="arr" data-d="+">▶</span></span>`;
      else right = `<span class="go">${i === sel ? (pad ? 'A' : 'Enter') : ''}</span>`;
      rows += `<div class="${cls}" data-i="${i}" data-k="${kind}"><span>${LABELS[i]}</span>${right}</div>`;
    });
    const keys = (pad ? PAD : KEYS).map(([k, a]) => `<tr><td>${k.split(/\s{2,}/).map((x) => `<kbd>${x}</kbd>`).join(' ')}</td><td>${a}</td></tr>`).join('');
    this.el.innerHTML = `
      <div class="card">
        <div class="band"><span class="brand">Voo<small>PAUSA</small></span></div>
        <div class="rows">${rows}
          <div class="foot"><span>${pad ? 'D-pad escolhe · A confirma · B volta' : 'setas escolhem · Enter confirma · Esc volta'}</span><span>mouse também</span></div>
        </div>
      </div>
      <div class="help"><h3>${pad ? 'Controle' : 'Teclado'}</h3><table>${keys}</table></div>`;
  }
}
