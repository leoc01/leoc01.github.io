// spatial.js - espacializacao do som no navegador (usado pelo jogo e pelos testes offline).
//
// Cada fonte do aviao entra num PannerNode. Em "fones 3D" ele usa HRTF: filtra o som
// como a cabeca e as orelhas filtram um som que vem daquela direcao (o mesmo principio do
// "audio 8D"), entao com fones o motor parece estar na frente, a buzina de estol em cima
// a esquerda, e o aviao passando atravessa de um lado para o outro. Em "alto-falantes" o
// panner usa so a diferenca de volume entre os canais (melhor para caixas de som).
// A distancia, o atraso (Doppler), o reflexo no chao e o isolamento da cabine ja vem
// calculados do C; aqui os panners so dao a direcao (sem atenuar de novo).
// Por cima, uma ambiencia por convolucao: fora, ecos esparsos do terreno e uma cauda
// longa e baixa; na cabine, reflexoes curtas e densas de um espaco pequeno.

export const NSRC = 8;           // AS_COUNT no C
export const WIND = 2;           // AS_WIND: sem posicao, estereo
export const OUT_CHANNELS = [1, 1, 2, 1, 1, 1, 1, 1];

// resposta ao impulso sintetica (estereo, descorrelacionada)
function makeIR(ctx, kind) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (kind === 'cabine' ? 0.18 : 1.9));
  const buf = ctx.createBuffer(2, len, sr);
  let seed = kind === 'cabine' ? 7 : 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    if (kind === 'cabine') {
      // espaco de ~1 m: reflexoes nos primeiros ms, decaimento rapido, um pouco abafado
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        lp += 0.45 * (rnd() - lp);
        d[i] = lp * Math.exp(-t / 0.028) * (t < 0.0015 ? 0 : 1);
      }
      for (let k = 0; k < 10; k++) {
        const i = Math.floor(sr * (0.002 + 0.007 * Math.abs(rnd())));
        d[i] += 0.5 * rnd();
      }
    } else {
      // campo aberto: ecos discretos do terreno e predios + cauda difusa longa e escura
      const pre = Math.floor(sr * 0.03);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const a = 0.12 + 0.88 * Math.exp(-t * 3.0);   // agudos somem com o tempo
        lp += a * 0.35 * (rnd() - lp);
        d[i] = lp * Math.exp(-t / 0.55) * 0.6;
      }
      for (let k = 0; k < 9; k++) {
        const t = 0.06 + 0.5 * Math.abs(rnd()) ** 1.5;
        const i = Math.floor(sr * t);
        const g = 0.5 * Math.exp(-t * 2.5) * (rnd() > 0 ? 1 : -1);
        for (let j = 0; j < 40; j++) d[i + j] += g * Math.exp(-j / 8) * (j % 2 ? -0.5 : 1);
      }
    }
    // normaliza a energia
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    const g = 1 / Math.sqrt(e + 1e-9);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

// monta o grafo: connect(s, pannerOuGanho) liga a saida da fonte s na entrada dada
export function buildGraph(ctx, connect, dest = ctx.destination) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -9; lim.knee.value = 6; lim.ratio.value = 10;
  lim.attack.value = 0.003; lim.release.value = 0.15;
  master.connect(lim);
  lim.connect(dest);

  const send = ctx.createGain();
  const convOut = ctx.createConvolver(), convCab = ctx.createConvolver();
  convOut.normalize = false; convCab.normalize = false;
  convOut.buffer = makeIR(ctx, 'fora');
  convCab.buffer = makeIR(ctx, 'cabine');
  const sendOut = ctx.createGain(), sendCab = ctx.createGain();
  sendOut.gain.value = 0.22; sendCab.gain.value = 0;
  send.connect(sendOut); send.connect(sendCab);
  sendOut.connect(convOut); sendCab.connect(convCab);
  convOut.connect(master); convCab.connect(master);

  const panners = [];
  for (let s = 0; s < NSRC; s++) {
    if (s === WIND) {
      const g = ctx.createGain();
      connect(s, g);
      g.connect(master);
      panners.push(null);
      continue;
    }
    const p = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0,
      refDistance: 1, maxDistance: 100000, positionX: 0, positionY: 0, positionZ: -1,
    });
    connect(s, p);
    p.connect(master);
    p.connect(send);
    panners.push(p);
  }
  const L = ctx.listener;
  if (L.forwardX) { L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else L.setOrientation(0, 0, -1, 0, 1, 0);

  return {
    master, panners, sendOut, sendCab,
    setMode(mode) {   // 1 alto-falantes, 2 fones 3D
      const m = mode === 2 ? 'HRTF' : 'equalpower';
      for (const p of panners) if (p && p.panningModel !== m) p.panningModel = m;
    },
    // pos: Float32Array NSRC*3 (x direita, y cima, -z frente), no instante 'when'
    setPositions(pos, when, tc = 0.015) {
      for (let s = 0; s < NSRC; s++) {
        const p = panners[s];
        if (!p) continue;
        let x = pos[s * 3], y = pos[s * 3 + 1], z = pos[s * 3 + 2];
        const r = Math.hypot(x, y, z);
        if (r < 1e-3) { x = 0; y = 0; z = -1; } else { x /= r; y /= r; z /= r; }   // so a direcao
        p.positionX.setTargetAtTime(x, when, tc);
        p.positionY.setTargetAtTime(y, when, tc);
        p.positionZ.setTargetAtTime(z, when, tc);
      }
    },
    setCabin(k, when) {
      sendOut.gain.setTargetAtTime(0.22 * (1 - k), when, 0.1);
      sendCab.gain.setTargetAtTime(0.35 * k, when, 0.1);
    },
  };
}
