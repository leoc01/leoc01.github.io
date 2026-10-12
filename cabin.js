// cabin.js - a cabine do Cessna como malha 3D de verdade (triangulos), so na camera de cabine.
//
// O mundo continua sendo tracado por raios em baixa resolucao; a cabine e rasterizada por cima,
// na resolucao da tela, com:
//   - sombra do sol (mapa de sombra): a luz entra pelas janelas e desenha manchas no painel e
//     nos bancos, e a asa faz sombra no capo quando o sol esta baixo;
//   - oclusao ambiente por vertice (cantos e vaos mais escuros), calculada uma vez com um
//     campo de distancia simplificado da cabine;
//   - luz em faixas (mesmo estilo ilustrado do resto) e contorno de desenho nas bordas;
//   - o aviao visto de dentro: capo, spinner, helice (disco translucido com rastro das pas),
//     asas com flaps e ailerons que se mexem, montantes e a cauda pela janela de tras.
// Antes de tracar o mundo, uma mascara da cabine em baixa resolucao marca os pixels cobertos
// (encolhida 1 pixel nas bordas) e o teste de profundidade pula o raymarching ali.
//
// Referencial do aviao: x para frente, y para a direita, z para cima (metros, origem no CG).
import { MAT_I, VF, Mesh, SDF, add, sub, mul, dot, cross, len, norm, sstep } from './malha.js';
import { MIRROR, rightPersonMatrices, shellInner, SHELL_GLSL, PAINT_GLSL, buildStatic, buildExterior, buildOutside, buildHead, buildGlass, buildProp, buildParts, partMatrices, handTarget } from './aviao.js';
import { PanelArt } from './cockpit.js';
import { VidaGfx } from './vida.js';

const MESH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec3 aCol;
layout(location = 3) in float aMat;
layout(location = 4) in vec2 aUV;
layout(location = 5) in float aAO;
uniform vec3 uEye, uVF, uVR, uVU;   // olho e eixos da camera, no referencial do aviao
uniform float uTanX, uHW;
uniform vec2 uNF;                   // planos perto e longe (de fora a camera fica longe)
uniform mat4 uModel;                // parte movel (manche, flaps...): rotacao + translacao
uniform mat4 uRefl;                 // espelho na agua (identidade fora da passada do reflexo)
uniform vec3 uEyeP;                 // olho da projecao (no reflexo uEye e o olho espelhado, para iluminar)
out vec3 vPos, vNrm, vCol;
out vec2 vUV;
out float vMat, vAO;
void main() {
    vec3 P = (uModel * vec4(aPos, 1.0)).xyz;
    vec3 d = (uRefl * vec4(P, 1.0)).xyz - uEyeP;
    float x = dot(d, uVR), y = dot(d, uVU), z = dot(d, uVF);
    float n = uNF.x, f = uNF.y;
    gl_Position = vec4(x / uTanX, y / (uTanX * uHW), z * (f + n) / (f - n) - 2.0 * f * n / (f - n), z);
    vPos = P; vNrm = mat3(uModel) * aNrm; vCol = aCol; vUV = aUV; vMat = aMat; vAO = aAO;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPos, vNrm, vCol;
in vec2 vUV;
in float vMat, vAO;
uniform vec3 uEye, uSunB, uLight, uShade;
uniform float uSunUp, uProp, uSweep;
uniform float uPanelLight, uNavOn;   // luzes do painel (0..1) e de navegacao acesas
uniform float uOutside, uBurnt;      // camera fora do aviao; destroco queimado
uniform mat4 uShM;
uniform sampler2DShadow uShadow;
uniform sampler2D uAtlas;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${SHELL_GLSL}
// linha fina sem serrilhado: quando fica menor que um pixel, some aos poucos em vez de virar tracejado
float aaLine(float d, float w) { float fw = max(fwidth(d), 1e-5); return (1.0 - smoothstep(w, w + fw * 1.2, abs(d))) * clamp(w / fw, 0.0, 1.0); }
float shadowAt(vec3 p, vec3 n) {
    vec4 s = uShM * vec4(p + n * 0.012, 1.0);
    vec3 q = s.xyz * 0.5 + 0.5;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
    vec2 o = 0.75 / vec2(textureSize(uShadow, 0));
    float k = texture(uShadow, vec3(q.xy + vec2(-o.x, -o.y), q.z)) + texture(uShadow, vec3(q.xy + vec2(o.x, -o.y), q.z))
            + texture(uShadow, vec3(q.xy + vec2(-o.x, o.y), q.z)) + texture(uShadow, vec3(q.xy + vec2(o.x, o.y), q.z));
    return k * 0.25;
}
${PAINT_GLSL}
void main() {
    int mat = int(vMat + 0.5);
    vec3 V = normalize(uEye - vPos);
    vec3 n = normalize(vNrm);
    if (mat == 2 && shellOpen(vPos) < 0.0) discard;
    bool paint = mat >= 10, skin = mat == 11;
    if (mat == 10 && cowlInside(vPos)) discard;   // capo: o pedaco que cairia dentro da cabine some
    if (skin && skinCut(vPos)) discard;   // pele de fora: as mesmas janelas
    if (paint) mat = 5;
    if (mat == 7 || mat == 8) {   // vidro: um veu bem fraco, mais forte de raspao (Fresnel), e faixas de reflexo
        if (mat == 7 && (shellOpen(vPos) >= 0.0 || vPos.x > xw(vPos.y, vPos.z) - 0.01)) discard;
        if (mat == 8 && wshieldCut(vPos)) discard;   // recorta o para-brisa na secao da cabine
        float c = abs(dot(n, V));
        float fres = pow(1.0 - c, 4.0);
        float k = dot(vPos, vec3(1.1, 1.9, 3.1)) + dot(V, vec3(0.6, 1.3, 0.4));
        float streak = smoothstep(0.55, 1.0, sin(k * 2.2)) * smoothstep(0.3, 1.0, sin(k * 0.7 + 1.0));
        float dayG = mix(0.2, 1.0, smoothstep(0.45, 0.9, dot(uLight, vec3(0.3, 0.5, 0.2))));
        float al = 0.025 + 0.22 * fres + 0.045 * streak * uSunUp;
        vec3 col = mix(vec3(0.82, 0.88, 0.98), uLight, 0.5) * dayG;
        if (uOutside > 0.5) {   // de fora: vidro esverdeado escuro que reflete o ceu, o interior aparece de leve
            vec3 r = reflect(-V, n);
            vec3 skyc = mix(vec3(0.55, 0.68, 0.85), vec3(0.85, 0.92, 1.0), smoothstep(-0.1, 0.6, r.z)) * dayG;
            al = 0.42 + 0.45 * fres + 0.12 * streak * uSunUp;
            col = mix(vec3(0.08, 0.12, 0.14) * dayG, skyc, 0.35 + 0.55 * fres);
        }
        oC = vec4(col * al, al);
        oA = vec4(0.0);
        return;
    }
    if (mat == 4) {   // disco da helice: rastro das pas no ultimo quadro + pontas pintadas
        vec2 q = vPos.yz - vec2(0.0, 0.02);
        float r = length(q), a = atan(q.y, q.x);
        float bw = 0.075 / max(r, 0.1) * (1.0 - 0.45 * smoothstep(0.75, 0.96, r));   // largura angular da pa
        float rel = mod(uProp - a, 3.14159265);
        float cov = uSweep <= bw ? step(rel, bw) : (rel < uSweep ? bw / uSweep : 0.0);
        cov = min(cov * 1.5, 1.0) * (1.0 - smoothstep(0.945, 0.96, r));
        vec3 col = r > 0.86 ? vec3(0.95, 0.80, 0.18) : vec3(0.10, 0.10, 0.11);
        float al = cov * (uSweep > 1.0 ? (r > 0.86 ? 1.6 : 0.9) : 1.0);
        al = min(al, 0.85);
        float L = mix(0.55, 1.0, uSunUp) * mix(0.25, 1.0, smoothstep(0.45, 0.9, dot(uLight, vec3(0.3, 0.5, 0.2))));
        oC = vec4(col * L * al, al);
        oA = vec4(0.0);
        return;
    }
    if (dot(n, V) < 0.0) n = -n;   // superficies vistas dos dois lados
    vec3 base = vCol;
    if (mat == 1) { vec4 t = texture(uAtlas, vUV); if (t.a < 0.5) discard; base = t.rgb; }
    else if (mat == 2) base = shellColor(vPos, normalize(vNrm));
    else if (paint) {
        base = livery(vPos, base);
        if (skin) {   // borracha das janelas e vincos das portas, vistos de fora
            float d = shellOpen(vPos);
            base = mix(base, vec3(0.16, 0.16, 0.17), 1.0 - smoothstep(0.022, 0.022 + max(fwidth(d), 1e-4), d));
            if (abs(vPos.y) > 0.4) {
                float l = aaLine(vPos.x - 0.075, 0.003) * step(-0.36, vPos.z) * step(vPos.z, 0.80);
                l = max(l, aaLine(vPos.z + 0.36, 0.003) * step(0.075, vPos.x) * step(vPos.x, 1.10));
                base *= 1.0 - 0.4 * l;
            }
        }
    }
    else if (mat == 3) {   // tecido com pregas
        float f = fract(vUV.x / 0.065);
        float seam = 1.0 - smoothstep(0.0, max(0.14, fwidth(vUV.x / 0.065) * 1.5), min(f, 1.0 - f));
        base *= 1.0 - 0.32 * seam;
    }
    float ndl = max(dot(n, uSunB), 0.0);
    float sh = shadowAt(vPos, n) * uSunUp;
    float e = ndl * sh;
    float band = 0.62 * smoothstep(0.08, 0.15, e) + 0.38 * smoothstep(0.40, 0.48, e);
    bool ext = mat == 5;
    float ao = vAO;
    vec3 amb = (ext ? uShade : mix(uShade, uLight, 0.28)) * ao;   // dentro: um pouco de luz rebatida
    vec3 L = mix(amb, uLight * mix(1.0, ao, 0.35), band);
    float day = smoothstep(0.55, 0.95, dot(uLight, vec3(0.3, 0.5, 0.2)));
    // de dia os instrumentos ficam sempre legiveis; de noite so com a luz do painel (vermelho-ambar)
    if (mat == 1) L = max(mix(L, uLight, 0.55 * day), max(vec3(0.42, 0.36, 0.32) * day, vec3(0.62, 0.36, 0.28) * uPanelLight));
    else if (mat != 5 && mat != 9) L += vec3(0.10, 0.035, 0.025) * uPanelLight * ao;   // a luz do painel respinga na cabine
    if (mat == 9 && uNavOn > 0.5) { oC = vec4(min(base * 1.6, vec3(1.0)), 1.0); oA = vec4(n, length(vPos - uEye)); return; }
    vec3 col = base * L;
    if (mat == 6) {   // cromado: brilho do ceu e do sol
        vec3 r = reflect(-V, n);
        col = base * mix(amb, uLight, 0.35) + vec3(0.35) * smoothstep(0.2, 0.9, r.z) * mix(0.4, 1.0, uSunUp)
            + vec3(0.8) * pow(max(dot(r, uSunB), 0.0), 24.0) * sh;
    }
    col *= mix(1.0, 0.22, uBurnt);
    oC = vec4(min(col, vec3(1.0)), 1.0);
    oA = vec4(n, length(vPos - uEye));
}`;

const MASK_FS = `#version 300 es
precision highp float;
in vec3 vPos, vNrm, vCol;
in vec2 vUV;
in float vMat, vAO;
uniform vec3 uEye;
out vec4 oD;
${SHELL_GLSL}
void main() {
    int mt = int(vMat + 0.5);
    if (((mt == 2 || mt == 11) && shellOpen(vPos) < 0.0) || (mt == 10 && cowlInside(vPos)) || (mt == 1 && panelCut(vPos))) discard;
    oD = vec4(length(vPos - uEye), 0.0, 0.0, 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 3) in float aMat;
uniform mat4 uShM, uModel;
out vec3 vPos;
out float vMat;
void main() { vPos = (uModel * vec4(aPos, 1.0)).xyz; vMat = aMat; gl_Position = uShM * vec4(vPos, 1.0); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in float vMat;
out vec4 o;
${SHELL_GLSL}
void main() { int mt = int(vMat + 0.5); if (((mt == 2 || mt == 11) && shellOpen(vPos) < 0.0) || (mt == 10 && cowlInside(vPos)) || (mt == 1 && panelCut(vPos))) discard; o = vec4(1.0); }`;

// marca, no G-buffer da cena (baixa resolucao), os pixels que a cabine cobre por inteiro:
// profundidade 0 (o raymarching depois e pulado pelo teste de profundidade) e tipo 7
const MARK_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oG;
void main() {
    ivec2 q = ivec2(gl_FragCoord.xy), sz = textureSize(uMask, 0);
    float d = texelFetch(uMask, q, 0).r;
    if (d <= 0.0) discard;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
        if (texelFetch(uMask, clamp(q + ivec2(i, j), ivec2(0), sz - 1), 0).r <= 0.0) discard;
    oColor = vec4(0.1, 0.1, 0.11, 1.0);
    oG = vec4(d, 7.0, 0.0, 0.0);
    gl_FragDepth = 0.0;
}`;

// composicao na tela: contorno de desenho nas silhuetas, degraus de profundidade e quinas
const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uC, uA, uG;   // cabine/aviao (cor e normal+distancia) e G-buffer do mundo (baixa resolucao)
uniform sampler2D uR;           // reflexo do aviao na agua (meia resolucao)
uniform float uROn, uT;
uniform vec2 uOrigin, uGS;      // uGS: escala da tela para o G-buffer
uniform int uLine;
out vec4 oColor;
// reflexo: so nos pixels de agua, com uma ondulacao leve e um pouco mais escuro e azulado
vec4 reflAt(ivec2 p, ivec2 sz, int k) {
    if (uROn < 0.5 || k != 3) return vec4(0.0);
    vec2 q = vec2(p) + 0.5;
    q.x += sin(q.y * 0.21 + uT * 2.3) * 1.6 + sin(q.y * 0.067 - uT * 1.4) * 1.2;
    vec4 r = texture(uR, q / vec2(sz));
    return vec4(r.rgb * vec3(0.84, 0.90, 0.95), r.a) * 0.8;
}
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy - uOrigin), sz = textureSize(uC, 0);
    vec4 c = texelFetch(uC, p, 0);
    vec4 a = texelFetch(uA, p, 0);
    vec4 g = texelFetch(uG, ivec2(vec2(p) * uGS), 0);
    int k = int(g.y + 0.5);
    vec4 r = reflAt(p, sz, k);
    if (a.w > 0.0) {   // atras de um morro ou predio (vista de fora): o mundo esconde o aviao
        if (k != 0 && k != 1 && k != 7 && g.x < a.w - 0.3) { oColor = r; return; }
    }
    if (a.w > 0.0) {
        float edge = 0.0;
        ivec2 D[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
        for (int k = 0; k < 4; k++) {
            vec4 b = texelFetch(uA, clamp(p + D[k] * uLine, ivec2(0), sz - 1), 0);
            vec4 bo = texelFetch(uA, clamp(p - D[k] * uLine, ivec2(0), sz - 1), 0);
            if (b.w <= 0.0) { edge = 1.0; continue; }
            float lap = b.w + (bo.w > 0.0 ? bo.w : a.w) - 2.0 * a.w;
            if (b.w > a.w * 1.03 + 0.004 && lap > 0.025 * a.w) edge = 1.0;
            else if (dot(a.xyz, b.xyz) < 0.55 && b.w > a.w - 0.002) edge = max(edge, 0.7);
        }
        c.rgb = mix(c.rgb, c.rgb * 0.30 + vec3(0.02, 0.02, 0.045), edge * 0.85);
    }
    oColor = vec4(c.rgb + (1.0 - c.a) * r.rgb, c.a + (1.0 - c.a) * r.a);
}`;

// ---------------------------------------------------------------------------
// a cabine
// ---------------------------------------------------------------------------
export class Cabin {
  constructor(gl, compile) {
    this.gl = gl;
    this.progMain = compile(MESH_VS, MAIN_FS);
    this.progMask = compile(MESH_VS, MASK_FS);
    this.progShadow = compile(SHADOW_VS, SHADOW_FS);
    this.progCompose = compile(QUAD, COMPOSE_FS);
    this.progMark = compile(QUAD, MARK_FS);
    this.art = new PanelArt(gl);
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (this.aniso) {
      gl.bindTexture(gl.TEXTURE_2D, this.art.tex);
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    const t0 = performance.now();
    const st = new Mesh(), sdf = new SDF(shellInner);
    buildStatic(st, sdf);
    st.bakeAO(sdf);
    buildExterior(st);
    this.buildMs = performance.now() - t0;
    this.stat = this.upload(st, gl.STATIC_DRAW);
    const pr = new Mesh();
    buildProp(pr);
    this.prop = this.upload(pr, gl.STATIC_DRAW);
    const om = new Mesh();
    buildOutside(om);
    this.outsideMesh = this.upload(om, gl.STATIC_DRAW);
    const hm = new Mesh();
    buildHead(hm);
    this.headMesh = this.upload(hm, gl.STATIC_DRAW);
    this.outside = false;
    const gm = new Mesh();
    buildGlass(gm);
    this.glass = this.upload(gm, gl.STATIC_DRAW);
    this.parts = buildParts().map((q) => ({ name: q.name, group: q.group, buf: this.upload(q.m, gl.STATIC_DRAW) }));
    this.ntris = (st.i.length + pr.i.length) / 3 + this.parts.reduce((a, q) => a + q.buf.count / 3, 0);
    this.M = partMatrices({ elev: 0, ail: 0, thr: 0, lever: 0, rud: 0, flap: 0, trim: 0 });
    this.body = true;
    // mapa de sombra
    this.SH = 1024;
    this.shTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.SH, this.SH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastT = performance.now();
    this.lastArt = 0;
    this.vida = new VidaGfx(this);   // trem, trilhos e gaivotas
  }

  upload(m, usage, old) {
    const gl = this.gl;
    const o = old || { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer() };
    gl.bindVertexArray(o.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, o.vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.v), usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(m.i), usage);
    const S = VF * 4;
    const at = [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 1, 36], [4, 2, 40], [5, 1, 48]];
    for (const [l, n, off] of at) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); }
    gl.bindVertexArray(null);
    o.count = m.i.length;
    return o;
  }

  draw(o) {
    const gl = this.gl;
    gl.bindVertexArray(o.vao);
    gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_INT, 0);
  }
  // tudo que e opaco: a parte fixa e cada parte movel com a sua matriz
  // com dois no aviao, a pessoa da direita e o mesmo corpo espelhado (M2); a cabeca de quem
  // olha (camera de cabine) nao e desenhada, e o corpo dele some quando olha para tras
  drawAll(p) {
    const gl = this.gl, loc = p.u.uModel;
    const own = this.outside ? -1 : this.mySeat;
    gl.uniformMatrix4fv(loc, false, MAT_I);
    this.draw(this.stat);
    if (this.outside) this.draw(this.outsideMesh);
    if (own !== 0) this.draw(this.headMesh);
    if (this.two && own !== 1) { gl.uniformMatrix4fv(loc, false, MIRROR); this.draw(this.headMesh); }
    for (const q of this.parts) {
      if (q.group === 'body2') {
        if (!this.two || (own === 1 && !this.body)) continue;
        gl.uniformMatrix4fv(loc, false, this.M['ped1' + q.name.slice(5)]);
        this.draw(q.buf);
        continue;
      }
      if (q.group === 'body') {
        if (!(own === 0 && !this.body)) { gl.uniformMatrix4fv(loc, false, this.M[q.name]); this.draw(q.buf); }
        if (this.two && this.M2 && !(own === 1 && !this.body)) { gl.uniformMatrix4fv(loc, false, this.M2[q.name]); this.draw(q.buf); }
        continue;
      }
      gl.uniformMatrix4fv(loc, false, this.M[q.name]);
      this.draw(q.buf);
    }
  }

  // estado do quadro: painel, partes moveis, camera e sol no referencial do aviao, sombra
  // outside: camera fora do aviao (externa, torre, acidente): o aviao inteiro, com pele e trem de pouso
  prepare(I, iw, ih, outside) {
    const gl = this.gl, now = performance.now();
    this.dt = Math.min(Math.max((now - this.lastT) / 1000, 0.004), 0.1);
    this.lastT = now;
    if (now - this.lastArt > 30) {
      this.kts = this.kts === undefined ? I[67] : this.kts + (I[67] - this.kts) * (1 - Math.exp(-(now - this.lastArt) / 350));   // inercia do ponteiro
      this.art.update({ kt: this.kts, ft: I[68], hdg: I[69], pitch: I[70], roll: I[71], fpm: I[72], rpm: I[73], flaps: I[74], trim: I[75], turn: I[76], slip: I[77], lights: I[88] });
      this.lastArt = now;
    }
    const PF = [I[28], I[29], I[30]], PR = [I[31], I[32], I[33]], PU = [I[34], I[35], I[36]];
    const toB = (v) => [dot(v, PF), dot(v, PR), dot(v, PU)];
    this.vf = toB([I[3], I[4], I[5]]); this.vr = toB([I[6], I[7], I[8]]); this.vu = toB([I[9], I[10], I[11]]);
    this.outside = !!outside;
    if (outside) {   // olho no referencial do aviao a partir das posicoes no mundo
      const d = [I[0] - I[25], I[1] - I[26], I[2] - I[27]];
      this.eye = [dot(d, [I[28], I[29], I[30]]), dot(d, [I[31], I[32], I[33]]), dot(d, [I[34], I[35], I[36]])];
    } else this.eye = [I[83], I[84], I[85]];
    // reflexo na agua (nivel do mar z = 0): R(P) = A P + t no referencial do aviao, A = B^T S B
    this.reflOn = false;
    if (outside && I[27] < 350) {
      const B = [PF, PR, PU], A = new Float32Array(16), t = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) A[j * 4 + i] = B[i][0] * B[j][0] + B[i][1] * B[j][1] - B[i][2] * B[j][2];
        t[i] = -2 * I[27] * B[i][2];
      }
      A[12] = t[0]; A[13] = t[1]; A[14] = t[2]; A[15] = 1;
      this.reflM = A;
      this.reflOn = true;
    }
    const de = len(this.eye);
    this.nf = outside ? [Math.max(0.05, (de - 8) * 0.5), de + 12] : [0.02, 60];
    this.burnt = I[38] > 0.5 ? 1 : 0;
    this.tanX = I[12]; this.hw = ih / iw;
    const sun = [I[20], I[21], I[22]];
    this.sunB = norm(toB(sun));
    this.sunUp = sstep(-0.03, 0.06, sun[2]);
    this.light = [I[49], I[50], I[51]]; this.shade = [I[52], I[53], I[54]];
    this.propA = I[37];
    this.rpm = I[73];
    this.lights = I[88];
    this.panelLight = this.lights >= 1 ? 1 : 0;
    this.sweep = Math.min(Math.max(I[73] / 60 * Math.PI * 2 * this.dt, 0), Math.PI);
    // olhando para tras o corpo do piloto some (o tronco gira junto com a cabeca)
    const yaw = Math.atan2(this.vf[1], this.vf[0]);
    this.body = outside || Math.abs(yaw) < 1.45;
    const bf = I[94] > 0 ? I[94] * 0.06 * Math.sin(now * 0.023 * 6.283) : 0;   // manche tremendo (glissada com flaps > 20)
    const st = { elev: I[78] + bf, ail: I[79], thr: I[80], lever: I[81], rud: I[82], flap: I[74] / 30, trim: I[75] };
    // mao direita: vai mexer na alavanca dos flaps ou na roda do trim e depois volta para a manete
    this.clock = (this.clock || 0) + this.dt;   // relogio proprio (passo limitado): igual ao real a 60 fps
    const tk = this.clock * 1000;
    // alavanca dos flaps: a mao vai rapido ate ela; a alavanca so muda quando a mao chega e,
    // logo em seguida, a mao volta (o motor dos flaps continua trabalhando sozinho)
    // reinicio/cenario novo (o aviao pula): a alavanca ja vai para a posicao certa, sem a mao
    const pp = [I[25], I[26], I[27]];
    if (this.prevPos && Math.hypot(pp[0] - this.prevPos[0], pp[1] - this.prevPos[1], pp[2] - this.prevPos[2]) > 50) this.leverVis = undefined;
    this.prevPos = pp;
    if (this.leverVis === undefined) { this.leverVis = this.leverPos = st.lever; this.lastTrim = st.trim; this.trimT = this.holdT = 0; this.leverWait = 0; }
    if (Math.abs(st.trim - this.lastTrim) > 1e-5) this.trimT = tk + 900;
    this.lastTrim = st.trim;
    const pending = st.lever !== this.leverVis;
    let want = 'thr';
    if (pending) {
      want = 'lever';
      this.leverWait += this.dt;
      const at = handTarget('lever', { ...st, lever: this.leverPos });
      if (len(sub(this.hand || at, at)) < 0.02 || this.leverWait > 0.6) { this.leverVis = st.lever; this.holdT = tk + 220; this.leverWait = 0; }
    } else if (tk < this.holdT) want = 'lever';
    else if (tk < this.trimT) want = 'trim';
    this.leverPos += (this.leverVis - this.leverPos) * (1 - Math.exp(-this.dt * 18));   // a alavanca desliza com a mao
    st.lever = this.leverPos;
    const tgt = handTarget(want, st);
    if (!this.hand) this.hand = tgt;
    const kh = 1 - Math.exp(-this.dt * (want === 'thr' ? 9 : 14));
    this.hand = add(this.hand, mul(sub(tgt, this.hand), kh));
    // dois no aviao: quem pilota usa as maos nos comandos; o outro deixa as maos no colo
    this.two = I[100] > 0.5;
    this.mySeat = this.two ? I[99] | 0 : 0;
    const fly = this.two ? I[101] | 0 : 0;
    st.lap = fly !== 0;
    st.hand = fly === 0 ? this.hand : null;
    this.M = partMatrices(st);
    this.M2 = this.two ? rightPersonMatrices(st, { lap: fly !== 1, hand: fly === 1 ? this.hand : null }) : null;
    // matriz da sombra: projecao ortografica ao longo do sol, ~8 m em volta da cabine
    const Ls = this.sunB, hint = Math.abs(Ls[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
    const lx = norm(cross(hint, Ls)), ly = cross(Ls, lx), C = [-1.15, 0, 0.3], E = 6.4, Dz = 12;   // o aviao inteiro (a sombra no chao vem daqui tambem)
    this.shM = new Float32Array([
      lx[0] / E, ly[0] / E, -Ls[0] / Dz, 0,
      lx[1] / E, ly[1] / E, -Ls[1] / Dz, 0,
      lx[2] / E, ly[2] / E, -Ls[2] / Dz, 0,
      -dot(C, lx) / E, -dot(C, ly) / E, dot(C, Ls) / Dz, 1,
    ]);
    // passada da sombra
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFB);
    gl.viewport(0, 0, this.SH, this.SH);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3.0);
    const p = this.progShadow;
    gl.useProgram(p);
    gl.uniformMatrix4fv(p.u.uShM, false, this.shM);
    if (this.sunUp > 0) { const o = this.outside; this.outside = true; this.drawAll(p); this.outside = o; }   // sombra sempre do aviao inteiro
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  camUniforms(p) {
    const gl = this.gl, u = p.u;
    gl.uniform3fv(u.uEye, this.eye);
    gl.uniform3fv(u.uEyeP, this.eye);
    gl.uniformMatrix4fv(u.uRefl, false, MAT_I);
    gl.uniform3fv(u.uVF, this.vf);
    gl.uniform3fv(u.uVR, this.vr);
    gl.uniform3fv(u.uVU, this.vu);
    gl.uniform1f(u.uTanX, this.tanX);
    gl.uniform1f(u.uHW, this.hw);
    if (u.uNF) gl.uniform2f(u.uNF, this.nf[0], this.nf[1]);
  }

  // alvos: mascara em baixa resolucao e a cabine na resolucao da tela
  targets(iw, ih, W, H) {
    const gl = this.gl;
    if (this.mw !== iw || this.mh !== ih) {
      if (this.mFB) { gl.deleteFramebuffer(this.mFB); gl.deleteTexture(this.mTex); gl.deleteRenderbuffer(this.mRB); }
      this.mw = iw; this.mh = ih;
      this.mTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.mTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, iw, ih);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.mRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.mRB);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, iw, ih);
      this.mFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.mRB);
    }
    if (this.cw !== W || this.ch !== H) {
      if (this.cFB) { gl.deleteFramebuffer(this.cFB); gl.deleteTexture(this.cTex); gl.deleteTexture(this.aTex); gl.deleteRenderbuffer(this.cRB); }
      this.cw = W; this.ch = H;
      const mk = (fmt) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, W, H);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return t;
      };
      this.cTex = mk(gl.RGBA8);
      this.aTex = mk(gl.RGBA16F);
      this.cRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.cRB);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      this.cFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.aTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.cRB);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // mascara da cabine em baixa resolucao (distancia ate a malha, 0 = nada)
  maskPass(iw, ih) {
    const gl = this.gl, p = this.progMask;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mFB);
    gl.viewport(0, 0, iw, ih);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(p);
    this.camUniforms(p);
    this.drawAll(p);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  // no FBO da cena (ja ligado, com profundidade limpa): marca os pixels cobertos
  markPass(drawQuad) {
    const gl = this.gl, p = this.progMark;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mTex);
    gl.uniform1i(p.u.uMask, 0);
    drawQuad(p);
    gl.disable(gl.DEPTH_TEST);
  }

  // a cabine na resolucao da tela
  mainPass(W, H, refl) {
    const gl = this.gl, p = this.progMain;
    gl.bindFramebuffer(gl.FRAMEBUFFER, refl ? this.rFB : this.cFB);
    gl.viewport(0, 0, W, H);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(p);
    this.camUniforms(p);
    const u = p.u;
    if (refl) {   // projeta o aviao espelhado; ilumina o aviao normal visto do olho espelhado
      const A = this.reflM, e = this.eye, re = [0, 1, 2].map((i) => A[i] * e[0] + A[4 + i] * e[1] + A[8 + i] * e[2] + A[12 + i]);
      gl.uniform3fv(u.uEye, re);
      gl.uniformMatrix4fv(u.uRefl, false, A);
      const dc = Math.hypot(A[12] - e[0], A[13] - e[1], A[14] - e[2]);
      gl.uniform2f(u.uNF, Math.max(0.05, (dc - 8) * 0.5), dc + 12);
    }
    gl.uniform3fv(u.uSunB, this.sunB);
    gl.uniform3fv(u.uLight, this.light);
    gl.uniform3fv(u.uShade, this.shade);
    gl.uniform1f(u.uSunUp, this.sunUp);
    gl.uniform1f(u.uProp, this.propA);
    gl.uniform1f(u.uSweep, this.sweep);
    gl.uniform1f(u.uOutside, this.outside ? 1 : 0);
    gl.uniform1f(u.uBurnt, this.burnt);
    gl.uniform1f(u.uPanelLight, this.panelLight);
    gl.uniform1f(u.uNavOn, this.lights >= 1 ? 1 : 0);
    gl.uniformMatrix4fv(u.uShM, false, this.shM);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shTex); gl.uniform1i(u.uShadow, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.art.tex); gl.uniform1i(u.uAtlas, 1);
    // o mundo vivo (trem, trilhos, gaivotas) primeiro, com profundidade propria (longe); depois o
    // aviao por cima com a dele: o aviao esta sempre na frente do que esta fora dele
    gl.uniform1f(u.uOutside, 1);
    gl.uniform1f(u.uBurnt, 0);
    gl.uniform2f(u.uNF, 0.5, 5000);
    if (this.vida.draw(p)) gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(u.uOutside, this.outside ? 1 : 0);
    gl.uniform1f(u.uBurnt, this.burnt);
    if (refl) {
      const A = this.reflM, e = this.eye, dc = Math.hypot(A[12] - e[0], A[13] - e[1], A[14] - e[2]);
      gl.uniform2f(u.uNF, Math.max(0.05, (dc - 8) * 0.5), dc + 12);
    } else gl.uniform2f(u.uNF, this.nf[0], this.nf[1]);
    this.drawAll(p);
    // helice por cima, translucida (so cor, sem gravar profundidade)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(u.uModel, false, MAT_I);
    this.draw(this.prop);
    if (!refl) this.draw(this.glass);   // vidros por cima da helice (estao mais perto)
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  // reflexo do aviao na agua: o aviao inteiro espelhado no nivel do mar, em meia resolucao
  reflPass(W, H) {
    if (!this.reflOn) return false;
    const gl = this.gl, rw = Math.max(1, W >> 1), rh = Math.max(1, H >> 1);
    if (this.rw !== rw || this.rh !== rh) {
      if (this.rFB) { gl.deleteFramebuffer(this.rFB); gl.deleteTexture(this.rTex); gl.deleteTexture(this.rATex); gl.deleteRenderbuffer(this.rRB); }
      this.rw = rw; this.rh = rh;
      const mk = (fmt, filt) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, rw, rh);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      this.rTex = mk(gl.RGBA8, gl.LINEAR);
      this.rATex = mk(gl.RGBA16F, gl.NEAREST);
      this.rRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rRB);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, rw, rh);
      this.rFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.rFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.rATex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rRB);
    }
    this.mainPass(rw, rh, true);
    return true;
  }

  // por cima da imagem do mundo, na tela (viewport ja ajustado pelo chamador)
  compose(drawQuad, ox, oy, line, gTex, gsx, gsy, refl) {
    const gl = this.gl, p = this.progCompose;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cTex); gl.uniform1i(p.u.uC, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.aTex); gl.uniform1i(p.u.uA, 1);
    gl.uniform2f(p.u.uOrigin, ox, oy);
    gl.uniform1i(p.u.uLine, line);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, gTex); gl.uniform1i(p.u.uG, 2);
    gl.uniform2f(p.u.uGS, gsx, gsy);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, refl ? this.rTex : this.cTex); gl.uniform1i(p.u.uR, 3);
    gl.uniform1f(p.u.uROn, refl ? 1 : 0);
    gl.uniform1f(p.u.uT, performance.now() / 1000 % 1000);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawQuad(p);
    gl.disable(gl.BLEND);
  }
}

const QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// para testes fora do navegador (node): monta as malhas e devolve contagens
export function buildForTest() {
  const st = new Mesh(), sdf = new SDF(shellInner);
  const t0 = Date.now();
  buildStatic(st, sdf);
  st.bakeAO(sdf);
  buildExterior(st);
  const parts = buildParts();
  const dy = new Mesh();
  for (const q of parts) { for (const i of q.m.i) dy.i.push(i + dy.n); dy.v.push(...q.m.v); dy.n += q.m.n; }
  const om = new Mesh();
  buildOutside(om); buildHead(om);
  for (const i of om.i) dy.i.push(i + dy.n); dy.v.push(...om.v); dy.n += om.n;
  const pr = new Mesh();
  buildProp(pr);
  const t1 = performance.now();
  for (let k = 0; k < 1000; k++) partMatrices({ elev: Math.sin(k), ail: 0.3, thr: 0.5, lever: 2, rud: 0.1, flap: 0.6, trim: 0.1 });
  return { st, dy, pr, ms: Date.now() - t0, matUs: (performance.now() - t1) };
}


