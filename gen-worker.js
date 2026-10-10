// gen-worker.js - gera uma faixa de linhas do mundo em paralelo (Web Worker).
// Nao precisa de SharedArrayBuffer: cada worker tem sua propria copia do
// WebAssembly e devolve so a sua faixa. O resultado e identico ao da geracao
// feita de uma vez (verificado por hash).
import { instantiate } from './wasm.js';

self.onmessage = async (e) => {
  const m = e.data;
  try {
    const w = await instantiate(m.module);
    const N = w.voo_ter_n();
    const n = (m.y1 - m.y0) * N;
    if (m.task === 'relief') {
      const p = w.voo_gen_relief_band(m.y0, m.y1, m.seed);
      const out = new Float32Array(n);
      out.set(new Float32Array(w.memory.buffer, p, n));
      self.postMessage({ id: m.id, relief: out }, [out.buffer]);
    } else if (m.task === 'material') {
      const gp = w.voo_gen_gnd_alloc();
      new Float32Array(w.memory.buffer, gp, N * N).set(new Float32Array(m.relief));
      w.voo_gen_mid(m.seed);   /* terraplanagem + vilarejos: deterministico, igual ao principal */
      w.voo_gen_material_band(m.y0, m.y1, m.seed);
      const mem = w.memory.buffer;
      const h = new Float32Array(n), canopy = new Uint8Array(n), alb = new Uint8Array(n * 3), mat = new Uint8Array(n);
      h.set(new Float32Array(mem, w.voo_world_ptr(0), n));
      canopy.set(new Uint8Array(mem, w.voo_world_ptr(1), n));
      alb.set(new Uint8Array(mem, w.voo_world_ptr(2), n * 3));
      mat.set(new Uint8Array(mem, w.voo_world_ptr(3), n));
      self.postMessage({ id: m.id, h, canopy, alb, mat }, [h.buffer, canopy.buffer, alb.buffer, mat.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.stack || err) });
  }
};
