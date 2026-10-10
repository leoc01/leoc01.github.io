// voo.js - pagina do jogo: gera o mundo (Web Workers), liga GPU, teclado, controle e som.
import { instantiate } from './wasm.js';
import { Renderer } from './renderer.js';
import { buildGraph, NSRC, OUT_CHANNELS } from './spatial.js';

const SEED = 2026;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DT_FIXO = parseFloat(params.get('dtfixo') || '0');

// codigos de tecla iguais aos de src/input.h
const KEY_UP = 256, KEY_DOWN = 257, KEY_LEFT = 258, KEY_RIGHT = 259, KEY_ESC = 261, KEY_ENTER = 262;
function keyCode(e) {
  switch (e.key) {
    case 'ArrowUp': return KEY_UP;
    case 'ArrowDown': return KEY_DOWN;
    case 'ArrowLeft': return KEY_LEFT;
    case 'ArrowRight': return KEY_RIGHT;
    case 'Escape': return KEY_ESC;
    case 'Enter': return KEY_ENTER;
    case ' ': case 'Spacebar': return 32;
  }
  if (e.key.length === 1) {
    const c = e.key.toLowerCase().charCodeAt(0);
    if (c > 32 && c < 127) return c;
  }
  return -1;
}
// mapeamento padrao do navegador (Gamepad API) -> botoes de src/input.h
const PAD_MAP = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 8: 6, 9: 7, 16: 8, 10: 9, 11: 10, 12: 11, 13: 12, 14: 13, 15: 14 };

function setProgress(p, text) {
  $('bar').style.width = (p * 100).toFixed(1) + '%';
  if (text) $('status').textContent = text;
}

// ---------- geracao do mundo em paralelo ----------
async function generateWorld(module, w) {
  const N = w.voo_ter_n();
  const nw = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const workers = Array.from({ length: nw }, () => new Worker('./gen-worker.js', { type: 'module' }));
  const run = (task, extra, onDone) => Promise.all(workers.map((wk, i) => new Promise((res, rej) => {
    const y0 = Math.floor(N * i / nw), y1 = Math.floor(N * (i + 1) / nw);
    wk.onmessage = (e) => { if (e.data.error) rej(new Error(e.data.error)); else { onDone(e.data, y0, y1); res(); } };
    wk.onerror = (e) => rej(new Error(e.message || 'erro no worker'));
    wk.postMessage({ module, task, y0, y1, seed: SEED, id: i, ...extra });
  })));
  const t0 = performance.now();
  let done = 0;
  setProgress(0.02, 'Erguendo montanhas...');
  const relief = new Float32Array(N * N);
  await run('relief', {}, (d, y0) => { relief.set(d.relief, y0 * N); setProgress(0.05 + 0.4 * (++done / nw)); });

  setProgress(0.45, 'Plantando florestas e pintando as pistas...');
  w.voo_gen_alloc();
  new Float32Array(w.memory.buffer, w.voo_gnd(), N * N).set(relief);
  w.voo_gen_mid(SEED);
  done = 0;
  await run('material', { relief: relief.buffer }, (d, y0, y1) => {
    const n = (y1 - y0) * N, mem = w.memory.buffer;
    new Float32Array(mem, w.voo_world_ptr(0) + y0 * N * 4, n).set(d.h);
    new Uint8Array(mem, w.voo_world_ptr(1) + y0 * N, n).set(d.canopy);
    new Uint8Array(mem, w.voo_world_ptr(2) + y0 * N * 3, n * 3).set(d.alb);
    new Uint8Array(mem, w.voo_world_ptr(3) + y0 * N, n).set(d.mat);
    setProgress(0.45 + 0.4 * (++done / nw));
  });
  workers.forEach((wk) => wk.terminate());
  setProgress(0.88, 'Construindo aeroportos e vilarejos...');
  await new Promise((r) => setTimeout(r, 0));
  w.voo_gen_rest(SEED);
  console.log(`mundo gerado em ${(performance.now() - t0).toFixed(0)} ms com ${nw} workers`);
}

// ---------- som ----------
// O C gera uma faixa por fonte (motor, helice, vento, rodas, buzina, flaps, cliques, impacto)
// ja com distancia, atraso/Doppler, reflexo no chao e cabine; aqui cada faixa passa por um
// panner (HRTF em "fones 3D") na direcao da fonte em relacao a camera (ver spatial.js).
class Sound {
  constructor(w) { this.w = w; this.ctx = null; this.mode = -1; }
  async start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const rate = this.w.voo_audio_rate();
    try {
      this.ctx = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule('./audio-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'voo-audio', {
        numberOfInputs: 0, numberOfOutputs: NSRC, outputChannelCount: OUT_CHANNELS,
      });
      this.g = buildGraph(this.ctx, (s, dst) => this.node.connect(dst, s));
      this.nch = this.w.voo_audio_nch();
      this.rate = this.ctx.sampleRate;
      this.sent = 0;
      this.t0 = this.ctx.currentTime;
    } catch (e) { console.warn('som indisponivel', e); this.ctx = null; }
  }
  // info: vetor de estado do quadro (modo de som em [66], cabine em [17])
  pump(info) {
    if (!this.ctx || !this.node) return;
    const mode = info[66] | 0, cabin = info[17] > 0 ? 1 : 0;   /* le antes: a memoria do wasm pode crescer */
    if (mode !== this.mode) { this.mode = mode; if (mode > 0) this.g.setMode(mode); }
    const played = (this.ctx.currentTime - this.t0) * this.rate;
    if (this.sent < played) this.sent = played;   /* aba ficou parada: nao acumula atraso */
    const n = 512;
    while (this.sent - played < 0.10 * this.rate) {
      const p = this.w.voo_audio(n);
      const data = new Float32Array(this.nch * n);
      data.set(new Float32Array(this.w.memory.buffer, p, this.nch * n));
      this.node.port.postMessage({ n, data }, [data.buffer]);
      // a posicao vale para quando este bloco tocar
      const when = this.t0 + this.sent / this.rate;
      this.g.setPositions(new Float32Array(this.w.memory.buffer, this.w.voo_audio_pos(), NSRC * 3), Math.max(when, this.ctx.currentTime));
      this.sent += n;
    }
    this.g.setCabin(cabin, this.ctx.currentTime);
  }
}

// ---------- principal ----------
async function main() {
  const canvas = $('tela');
  let renderer;
  try { renderer = new Renderer(canvas); }
  catch (e) { $('status').textContent = e.message; $('erro').hidden = false; throw e; }

  setProgress(0.01, 'Carregando...');
  const module = await WebAssembly.compileStreaming(fetch('./voo.wasm'));
  const w = await instantiate(module);
  await generateWorld(module, w);
  setProgress(0.94, 'Enviando o mundo para a placa de video...');
  await new Promise((r) => setTimeout(r, 0));
  w.voo_init(parseInt(params.get('hora') || '2', 10));
  renderer.uploadWorld(w);
  let sunVersion = w.voo_sun_version();
  setProgress(1, '');
  $('carregando').hidden = true;
  $('comecar').hidden = false;

  const sound = new Sound(w);
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    $('inicio').hidden = true;
    sound.start();
    if (!params.has('janela') && document.documentElement.requestFullscreen)
      document.documentElement.requestFullscreen().catch(() => {});
  };
  $('inicio').addEventListener('click', start);

  // teclado
  const down = new Set();
  window.addEventListener('keydown', (e) => {
    if (!started) { if (!e.repeat) start(); e.preventDefault(); return; }
    const k = keyCode(e);
    if (k < 0) return;
    e.preventDefault();
    if (!e.repeat) { w.voo_keypress(k); down.add(k); }
    w.voo_key(k, 1);
  });
  window.addEventListener('keyup', (e) => { const k = keyCode(e); if (k >= 0) { w.voo_key(k, 0); down.delete(k); } });
  window.addEventListener('blur', () => { for (const k of down) w.voo_key(k, 0); down.clear(); });

  // controle
  const prevBtn = new Array(17).fill(false);
  const padName = new Uint8Array(w.memory.buffer, w.voo_pad_name(), 96);
  let lastPad = '';
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { w.voo_pad(0, 0, 0, 0, 0, 0, 0); return; }
    const ax = (i) => (gp.axes[i] || 0);
    const bt = (i) => gp.buttons[i] || { pressed: false, value: 0 };
    w.voo_pad(1, ax(0), ax(1), ax(2), ax(3), bt(6).value, bt(7).value);
    for (const [std, jb] of Object.entries(PAD_MAP)) {
      const on = bt(+std).pressed;
      w.voo_btn(jb, on ? 1 : 0);
      if (on && !prevBtn[std]) { if (!started) start(); else w.voo_btnpress(jb); }
      prevBtn[std] = on;
    }
    const name = 'controle: ' + gp.id.replace(/\s*\(.*$/, '').slice(0, 60);
    if (name !== lastPad) {
      lastPad = name;
      const b = new TextEncoder().encode(name);
      new Uint8Array(w.memory.buffer, w.voo_pad_name(), 96).fill(0).set(b.subarray(0, 95));
    }
  }
  void padName;

  // ---------- laco ----------
  let tPrev = performance.now() / 1000, last = 0, fpsN = 0, fpsT = tPrev;
  const info = () => new Float32Array(w.memory.buffer, w.voo_info(), 80);
  let iw = 0, ih = 0, vrowsPrev = 30;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const t = now / 1000;
    const lim = info()[62] || 0;
    if (lim > 0 && t - last < 1 / lim - 0.002) return;
    last = t;
    const dt = DT_FIXO > 0 ? DT_FIXO : Math.min(0.1, t - tPrev);   /* ?dtfixo=0.05: testes quadro a quadro */
    tPrev = t;
    pollPad();

    // tela e grade de celulas
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(window.innerWidth * dpr), ch = Math.round(window.innerHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const cssW = window.innerWidth;
    const cols = Math.max(125, Math.min(170, Math.round(cssW / 10)));
    const cellW = cw / cols;
    const rows = Math.max(26, Math.floor(ch / (cellW * 2)));
    const I0 = info();
    const pixel = ((I0[59] | 0) + 1) * dpr;          /* tamanho do pixel da imagem 3D */
    const smooth = I0[60] > 0;
    const viewHpx = vrowsPrev * (ch / rows);
    iw = Math.max(64, Math.round(cw / pixel) * (smooth ? 2 : 1));
    ih = Math.max(36, Math.round(viewHpx / pixel) * (smooth ? 2 : 1));

    const cp = w.voo_frame(t, dt, cols, rows, iw, ih);
    const I = info();
    vrowsPrev = I[58] | 0;
    if (I[64] > 0) {   /* "Sair do jogo": volta para a tela inicial */
      started = false;
      $('inicio').hidden = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    if ((I[63] | 0) !== sunVersion) { sunVersion = I[63] | 0; renderer.uploadShadows(w); }
    const npts = w.voo_npoints();
    const points = new Float32Array(w.memory.buffer, w.voo_points(), npts * 7);
    const nfx = w.voo_nfx();
    const fx = new Float32Array(w.memory.buffer, w.voo_fx(), nfx * 8);
    const cells = new Uint32Array(w.memory.buffer, cp, cols * rows * 3);
    renderer.frame({ info: I, points, npts, fx, nfx, cells, cols, rows, vrows: vrowsPrev, iw, ih, smooth });
    sound.pump(I);

    fpsN++;
    if (t - fpsT >= 0.5) { w.voo_set_fps(fpsN / (t - fpsT)); fpsN = 0; fpsT = t; }
  };
  requestAnimationFrame(frame);
  window.__voo = { w, renderer };
}

main().catch((e) => {
  console.error(e);
  $('status').textContent = 'Erro: ' + e.message;
  $('erro').hidden = false;
});
