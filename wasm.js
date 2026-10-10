// wasm.js - carrega o voo.wasm (compilado como wasm32-wasi) com o minimo de WASI
// que ele usa: escrever no console e pouco mais.

export function wasiImports(getMemory) {
  const dec = new TextDecoder();
  let line = '';
  return {
    wasi_snapshot_preview1: {
      fd_write(fd, iovs, n, nwritten) {
        const mem = getMemory();
        const dv = new DataView(mem.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const ptr = dv.getUint32(iovs + i * 8, true), len = dv.getUint32(iovs + i * 8 + 4, true);
          line += dec.decode(new Uint8Array(mem.buffer, ptr, len));
          total += len;
        }
        let k;
        while ((k = line.indexOf('\n')) >= 0) { (fd === 2 ? console.warn : console.log)('[voo] ' + line.slice(0, k)); line = line.slice(k + 1); }
        dv.setUint32(nwritten, total, true);
        return 0;
      },
      fd_close() { return 0; },
      fd_seek() { return 0; },
      proc_exit(code) { throw new Error('voo.wasm terminou (' + code + ')'); },
    },
  };
}

export async function instantiate(module) {
  let exp = null;
  const inst = await WebAssembly.instantiate(module, wasiImports(() => exp.memory));
  exp = inst.exports;
  if (exp._initialize) exp._initialize();
  return exp;
}
