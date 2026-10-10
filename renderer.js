// renderer.js - WebGL2: dados do mundo viram texturas, o shader faz o raymarching,
// uma passada desenha contornos/costa/retro, outra os pontos da pista, e por cima
// vai a grade de celulas do painel e do menu (mesmo codigo C do terminal).
import { QUAD_VS, SCENE_FS, POST_FS, POINTS_VS, POINTS_FS, BLIT_FS, CELLS_FS, FX_VS, FX_FS } from './shaders.js';

const XTERM = (() => {
  const p = [[0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],
             [128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255]];
  const L = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push([L[r], L[g], L[b]]);
  for (let i = 0; i < 24; i++) { const v = 8 + 10 * i; p.push([v, v, v]); }
  return p.map(([r, g, b]) => ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0);
})();
const COL_NONE = 0x2000000, COL_SHADE = 0x4000000;
function cellColor(c) {
  if (c === COL_NONE) return 0;
  if (c === COL_SHADE) return 0x0000008c;
  if (c & 0x1000000) return ((((c >> 16) & 255) << 24) | (((c >> 8) & 255) << 16) | ((c & 255) << 8) | 255) >>> 0;
  return XTERM[c & 255];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('Seu navegador nao oferece WebGL2.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Seu navegador nao oferece EXT_color_buffer_float.');
    this.gl = gl;
    this.progScene = this.program(QUAD_VS, SCENE_FS);
    this.progPost = this.program(QUAD_VS, POST_FS);
    this.progPts = this.program(POINTS_VS, POINTS_FS);
    this.progBlit = this.program(QUAD_VS, BLIT_FS);
    this.progCells = this.program(QUAD_VS, CELLS_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.ptsBuf = gl.createBuffer();
    // explosao: um quad por particula (instanciado), atributos num VAO proprio
    this.progFx = this.program(FX_VS, FX_FS);
    this.fxBuf = gl.createBuffer();
    this.fxVao = gl.createVertexArray();
    gl.bindVertexArray(this.fxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
    const aP = gl.getAttribLocation(this.progFx, 'aP'), aQ = gl.getAttribLocation(this.progFx, 'aQ');
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(aP, 1);
    gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(aQ, 1);
    gl.bindVertexArray(null);
    this.fb = null;
    this.initAtlas();
  }

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    p.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      p.u[name] = gl.getUniformLocation(p, info.name);
    }
    return p;
  }

  tex(w, h, ifmt, fmt, type, data, filter = 'nearest', mips = false) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  // ---------- dados do mundo ----------
  uploadWorld(w) {
    const gl = this.gl, mem = () => w.memory.buffer;
    const N = w.voo_ter_n(), NN = N * N;
    this.N = N;
    this.tH = this.tex(N, N, gl.R32F, gl.RED, gl.FLOAT, new Float32Array(mem(), w.voo_world_ptr(0), NN));
    const toonP = w.voo_toon_albedo();
    this.tToon = this.tex(N, N, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(mem(), toonP, NN * 4), 'linear', true);
    this.uploadShadows(w);
    this.tMip1 = this.tex(N / 4, N / 4, gl.R32F, gl.RED, gl.FLOAT, new Float32Array(mem(), w.voo_world_ptr(6), NN / 16));
    this.tMip2 = this.tex(N / 32, N / 32, gl.R32F, gl.RED, gl.FLOAT, new Float32Array(mem(), w.voo_world_ptr(7), NN / 1024));
    // predios: 3 texels RGBA32F por caixa, linhas de 1024
    const nb = w.voo_nboxes();
    const bp = w.voo_boxes();
    const texels = Math.max(nb * 3, 1), bh = Math.ceil(texels / 1024);
    const bdata = new Float32Array(1024 * bh * 4);
    bdata.set(new Float32Array(mem(), bp, nb * 12));
    this.tBox = this.tex(1024, bh, gl.RGBA32F, gl.RGBA, gl.FLOAT, bdata);
    const G = w.voo_bgrid_n();
    const st = new Int32Array(mem(), w.voo_world_ptr(8), G * G), ct = new Int32Array(mem(), w.voo_world_ptr(9), G * G);
    const grid = new Int32Array(G * G * 2);
    for (let i = 0; i < G * G; i++) { grid[i * 2] = st[i]; grid[i * 2 + 1] = ct[i]; }
    this.tBGrid = this.tex(G, G, gl.RG32I, gl.RG_INTEGER, gl.INT, grid);
    const ni = w.voo_nbidx(), ih = Math.max(1, Math.ceil(ni / 1024));
    const idx = new Int32Array(1024 * ih);
    idx.set(new Int32Array(mem(), w.voo_world_ptr(10), ni));
    this.tBIdx = this.tex(1024, ih, gl.R32I, gl.RED_INTEGER, gl.INT, idx);
    this.airports = new Float32Array(new Float32Array(mem(), w.voo_airports(), 16));
    const npb = w.voo_plane_nboxes();
    const pb = new Float32Array(mem(), w.voo_plane_boxes(), npb * 11);
    this.planeBoxes = new Float32Array(66 * 4);
    for (let i = 0; i < npb; i++) {
      const b = pb.subarray(i * 11, i * 11 + 11);
      this.planeBoxes.set([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], 0], i * 12);
    }
    this.nPlaneBoxes = npb;
    this.hmax = w.voo_hmax();
  }

  uploadShadows(w) {
    const gl = this.gl, N = w.voo_ter_n(), NN = N * N, mem = w.memory.buffer;
    const sh = new Uint8Array(mem, w.voo_world_ptr(4), NN), ao = new Uint8Array(mem, w.voo_world_ptr(5), NN);
    const sa = new Uint8Array(NN * 2);
    for (let i = 0; i < NN; i++) { sa[i * 2] = sh[i]; sa[i * 2 + 1] = ao[i]; }
    if (this.tSA) gl.deleteTexture(this.tSA);
    this.tSA = this.tex(N, N, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, sa, 'linear', true);
  }

  // ---------- atlas de glifos (fonte do sistema desenhada num canvas) ----------
  initAtlas() {
    this.gw = 24; this.gh = 48; this.acols = 80;
    const c = document.createElement('canvas');
    c.width = this.gw * this.acols; c.height = this.gh * 40;
    this.actx = c.getContext('2d', { willReadFrequently: false });
    this.atlasCanvas = c;
    this.glyphs = new Map();
    this.nglyph = 1;   // 0 = vazio
    const gl = this.gl;
    this.tAtlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, c.width, c.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlasDirty = false;
  }
  glyph(cp) {
    let g = this.glyphs.get(cp);
    if (g !== undefined) return g;
    g = this.nglyph++;
    this.glyphs.set(cp, g);
    const ctx = this.actx, x = (g % this.acols) * this.gw, y = Math.floor(g / this.acols) * this.gh;
    ctx.clearRect(x, y, this.gw, this.gh);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, this.gw, this.gh); ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '36px "DejaVu Sans Mono", "Menlo", "Consolas", "Liberation Mono", monospace';
    ctx.fillText(String.fromCodePoint(cp), x + this.gw / 2, y + this.gh / 2 + 1);
    ctx.restore();
    this.atlasDirty = true;
    return g;
  }

  ensureTargets(w, h) {
    const gl = this.gl;
    if (this.fb && this.fw === w && this.fh === h) return;
    if (this.fb) {
      for (const t of [this.tColor, this.tG, this.tPost]) gl.deleteTexture(t);
      gl.deleteFramebuffer(this.fb); gl.deleteFramebuffer(this.fbPost); gl.deleteFramebuffer(this.fbFx);
    }
    this.fw = w; this.fh = h;
    this.tColor = this.tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.tG = this.tex(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null);
    this.tPost = this.tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, 'linear');
    for (const t of [this.tColor, this.tG, this.tPost]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.tG, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.fbFx = gl.createFramebuffer();      // so a cor da cena: a explosao le a profundidade de tG
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbFx);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tColor, 0);
    this.fbPost = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbPost);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tPost, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bindTex(prog, name, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u[name], unit);
  }
  drawQuad(prog) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // f: { info, points, npts, fx, nfx, cells, cols, rows, vrows, iw, ih, smooth }
  frame(f) {
    const gl = this.gl, I = f.info, W = this.canvas.width, H = this.canvas.height;
    const cellW = W / f.cols, cellH = H / f.rows;
    const viewH = Math.round(f.vrows * cellH);
    this.ensureTargets(f.iw, f.ih);

    // 1) cena
    let p = this.progScene;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, f.iw, f.ih);
    gl.disable(gl.BLEND);
    this.bindTex(p, 'uH', 0, this.tH);
    this.bindTex(p, 'uToon', 1, this.tToon);
    this.bindTex(p, 'uSA', 3, this.tSA);
    this.bindTex(p, 'uMip1', 4, this.tMip1);
    this.bindTex(p, 'uMip2', 5, this.tMip2);
    this.bindTex(p, 'uBox', 6, this.tBox);
    this.bindTex(p, 'uBGrid', 7, this.tBGrid);
    this.bindTex(p, 'uBIdx', 8, this.tBIdx);
    const u = p.u;
    gl.uniform4fv(u.uAp, this.airports);
    gl.uniform3f(u.uCamPos, I[0], I[1], I[2]);
    gl.uniform3f(u.uCamF, I[3], I[4], I[5]);
    gl.uniform3f(u.uCamR, I[6], I[7], I[8]);
    gl.uniform3f(u.uCamU, I[9], I[10], I[11]);
    gl.uniform1f(u.uTanX, I[12]);
    gl.uniform1f(u.uHW, f.ih / f.iw);
    gl.uniform2f(u.uRes, f.iw, f.ih);
    gl.uniform1f(u.uTime, I[14]);
    gl.uniform1i(u.uStyle, I[15]);
    gl.uniform1i(u.uClouds, I[16]);
    gl.uniform1i(u.uCockpit, I[17]);
    gl.uniform1f(u.uViewDist, I[18]);
    gl.uniform1i(u.uRefl, I[19]);
    gl.uniform3f(u.uSun, I[20], I[21], I[22]);
    gl.uniform2f(u.uWind, I[23], I[24]);
    // deslocamento das nuvens pelo vento, reduzido ao tamanho do mundo em double (igual ao C)
    gl.uniform2f(u.uCloudOff, (I[23] * I[14] * 3) % 16384, (I[24] * I[14] * 3) % 16384);
    gl.uniform3f(u.uPPos, I[25], I[26], I[27]);
    gl.uniform3f(u.uPF, I[28], I[29], I[30]);
    gl.uniform3f(u.uPR, I[31], I[32], I[33]);
    gl.uniform3f(u.uPU, I[34], I[35], I[36]);
    gl.uniform1f(u.uProp, I[37]);
    gl.uniform1i(u.uCrashed, I[38]);
    gl.uniform1i(u.uDrawPlane, I[39]);
    gl.uniform3fv(u.uPal, I.subarray(40, 58));
    gl.uniform1f(u.uHmax, this.hmax);
    gl.uniform1f(u.uPix, 2 * I[12] / f.iw);
    gl.uniform4fv(u.uPB, this.planeBoxes);
    gl.uniform1i(u.uNPB, this.nPlaneBoxes);
    this.drawQuad(p);

    // 1b) explosao/fumaca do acidente, por cima da cor da cena (antes do retro)
    if (f.nfx > 0) {
      p = this.progFx;
      gl.useProgram(p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbFx);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // alfa pre-multiplicado (fogo parcialmente aditivo)
      this.bindTex(p, 'uG', 0, this.tG);
      gl.uniform3f(p.u.uCamPos, I[0], I[1], I[2]);
      gl.uniform3f(p.u.uCamF, I[3], I[4], I[5]);
      gl.uniform3f(p.u.uCamR, I[6], I[7], I[8]);
      gl.uniform3f(p.u.uCamU, I[9], I[10], I[11]);
      gl.uniform1f(p.u.uTanX, I[12]);
      gl.uniform1f(p.u.uHW, f.ih / f.iw);
      gl.uniform3f(p.u.uSun, I[20], I[21], I[22]);
      gl.uniform3f(p.u.uLight, I[49], I[50], I[51]);
      gl.uniform3f(p.u.uShade, I[52], I[53], I[54]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
      gl.bufferData(gl.ARRAY_BUFFER, f.fx.subarray(0, f.nfx * 8), gl.STREAM_DRAW);
      gl.bindVertexArray(this.fxVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.nfx);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    // 2) contornos, costa, retro
    p = this.progPost;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbPost);
    this.bindTex(p, 'uColor', 0, this.tColor);
    this.bindTex(p, 'uG', 1, this.tG);
    gl.uniform1i(p.u.uRetro, I[15] === 4 ? 1 : 0);
    this.drawQuad(p);

    // 3) realce da pista (pontos com teste de profundidade)
    if (f.npts > 0) {
      p = this.progPts;
      gl.useProgram(p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.bindTex(p, 'uG', 0, this.tG);
      gl.uniform1f(p.u.uSize, 1.0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptsBuf);
      gl.bufferData(gl.ARRAY_BUFFER, f.points.subarray(0, f.npts * 7), gl.STREAM_DRAW);
      const a1 = gl.getAttribLocation(p, 'aUV'), a2 = gl.getAttribLocation(p, 'aDist'), a3 = gl.getAttribLocation(p, 'aCol');
      gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(a2); gl.vertexAttribPointer(a2, 1, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(a3); gl.vertexAttribPointer(a3, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.POINTS, 0, f.npts);
      gl.disableVertexAttribArray(a1); gl.disableVertexAttribArray(a2); gl.disableVertexAttribArray(a3);
      gl.disable(gl.BLEND);
    }

    // 4) imagem na tela (pixels grandes, ou suavizada)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.08, 0.08, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, H - viewH, W, viewH);
    p = this.progBlit;
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, this.tPost);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f.smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f.smooth ? gl.LINEAR : gl.NEAREST);
    this.bindTex(p, 'uTex', 0, this.tPost);
    this.drawQuad(p);

    // 5) painel, HUD e menu
    this.drawCells(f.cells, f.cols, f.rows, cellW, cellH, W, H);
  }

  drawCells(cells, cols, rows, cellW, cellH, W, H) {
    const gl = this.gl, n = cols * rows;
    if (!this.cellData || this.cellData.length < n * 4) this.cellData = new Uint32Array(n * 4);
    const d = this.cellData;
    for (let i = 0; i < n; i++) {
      const cp = cells[i * 3], fg = cells[i * 3 + 1], bg = cells[i * 3 + 2];
      const isBlock = cp >= 0x2580 && cp <= 0x259f;
      d[i * 4] = (cp === 0 || cp === 32 || isBlock) ? 0 : this.glyph(cp);
      d[i * 4 + 1] = cp === 0 ? 0 : cellColor(fg);
      d[i * 4 + 2] = cellColor(bg);
      d[i * 4 + 3] = cp;
    }
    if (this.atlasDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.tAtlas);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
      this.atlasDirty = false;
    }
    if (!this.tCells || this.cellsW !== cols || this.cellsH !== rows) {
      if (this.tCells) gl.deleteTexture(this.tCells);
      this.tCells = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tCells);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, cols, rows);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.cellsW = cols; this.cellsH = rows;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tCells);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, d.subarray(0, n * 4));
    const p = this.progCells;
    gl.useProgram(p);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tCells); gl.uniform1i(p.u.uCells, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tAtlas); gl.uniform1i(p.u.uAtlas, 1);
    gl.uniform2f(p.u.uCell, cellW, cellH);
    gl.uniform2f(p.u.uScreen, W, H);
    gl.uniform2f(p.u.uAtlasCell, this.gw, this.gh);
    gl.uniform1f(p.u.uAtlasCols, this.acols);
    this.drawQuad(p);
    gl.disable(gl.BLEND);
  }
}
