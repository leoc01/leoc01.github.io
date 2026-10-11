// ---------- interior da cabine: paralelogramos presos ao aviao ----------
// (usado pela cena, para a profundidade, e pela passada nitida da cabine)
export const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
// quad no fundo (profundidade 1): onde a cabine ja marcou profundidade 0, a GPU nem roda o raymarching
export const QUAD_FAR_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 1.0, 1.0); }`;

// ---------------------------------------------------------------------------
// cena: raymarching do relevo + predios + aviao, saida cor + G-buffer
// ---------------------------------------------------------------------------
export const SCENE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;

uniform sampler2D uH;      // altura (R32F, NEAREST, bilinear manual)
uniform sampler2D uToon;   // cor ilustrada rgb + material (RGBA8, mipmaps)
uniform sampler2D uAlb;    // cor "realista" (RGBA8) - fundo da agua rasa
uniform sampler2D uSA;     // sombra (r) e oclusao (g) (RG8, mipmaps)
uniform sampler2D uMip1;   // altura maxima por bloco de 32 m
uniform sampler2D uMip2;   // ... de 256 m
uniform sampler2D uBox;    // predios: 3 texels por caixa
uniform isampler2D uBGrid; // baldes 64 m: (inicio, quantidade)
uniform isampler2D uBIdx;  // indices das caixas
uniform vec4 uAp[4];       // aeroportos: (cx cy ca sa) (comprimento largura elevacao numero)

uniform vec3 uCamPos, uCamF, uCamR, uCamU;
uniform float uTanX, uHW;  // tan(fov/2), altura/largura da imagem
uniform vec2 uRes;
uniform vec3 uSun;
uniform vec2 uWind, uCloudOff;
uniform float uTime, uViewDist, uHmax, uPix;   // uPix: tamanho angular de um pixel
uniform int uStyle, uClouds, uCockpit, uRefl, uDrawPlane, uCrashed;
uniform vec3 uPPos, uPF, uPR, uPU;
uniform float uProp;
uniform vec4 uPB[66];      // caixas do aviao: 3 vec4 por caixa
uniform int uNPB;
uniform vec3 uPal[6];      // ceu topo, ceu horizonte, nevoa, luz, sombra, sol
uniform float uNight;      // 1 = noite de lua
uniform highp sampler2DShadow uPSh;   // mapa de sombra do aviao (malha, ver cabin.js), no referencial do aviao
uniform mat4 uPShM;
uniform float uPShOn;
uniform vec4 uLand;        // farol de pouso: posicao (mundo) e intensidade (0 = apagado)
uniform vec3 uLandDir;

in vec2 vUV;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oG;   // distancia, tipo, material, 0

const int TER_N = 2048;
const float TER_CELL = 8.0;
const float WORLD = 16384.0;
const float CLOUD_Z = 1500.0;
const float BGRID_CELL = 64.0;
const int BGRID_N = 256;
const float BUILD_HMAX = 40.0;
const int GK_SKY = 0, GK_CLOUD = 1, GK_LAND = 2, GK_WATER = 3, GK_BOX = 4, GK_PLANE = 5, GK_LIGHT = 6;
const float SMALL_VIEW = 1500.0;
const int STYLE_POSTER = 2;

// ---------- utilidades (iguais ao C) ----------
float wrapf(float d) { return d - WORLD * floor(d / WORLD + 0.5); }
// int -> uint preservando os bits (como o cast do C); uint(negativo) nao e garantido em GLSL
uint ubits(int x) { return uint(x & 0x7fffffff) | (x < 0 ? 0x80000000u : 0u); }
uint hash3(int x, int y, int z) {
    uint h = (ubits(x) * 73856093u) ^ (ubits(y) * 19349663u) ^ (ubits(z) * 83492791u);
    h ^= h >> 13u; h *= 0x5bd1e995u; h ^= h >> 15u;
    return h;
}
float hash3f(int x, int y, int z) { return float(hash3(x, y, z) & 0xFFFFu) / 65535.0; }
float noiseSmooth(float x, float y, int s) {
    float fx0 = floor(x), fy0 = floor(y);
    int ix = int(fx0), iy = int(fy0);
    float fx = x - fx0, fy = y - fy0;
    fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
    return mix(mix(hash3f(ix, iy, s), hash3f(ix + 1, iy, s), fx), mix(hash3f(ix, iy + 1, s), hash3f(ix + 1, iy + 1, s), fx), fy);
}

float hAt(int x, int y) { return texelFetch(uH, ivec2(x & (TER_N - 1), y & (TER_N - 1)), 0).r; }
float terH(vec2 p) {
    vec2 f = p / TER_CELL;
    vec2 i = floor(f);
    vec2 t = f - i;
    int ix = int(i.x), iy = int(i.y);
    float a = mix(hAt(ix, iy), hAt(ix + 1, iy), t.x);
    float b = mix(hAt(ix, iy + 1), hAt(ix + 1, iy + 1), t.x);
    return mix(a, b, t.y);
}
// texturas filtradas: o texel i fica na posicao i*8 m (igual ao bilinear do C)
vec2 texUV(vec2 p) { return (p / TER_CELL + 0.5) / float(TER_N); }
float lodAt(float t) { return max(0.0, log2(max(t * uPix / TER_CELL, 1e-6))); }
vec2 shAO(vec2 p, float t) { return textureLod(uSA, texUV(p), lodAt(t)).rg; }

// ruido que se repete a cada n celulas (igual a noise_per do C)
float noisePer(float x, float y, int n, int s) {
    float fx0 = floor(x), fy0 = floor(y);
    int ix = int(fx0), iy = int(fy0);
    float fx = x - fx0, fy = y - fy0;
    fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
    int x0 = ((ix % n) + n) % n, y0 = ((iy % n) + n) % n;
    int x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    return mix(mix(hash3f(x0, y0, s), hash3f(x1, y0, s), fx), mix(hash3f(x0, y1, s), hash3f(x1, y1, s), fx), fy);
}
// nuvens periodicas no tamanho do mundo: nao pulam quando o aviao da a volta
float cloudDensity(float x, float y) {
    float u = x - uCloudOff.x, v = y - uCloudOff.y;
    u = (u - WORLD * floor(u / WORLD)) / WORLD;
    v = (v - WORLD * floor(v / WORLD)) / WORLD;
    float n = noisePer(u * 10.0, v * 10.0, 10, 11) * 0.52 + noisePer(u * 25.0, v * 25.0, 25, 12) * 0.27 +
              noisePer(u * 71.0, v * 71.0, 71, 13) * 0.14 + noisePer(u * 205.0, v * 205.0, 205, 14) * 0.07;
    return smoothstep(0.56, 0.76, n);
}

// ---------- predios ----------
vec4 boxTex(int i, int k) { int j = i * 3 + k; return texelFetch(uBox, ivec2(j & 1023, j >> 10), 0); }

// raio contra caixa alinhada (metodo das placas)
bool rayBox(vec3 o, vec3 d, vec3 lo, vec3 hi, float tmin, float tmax, out float tout, out int axis, out float sgn) {
    d = mix(d, vec3(1e-9), lessThan(abs(d), vec3(1e-9)));   /* evita 0/0 */
    vec3 inv = 1.0 / d;
    vec3 t0 = (lo - o) * inv, t1 = (hi - o) * inv;
    vec3 tn3 = min(t0, t1), tf3 = max(t0, t1);
    float tn = max(max(tn3.x, tn3.y), tn3.z), tf = min(min(tf3.x, tf3.y), tf3.z);
    if (tn > tf || tn < tmin || tn >= tmax) return false;
    axis = tn == tn3.x ? 0 : (tn == tn3.y ? 1 : 2);
    sgn = axis == 0 ? -sign(d.x) : (axis == 1 ? -sign(d.y) : -sign(d.z));
    tout = tn;
    return true;
}

bool boxBucket(int bx, int by, vec3 ro, vec3 rd, inout float best, out vec3 nrm, out int bi) {
    ivec2 sc = texelFetch(uBGrid, ivec2(bx & (BGRID_N - 1), by & (BGRID_N - 1)), 0).rg;
    if (sc.y == 0) return false;
    float px = (float(bx) + 0.5) * BGRID_CELL, py = (float(by) + 0.5) * BGRID_CELL;
    bool hit = false;
    for (int j = 0; j < sc.y; j++) {
        int idx = sc.x + j;
        int b = texelFetch(uBIdx, ivec2(idx & 1023, idx >> 10), 0).r;
        vec4 b0 = boxTex(b, 0), b1 = boxTex(b, 1);
        float cx = b0.x + WORLD * floor((px - b0.x) / WORLD + 0.5);
        float cy = b0.y + WORLD * floor((py - b0.y) / WORLD + 0.5);
        float dx = ro.x - cx, dy = ro.y - cy;
        if (b1.x < 0.0 && dx * dx + dy * dy > SMALL_VIEW * SMALL_VIEW) continue;   // vaca longe: nao cintila
        float hx = abs(b1.x);
        vec3 o = vec3(dx * b1.z + dy * b1.w, -dx * b1.w + dy * b1.z, ro.z);
        vec3 d = vec3(rd.x * b1.z + rd.y * b1.w, -rd.x * b1.w + rd.y * b1.z, rd.z);
        float tn, sg; int ax;
        if (rayBox(o, d, vec3(-hx, -b1.y, b0.z), vec3(hx, b1.y, b0.w), 0.01, best, tn, ax, sg)) {
            best = tn; bi = b; hit = true;
            if (ax == 2) nrm = vec3(0.0, 0.0, sg);
            else {
                float nx = ax == 0 ? sg : 0.0, ny = ax == 1 ? sg : 0.0;
                nrm = vec3(nx * b1.z - ny * b1.w, nx * b1.w + ny * b1.z, 0.0);
            }
        }
    }
    return hit;
}

// ---------- piramide de alturas: distancia segura ----------
float cellExit(vec3 p, vec3 rd, float cs) {
    float tx = 1e30, ty = 1e30;
    if (rd.x > 1e-6) tx = ((floor(p.x / cs) + 1.0) * cs - p.x) / rd.x;
    else if (rd.x < -1e-6) tx = (p.x - floor(p.x / cs) * cs) / -rd.x;
    if (rd.y > 1e-6) ty = ((floor(p.y / cs) + 1.0) * cs - p.y) / rd.y;
    else if (rd.y < -1e-6) ty = (p.y - floor(p.y / cs) * cs) / -rd.y;
    return min(tx, ty) + 0.02;
}
float mipSkip(vec3 p, vec3 rd) {
    float c2 = 256.0, c1 = 32.0;
    float m = texelFetch(uMip2, ivec2(int(floor(p.x / c2)) & 63, int(floor(p.y / c2)) & 63), 0).r;
    float cs = c2;
    if (p.z <= m + 0.5) {
        m = texelFetch(uMip1, ivec2(int(floor(p.x / c1)) & 511, int(floor(p.y / c1)) & 511), 0).r;
        cs = c1;
        if (p.z <= m + 0.5) return 0.0;
    }
    float s = cellExit(p, rd, cs);
    if (rd.z < 0.0) s = min(s, (p.z - m) / -rd.z);
    return s;
}

// kind: 0 nada, 1 terreno, 2 caixa
int march(vec3 ro, vec3 rd, float tmax, out float thit, out int box, out vec3 bn) {
    float t = 0.0;
    box = -1; bn = vec3(0.0, 0.0, 1.0); thit = tmax;
    if (ro.z > uHmax) {
        if (rd.z >= -1e-5) return 0;
        t = (ro.z - uHmax) / -rd.z;
        if (t > tmax) return 0;
    }
    float tprev = t, tbox = 1e30;
    int lastb = -2147483647;
    for (int i = 0; i < 700; i++) {
        vec3 p = ro + rd * t;
        float gh = max(terH(p.xy), 0.0);
        float dz = p.z - gh;
        if (dz < 0.0) {
            float a = tprev, b = t;
            for (int k = 0; k < 7; k++) {
                float m = 0.5 * (a + b);
                vec3 q = ro + rd * m;
                if (q.z < max(terH(q.xy), 0.0)) b = m; else a = m;
            }
            if (tbox < b) break;
            thit = b; box = -1;
            return 1;
        }
        if (dz < BUILD_HMAX) {
            int bx = int(floor(p.x / BGRID_CELL)), by = int(floor(p.y / BGRID_CELL));
            int key = by * 65536 + bx;
            if (key != lastb) {
                lastb = key;
                vec3 nn; int bi;
                float tb = tbox;
                if (boxBucket(bx, by, ro, rd, tb, nn, bi)) { tbox = tb; box = bi; bn = nn; }
            }
        }
        if (t > tbox) break;
        if (p.z > uHmax && rd.z > 0.0) break;
        float stp = max(dz * 0.65, 0.4 + t * 0.0035);
        if (dz > 1.0) stp = max(stp, mipSkip(p, rd));
        tprev = t;
        t += stp;
        if (t > tmax) break;
    }
    if (box >= 0 && tbox < tmax) { thit = tbox; return 2; }
    return 0;
}

bool boxShadow(vec3 p) {
    vec3 nn; int bi;
    int bx = int(floor(p.x / BGRID_CELL)), by = int(floor(p.y / BGRID_CELL));
    vec3 sp = p + uSun * 0.05;
    float t = 120.0;
    if (boxBucket(bx, by, sp, uSun, t, nn, bi) && boxTex(bi, 2).z == 0.0) return true;
    vec3 q = p + uSun * 30.0;
    int bx2 = int(floor(q.x / BGRID_CELL)), by2 = int(floor(q.y / BGRID_CELL));
    t = 120.0;
    if ((bx2 != bx || by2 != by) && boxBucket(bx2, by2, sp, uSun, t, nn, bi) && boxTex(bi, 2).z == 0.0) return true;
    return false;
}

// ---------- aviao ----------
bool planeHit(vec3 ro, vec3 rd, float tmax, bool cockpit, out float tout, out vec3 nout, out vec3 cout) {
    vec3 oc = ro - uPPos;
    float b = dot(oc, rd), c = dot(oc, oc) - 42.0;
    if (c > 0.0 && b > 0.0) return false;
    if (b * b - c < 0.0) return false;
    vec3 lo = vec3(dot(oc, uPF), dot(oc, uPR), dot(oc, uPU));
    vec3 ld = vec3(dot(rd, uPF), dot(rd, uPR), dot(rd, uPU));
    float ca = cos(uProp), sa = sin(uProp);
    float best = tmax, bsg = 0.0;
    int hit = -1, bax = 0;
    for (int i = 0; i < uNPB; i++) {
        vec4 A = uPB[i * 3], B = uPB[i * 3 + 1], C = uPB[i * 3 + 2];
        if (cockpit && C.z < 0.5) continue;
        vec3 o = lo, d = ld;
        bool prop = C.y > 0.5;
        if (prop) {
            o = vec3(lo.x, ca * lo.y + sa * lo.z, -sa * lo.y + ca * lo.z);
            d = vec3(ld.x, ca * ld.y + sa * ld.z, -sa * ld.y + ca * ld.z);
        }
        float tn, sg; int ax;
        if (rayBox(o, d, A.xyz, vec3(A.w, B.x, B.y), 1e-3, best, tn, ax, sg)) { best = tn; hit = i; bax = ax; bsg = sg; }
    }
    if (hit < 0) return false;
    vec3 n = vec3(0.0);
    if (bax == 0) n.x = bsg; else if (bax == 1) n.y = bsg; else n.z = bsg;
    vec4 B = uPB[hit * 3 + 1], C = uPB[hit * 3 + 2];
    if (C.y > 0.5) n = vec3(n.x, ca * n.y - sa * n.z, sa * n.y + ca * n.z);
    tout = best;
    nout = normalize(uPF * n.x + uPR * n.y + uPU * n.z);
    float k = uCrashed == 1 ? 0.25 : 1.0;
    cout = vec3(B.z, B.w, C.x) * k;
    return true;
}

// ---------- pintura dos aeroportos ----------
bool seg7(int d, float u, float v) {
    int m[10] = int[10](0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F);
    const float t = 0.16;
    int s = m[d % 10];
    bool on = false;
    if ((s & 0x01) != 0 && v > 1.0 - t) on = true;
    if ((s & 0x02) != 0 && u > 1.0 - t && v > 0.5) on = true;
    if ((s & 0x04) != 0 && u > 1.0 - t && v < 0.5) on = true;
    if ((s & 0x08) != 0 && v < t) on = true;
    if ((s & 0x10) != 0 && u < t && v < 0.5) on = true;
    if ((s & 0x20) != 0 && u < t && v > 0.5) on = true;
    if ((s & 0x40) != 0 && abs(v - 0.5) < t * 0.5) on = true;
    return on;
}

// devolve true se o ponto e pavimento; fp = tamanho do pixel no chao (m) para apagar detalhes longe
bool airportPaint(vec2 p, float fp, out vec3 col) {
    for (int i = 0; i < 2; i++) {
        vec4 A = uAp[i * 2], B = uAp[i * 2 + 1];
        float dx = wrapf(p.x - A.x), dy = wrapf(p.y - A.y);
        if (dx * dx + dy * dy > 1200.0 * 1200.0) continue;
        float la = dx * A.z + dy * A.w, lb = -dx * A.w + dy * A.z;
        float L2 = B.x * 0.5, W2 = B.y * 0.5;
        vec3 asph = vec3(0.26, 0.26, 0.28), wht = vec3(0.90, 0.90, 0.88), yel = vec3(0.85, 0.70, 0.15);
        vec3 conc = vec3(0.60, 0.59, 0.56);
        float detail = 1.0 - smoothstep(1.2, 5.0, fp);   // marcas finas somem longe (sem piscar)
        int zone = 0; float cl = 0.0;
        if (abs(la) <= L2 && abs(lb) <= W2) zone = 1;
        else if (abs(la) <= L2 && abs(lb - 110.0) <= 7.5) { zone = 2; cl = abs(lb - 110.0); }
        else if (lb >= 0.0 && lb <= 110.0) {
            float c0 = abs(la), c1 = abs(abs(la) - (L2 - 10.0));
            if (c0 <= 7.5 || c1 <= 7.5) { zone = 3; cl = c0 <= 7.5 ? c0 : c1; }
        }
        if (zone == 0 && abs(la) <= 200.0 && lb >= 110.0 && lb <= 230.0) zone = 4;
        if (zone == 0) continue;
        vec3 c = asph;
        bool mark = false;
        if (zone == 1) {
            float ae = L2 - abs(la), sb = la < 0.0 ? lb : -lb, ab = abs(lb);
            if (ab > W2 - 0.9) { c = wht; }
            else if (ae >= 6.0 && ae <= 36.0 && ab >= 3.0 && ab <= 13.5 && mod(ab - 3.0, 3.6) < 1.8) mark = true;
            else if (ae >= 45.0 && ae <= 63.0) {
                int num = la < 0.0 ? int(B.w) : (int(B.w) + 18 - 1) % 36 + 1;
                float v = (ae - 45.0) / 18.0;
                if (sb >= -9.5 && sb <= -1.5) mark = seg7(num / 10, (sb + 9.5) / 8.0, v);
                else if (sb >= 1.5 && sb <= 9.5) mark = seg7(num % 10, (sb - 1.5) / 8.0, v);
            } else if (ae >= 290.0 && ae <= 335.0 && ab >= 4.5 && ab <= 9.5) mark = true;
            else if (ae >= 150.0 && ae <= 600.0 && mod(ae - 150.0, 150.0) < 22.0 && ab >= 3.0 && ab <= 6.0) mark = true;
            else if (ab < 0.45 && ae > 80.0 && mod(abs(la), 50.0) < 30.0) mark = true;
            else if (ae > 250.0 && ae < 650.0 && ab < 6.0 && hash3f(int(la * 0.2), int(lb * 1.5), 9) < 0.35)
                c = mix(asph, vec3(0.17, 0.17, 0.18), detail);
            if (mark) c = mix(asph, wht, detail);
        } else if (zone == 2) {
            if (cl < 0.3) c = mix(asph, yel, detail);
        } else if (zone == 3) {
            if (cl < 0.3 || (lb > 60.0 && lb < 62.0)) c = mix(asph, yel, detail);
        } else {
            c = conc;
            if (abs(mod(la + 400.0, 32.0) - 16.0) < 0.25 && lb > 180.0) c = mix(conc, yel, detail);
        }
        col = c * vec3(1.05, 1.05, 1.1);
        return true;
    }
    return false;
}

// ---------- estilo ilustrado ----------
vec3 celLight(vec3 base, float ndl, float sh) {
    float e = ndl * sh;
    float band = e > 0.45 ? 1.0 : (e > 0.12 ? 0.62 : 0.0);
    return base * mix(uPal[4], uPal[3], band);
}
vec3 fogC(vec3 c, float t) {
    float f = (1.0 - exp(-t / 9000.0)) * 0.82;
    if (uStyle == STYLE_POSTER) f = floor(f * 6.0 + 0.5) / 6.0;
    return mix(c, uPal[2], f);
}

// farol de pouso: cone estreito com queda pela distancia (so pesa de noite)
vec3 landLight(vec3 p, vec3 n, vec3 base) {
    if (uLand.w <= 0.0) return vec3(0.0);
    vec3 v = p - uLand.xyz;
    v.xy = vec2(wrapf(v.x), wrapf(v.y));
    float d = length(v);
    if (d > 900.0) return vec3(0.0);
    vec3 l = v / d;
    float spot = smoothstep(0.955, 0.992, dot(l, uLandDir));
    float lam = max(dot(n, -l), 0.0) * 0.7 + 0.3;
    float att = 1.0 / (1.0 + (d / 70.0) * (d / 70.0));
    return base * vec3(1.0, 0.94, 0.80) * (spot * lam * att * 2.4 * uLand.w);
}
// estrelas: pontos fixos no ceu (celulas na direcao), somem perto do horizonte
vec3 stars(vec3 rd) {
    vec3 q = rd * 420.0;
    ivec3 c = ivec3(floor(q));
    float h = hash3f(c.x, c.y, c.z * 7 + 11);
    if (h < 0.9935) return vec3(0.0);
    vec3 f = fract(q) - 0.5;
    float b = (h - 0.9935) / 0.0065;
    float core = smoothstep(0.42, 0.0, length(f));
    return vec3(0.75, 0.82, 1.0) * core * (0.35 + 0.9 * b * b) * smoothstep(0.02, 0.18, rd.z);
}

vec3 sky(vec3 ro, vec3 rd, out int kind) {
    float h = clamp(rd.z, 0.0, 1.0);
    vec3 c = mix(uPal[1], uPal[0], smoothstep(0.0, 0.55, h));
    if (rd.z < 0.0) c = uPal[2];
    float mu = dot(rd, uSun);
    if (uNight > 0.5) {   // lua menor e mais branca, halo fraco, estrelas
        c += stars(rd);
        if (mu > 0.99965) c = vec3(0.93, 0.95, 1.0) * (0.85 + 0.15 * smoothstep(0.99965, 0.99995, mu));
        else if (mu > 0.9975) c = mix(c, uPal[5], 0.12);
    } else if (mu > 0.9990) c = vec3(1.0, 0.99, 0.90);
    else if (mu > 0.9965) c = mix(c, uPal[5], 0.6);
    else if (mu > 0.985) c = mix(c, uPal[5], 0.18);
    kind = GK_SKY;
    if (uClouds == 1 && rd.z > 1e-3) {
        float tc = (CLOUD_Z - ro.z) / rd.z;
        if (tc > 0.0 && tc < 40000.0) {
            vec3 q = ro + rd * tc;
            float d = cloudDensity(q.x, q.y);
            if (d > 0.28) {
                float sl = length(uSun.xy) + 1e-4;
                float ds = cloudDensity(q.x + uSun.x / sl * 140.0, q.y + uSun.y / sl * 140.0);
                vec3 lit = mix(vec3(1.0, 0.98, 0.96), uPal[5], 0.25) * mix(1.0, 0.30, uNight);
                vec3 cc = (ds > d + 0.08 || d > 0.75) ? mix(lit, uPal[4], 0.45) : lit;
                float far = smoothstep(6000.0, 30000.0, tc);
                c = mix(cc, c, far * 0.7);
                kind = GK_CLOUD;
            }
        }
    }
    return c;
}

vec3 terrainNormal(vec3 p, float t) {
    float e = 2.5 + t * 0.002;
    float hx = max(terH(p.xy + vec2(e, 0.0)), 0.0) - max(terH(p.xy - vec2(e, 0.0)), 0.0);
    float hy = max(terH(p.xy + vec2(0.0, e)), 0.0) - max(terH(p.xy - vec2(0.0, e)), 0.0);
    return normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));
}

vec3 shadeBox(int bi, vec3 p, vec3 n, vec3 ro, out int kind) {
    vec4 b0 = boxTex(bi, 0), b2 = boxTex(bi, 2);
    int bkind = int(b2.z), aux = int(b2.w) & 255, flags = int(b2.w) >> 8;
    if (bkind != 0) {
        kind = GK_LIGHT;
        if (bkind == 2) {   // PAPI: branco acima da rampa, vermelho abaixo
            float dh = length(vec2(wrapf(ro.x - p.x), wrapf(ro.y - p.y)));
            float ang = degrees(atan(ro.z - p.z, dh));
            float thr[4] = float[4](3.5, 3.17, 2.83, 2.5);
            return ang > thr[aux % 4] ? vec3(1.0) : vec3(1.0, 0.09, 0.048);
        }
        int top = int(b2.x);
        vec3 lc = vec3(float(top & 255), float((top >> 8) & 255), float(top >> 16)) / 255.0;
        return min(lc * lc * 1.8, vec3(1.0));
    }
    kind = GK_BOX;
    bool side = n.z < 0.5;
    int pk = int(side ? b2.y : b2.x);
    vec3 base = vec3(float(pk & 255), float((pk >> 8) & 255), float(pk >> 16)) / 255.0;
    float sh = side ? 1.0 : shAO(p.xy, 0.0).r;
    if (boxShadow(p)) sh = 0.0;
    vec3 c = celLight(base, max(dot(n, uSun), 0.0) + (side ? 0.0 : 0.1), sh);
    if ((flags & 1) != 0 && side) {   // janelas
        vec4 b1 = boxTex(bi, 1);
        float cx = p.x + wrapf(b0.x - p.x), cy = p.y + wrapf(b0.y - p.y);
        float u = (p.x - cx) * -n.y + (p.y - cy) * n.x;
        float wu = mod(u + 1000.0, 3.2), wz = mod(p.z - b0.z, 3.4);
        if (wu > 0.8 && wu < 2.4 && wz > 1.1 && wz < 2.3 && p.z < b0.w - 0.6) {
            c *= vec3(0.35, 0.45, 0.6);
            if (uNight > 0.5 && hash3f(int(floor((u + 1000.0) / 3.2)), int(floor((p.z - b0.z) / 3.4)), bi) > 0.45) c = vec3(1.0, 0.78, 0.42);   // janela acesa
        }
    }
    if ((flags & 2) != 0 && noiseSmooth(p.x * 1.7 + p.z * 1.1, p.y * 1.7 - p.z * 0.8, 21) > 0.58) c *= vec3(0.17, 0.16, 0.16);   // malhas
    return c + landLight(p, n, base);
}

// sombra do aviao (forma de verdade) no chao e na agua
float planeShadow(vec3 p) {
    if (uPShOn < 0.5) return 1.0;
    vec3 r = p - uPPos;
    r.xy = vec2(wrapf(r.x), wrapf(r.y));
    if (dot(r.xy, r.xy) > 4.0e6) return 1.0;
    vec4 s = uPShM * vec4(dot(r, uPF), dot(r, uPR), dot(r, uPU), 1.0);
    vec3 q = s.xyz * 0.5 + 0.5;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 1.0;
    vec2 o = 0.8 / vec2(textureSize(uPSh, 0));
    float z = min(q.z, 1.0);
    return 0.25 * (texture(uPSh, vec3(q.xy + vec2(-o.x, -o.y), z)) + texture(uPSh, vec3(q.xy + vec2(o.x, -o.y), z))
                 + texture(uPSh, vec3(q.xy + vec2(-o.x, o.y), z)) + texture(uPSh, vec3(q.xy + vec2(o.x, o.y), z)));
}

vec3 shadeLand(vec3 p, float t, bool primary, out float mat) {
    float fp = t * uPix;   // tamanho do pixel no chao
    vec4 toon = textureLod(uToon, texUV(p.xy), lodAt(t));
    mat = texelFetch(uToon, ivec2(int(floor(p.x / TER_CELL + 0.5)) & (TER_N - 1), int(floor(p.y / TER_CELL + 0.5)) & (TER_N - 1)), 0).a * 255.0;
    vec3 base = toon.rgb;
    vec3 pc;
    if (airportPaint(p.xy, fp, pc)) { base = pc; mat = 200.0; }
    vec3 n = terrainNormal(p, t);
    vec2 sa = shAO(p.xy, t);
    float sh = sa.r;
    if (t < 2500.0 && boxShadow(p)) sh = 0.0;
    if (primary && uDrawPlane == 1) sh *= planeShadow(p);
    if (uClouds == 1) {
        float k = (CLOUD_Z - p.z) / uSun.z;
        if (k > 0.0 && cloudDensity(p.x + uSun.x * k, p.y + uSun.y * k) > 0.3) sh *= 0.35;
    }
    vec3 c = celLight(base, max(dot(n, uSun), 0.0) * 1.25, sh);
    c *= 0.75 + 0.25 * sa.g;
    if (primary) c += landLight(p, n, base);
    if (uNight > 0.5 && int(mat + 0.5) == 7) {   // cidade de noite: janelas e postes acesos
        ivec2 q = ivec2(floor(p.xy / 7.0));
        float h = hash3f(q.x, q.y, 41);
        vec2 f = fract(p.xy / 7.0) - 0.5;
        float dot_ = h > 0.55 ? smoothstep(0.32, 0.08, length(f)) : 0.0;
        float far = smoothstep(250.0, 1800.0, t);
        float glow = mix(dot_ * (0.6 + 0.8 * (h - 0.55) / 0.45), 0.30, far);
        c += vec3(1.0, 0.72, 0.38) * glow;
    }
    return c;
}

// superficie sem reflexo (usada pelo reflexo da agua)
vec3 surfaceRefl(vec3 ro, vec3 rd) {
    float th; int box; vec3 bn;
    int hit = march(ro, rd, 6000.0, th, box, bn);
    float tp; vec3 pn, pc;
    if (uDrawPlane == 1 && planeHit(ro, rd, th, false, tp, pn, pc)) {
        vec3 p = ro + rd * tp;
        float sh = p.z < terH(p.xy) + 40.0 ? shAO(p.xy, 0.0).r : 1.0;
        return fogC(celLight(pc, max(dot(pn, uSun), 0.0) + 0.15, sh), tp);
    }
    int kind;
    if (hit == 0) return sky(ro, rd, kind);
    vec3 p = ro + rd * th;
    vec3 c;
    if (hit == 2) c = shadeBox(box, p, bn, ro, kind);
    else if (terH(p.xy) < 0.0) c = vec3(0.10, 0.38, 0.66);
    else { float m; c = shadeLand(p, th, false, m); }
    return fogC(c, th);
}

vec3 shadeWater(vec3 p, vec3 rd, float t) {
    float w = sin(p.x * 0.05 + p.y * 0.03 + uTime * 1.1) + sin(p.x * -0.02 + p.y * 0.07 + uTime * 0.8);
    vec3 n = normalize(vec3(0.04 * w / (1.0 + t / 600.0), 0.03 * w / (1.0 + t / 600.0), 1.0));
    float depth = -terH(p.xy);
    vec3 body = mix(vec3(0.30, 0.78, 0.80), vec3(0.10, 0.38, 0.66), smoothstep(0.5, 12.0, depth)) * mix(1.0, 0.22, uNight);
    float sh = shAO(p.xy, t).r;
    if (uDrawPlane == 1) sh *= planeShadow(p);
    if (sh < 0.5) body *= mix(uPal[4], vec3(1.0), 0.35);
    float cosi = max(-dot(rd, n), 0.0);
    float F = 0.08 + 0.6 * pow(1.0 - cosi, 4.0);
    vec3 r = rd + n * (2.0 * cosi);
    if (uRefl == 1) {
        vec3 rr = r;
        if (rr.z < 0.01) rr.z = 0.01;
        vec3 refl = surfaceRefl(vec3(p.xy, 0.05), normalize(rr));
        body = mix(body, mix(refl, body, 0.25), F);
    }
    // brilho do sol: some aos poucos com a distancia (evita cintilar)
    float g = smoothstep(0.990, 0.996, dot(normalize(r), uSun)) * (1.0 - smoothstep(1500.0, 6000.0, t));
    if (sh > 0.5) body = mix(body, vec3(1.0, 1.0, 0.95), 0.85 * g);
    if (depth < 1.2) {
        float k = noiseSmooth(p.x * 0.4 + uTime * 0.4, p.y * 0.4, 31);
        if (k > 0.45) body = mix(body, vec3(0.95, 0.98, 1.0) * mix(1.0, 0.25, uNight), 0.8 * (1.0 - smoothstep(800.0, 3000.0, t)));
    }
    return body + landLight(p, n, vec3(0.25, 0.35, 0.45));
}

void main() {
    vec2 ndc = vUV * 2.0 - 1.0;
    vec3 rd = normalize(uCamF + uCamR * (ndc.x * uTanX) + uCamU * (ndc.y * uTanX * uHW));
    vec3 ro = uCamPos;
    float th; int box; vec3 bn;
    int hit = march(ro, rd, uViewDist, th, box, bn);
    float tp; vec3 pn, pc;
    vec3 col; float t = 1e9; int kind = GK_SKY; float mat = 0.0;
    // o aviao em si e uma malha desenhada depois, na resolucao da tela (cabin.js)
    if (hit == 0) {
        col = sky(ro, rd, kind);
    } else {
        t = th;
        vec3 p = ro + rd * th;
        if (hit == 2) col = shadeBox(box, p, bn, ro, kind);
        else if (terH(p.xy) < 0.0) { kind = GK_WATER; col = shadeWater(p, rd, th); }
        else { kind = GK_LAND; col = shadeLand(p, th, true, mat); }
        if (kind != GK_LIGHT) col = fogC(col, th);
    }
    oColor = vec4(col, 1.0);
    oG = vec4(t, float(kind), mat, 0.0);
}`;

// ---------------------------------------------------------------------------
// pos: contornos (laplaciano de 1/distancia) e costa
// ---------------------------------------------------------------------------
export const POST_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uColor, uG;
uniform float uNight;
in vec2 vUV;
out vec4 oColor;
const int GK_SKY = 0, GK_CLOUD = 1, GK_LAND = 2, GK_WATER = 3;

float invd(ivec2 q) {
    ivec2 sz = textureSize(uG, 0);
    q = clamp(q, ivec2(0), sz - 1);
    vec4 g = texelFetch(uG, q, 0);
    int k = int(g.y + 0.5);
    return (k == GK_SKY || k == GK_CLOUD) ? 0.0 : 1.0 / max(g.x, 0.5);
}
int kindAt(ivec2 q) {
    ivec2 sz = textureSize(uG, 0);
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) return -1;
    return int(texelFetch(uG, q, 0).y + 0.5);
}

void main() {
    ivec2 q = ivec2(gl_FragCoord.xy);
    vec3 col = texelFetch(uColor, q, 0).rgb;
    vec4 g = texelFetch(uG, q, 0);
    int kind = int(g.y + 0.5);
    float c = invd(q);
    bool nearCk = kind == 7 || kindAt(q + ivec2(1, 0)) == 7 || kindAt(q - ivec2(1, 0)) == 7 ||
                  kindAt(q + ivec2(0, 1)) == 7 || kindAt(q - ivec2(0, 1)) == 7;
    if (c > 0.0 && !nearCk) {
        bool edge = false;
        ivec2 D[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));
        for (int k = 0; k < 4; k++) {
            float nb = invd(q + D[k]), op = invd(q - D[k]);
            float lap = op + nb - 2.0 * c;
            if (c > nb * 1.25 + 1e-6 && -lap > 0.12 * c) edge = true;
        }
        if (edge) {
            float far = smoothstep(2000.0, 14000.0, g.x);
            float k = 0.42 + 0.3 * far;
            col = col * k + vec3(0.04, 0.05, 0.12) * (1.0 - k);
        }
    }
    if (kind == GK_WATER) {
        bool land = kindAt(q + ivec2(-1, 0)) == GK_LAND || kindAt(q + ivec2(1, 0)) == GK_LAND || kindAt(q + ivec2(0, 1)) == GK_LAND;
        if (land) {
            float far = smoothstep(3000.0, 14000.0, g.x);
            col = mix(col, mix(vec3(0.97), vec3(0.26, 0.30, 0.42), uNight), 0.65 * (1.0 - far * 0.6));
        }
    }
    oColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// pontos do realce da pista (luzes, PAPI, contorno) com teste de profundidade
// ---------------------------------------------------------------------------
export const POINTS_VS = `#version 300 es
in vec2 aUV;
in float aDist;
in vec4 aCol;
uniform float uSize;
out float vDist;
out vec4 vCol;
void main() {
    vDist = aDist; vCol = aCol;
    gl_Position = vec4(aUV.x * 2.0 - 1.0, 1.0 - aUV.y * 2.0, 0.0, 1.0);
    gl_PointSize = uSize;
}`;
export const POINTS_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uG;
in float vDist;
in vec4 vCol;
out vec4 oColor;
void main() {
    vec4 g = texelFetch(uG, ivec2(gl_FragCoord.xy), 0);
    int k = int(g.y + 0.5);
    if (k != 0 && k != 1 && g.x < vDist * 0.985 - 4.0) discard;
    oColor = vCol;
}`;

// ---------------------------------------------------------------------------
// tela: imagem 3D escalada + sobreposicao de celulas (painel, HUD, menu)
// ---------------------------------------------------------------------------
export const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 oColor;
void main() { oColor = vec4(texture(uTex, vUV).rgb, 1.0); }`;

export const CELLS_FS = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uCells;   // (glifo, frente rgba, fundo rgba, codigo)
uniform sampler2D uAtlas;
uniform vec2 uCell;          // tamanho da celula em pixels
uniform vec2 uScreen;        // tamanho da tela em pixels
uniform vec2 uAtlasCell;     // tamanho do glifo no atlas (pixels)
uniform float uAtlasCols;
out vec4 oColor;
vec4 unpack(uint c) { return vec4(float(c >> 24), float((c >> 16) & 255u), float((c >> 8) & 255u), float(c & 255u)) / 255.0; }
// blocos desenhados aqui, sem fonte: nitidos e sem emendas
float block(uint cp, vec2 f) {
    if (cp == 0x2580u) return f.y < 0.5 ? 1.0 : 0.0;
    if (cp == 0x2584u) return f.y >= 0.5 ? 1.0 : 0.0;
    if (cp == 0x2588u) return 1.0;
    if (cp == 0x258Cu) return f.x < 0.5 ? 1.0 : 0.0;
    if (cp == 0x2590u) return f.x >= 0.5 ? 1.0 : 0.0;
    if (cp == 0x2591u) return (mod(floor(f.x * 4.0) + floor(f.y * 8.0), 2.0) == 0.0) ? 0.35 : 0.0;
    if (cp >= 0x2596u && cp <= 0x259Fu) {
        uint m[10] = uint[10](4u, 8u, 1u, 13u, 9u, 7u, 11u, 2u, 6u, 14u);   // TL=1 TR=2 BL=4 BR=8
        uint mk = m[cp - 0x2596u];
        uint bit = (f.x < 0.5 ? 0u : 1u) + (f.y < 0.5 ? 0u : 2u);
        return ((mk >> bit) & 1u) != 0u ? 1.0 : 0.0;
    }
    return -1.0;
}
void main() {
    vec2 px = vec2(gl_FragCoord.x, uScreen.y - gl_FragCoord.y);
    ivec2 cell = ivec2(floor(px / uCell));
    ivec2 sz = textureSize(uCells, 0);
    if (cell.x >= sz.x || cell.y >= sz.y) discard;
    uvec4 c = texelFetch(uCells, cell, 0);
    vec4 fg = unpack(c.y), bg = unpack(c.z);
    vec2 f = fract(px / uCell);
    float cov = block(c.w, f);
    if (cov < 0.0) {
        if (c.x == 0u) cov = 0.0;
        else {
            float gi = float(c.x);
            vec2 a = vec2(mod(gi, uAtlasCols), floor(gi / uAtlasCols));
            vec2 uv = (a + f) * uAtlasCell / vec2(textureSize(uAtlas, 0));
            cov = texture(uAtlas, uv).a;
        }
    }
    vec4 col = mix(bg, vec4(fg.rgb, max(fg.a, bg.a)), cov * fg.a);
    if (col.a <= 0.0) discard;
    oColor = vec4(col.rgb * col.a, col.a);
}`;

// ---------------------------------------------------------------------------
// explosao do acidente: cada particula e um balao de desenho animado virado
// para a camera, com teste de profundidade suave contra a cena (G-buffer)
// ---------------------------------------------------------------------------
export const FX_VS = `#version 300 es
in vec4 aP;   // x y z raio
in vec4 aQ;   // idade(0..1) tipo semente -
uniform vec3 uCamPos, uCamF, uCamR, uCamU;
uniform float uTanX, uHW;
out vec2 vC;
out vec4 vQ;
out float vDist, vR;
const float WORLD = 16384.0;
float wrapf(float d) { return d - WORLD * floor(d / WORLD + 0.5); }
void main() {
    vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    vec3 d = aP.xyz - uCamPos;
    d.x = wrapf(d.x); d.y = wrapf(d.y);
    float r = aP.w, z = dot(d, uCamF);
    vC = c * 1.15; vQ = aQ; vR = r; vDist = length(d);
    if (z < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float zz = max(z, r * 0.7);
    vec2 s = vec2(dot(d, uCamR) / (zz * uTanX), dot(d, uCamU) / (zz * uTanX * uHW));
    vec2 rad = vec2(r / (zz * uTanX), r / (zz * uTanX * uHW)) * 1.15;
    gl_Position = vec4(s + c * rad, 0.0, 1.0);
}`;
export const FX_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uG, uA;   // G-buffer do mundo (baixa resolucao) e distancia da malha do aviao (tela)
uniform vec2 uOrigin, uGS;
uniform vec3 uSun, uCamF, uCamR, uCamU, uLight, uShade;
in vec2 vC;
in vec4 vQ;
in float vDist, vR;
out vec4 oColor;
const int FLASH = 0, FIRE = 1, SPARK = 2, SMOKE = 3, STEAM = 4, SPRAY = 5;
void main() {
    float age = vQ.x, seed = vQ.z;
    int kind = int(vQ.y + 0.5);
    // contorno "fofo": o raio varia um pouco com o angulo
    float ang = atan(vC.y, vC.x);
    float wob = kind == SPARK ? 1.0 : 1.0 + 0.07 * sin(ang * 5.0 + seed * 40.0) + 0.04 * sin(ang * 9.0 - seed * 23.0);
    float rr = length(vC) / wob;
    if (rr > 1.0) discard;
    float nz = sqrt(max(0.0, 1.0 - rr * rr));
    // profundidade da superficie do balao e teste suave contra a cena
    float depth = vDist - vR * nz;
    vec2 sp = gl_FragCoord.xy - uOrigin;
    float sceneT = texelFetch(uG, ivec2(sp * uGS), 0).x;
    float meshT = texelFetch(uA, ivec2(sp), 0).w;          // o destroco tambem esconde o que esta atras
    if (meshT > 0.0) sceneT = min(sceneT, meshT);
    float soft = clamp((sceneT - depth) / (0.35 * vR + 0.3), 0.0, 1.0);
    if (soft <= 0.0) discard;
    float fw = max(fwidth(rr), 1e-3);
    vec3 col; float a, add = 0.0;
    if (kind == FLASH) {
        col = rr < 0.55 ? vec3(1.0, 1.0, 0.86) : vec3(1.0, 0.62, 0.22);
        a = (1.0 - age) * (1.0 - age);
        add = 0.5;
    } else if (kind == FIRE) {
        // tres faixas: miolo amarelo, meio laranja, borda vermelha; esfria com a idade
        float b = rr + 0.3 * age;
        vec3 hot = vec3(1.0, 0.93, 0.55), orng = vec3(1.0, 0.50, 0.09), red = vec3(0.88, 0.12, 0.05), soot = vec3(0.22, 0.12, 0.10);
        if (b < 0.45) col = mix(hot, orng, smoothstep(0.3, 0.7, age));
        else if (b < 0.78) col = mix(orng, red, smoothstep(0.15, 0.55, age));
        else col = mix(red, soot, smoothstep(0.35, 0.85, age));
        a = 1.0 - smoothstep(0.7, 1.0, age);
        add = 0.25 * (1.0 - age);
    } else if (kind == SPARK) {
        col = mix(vec3(1.0, 0.92, 0.55), vec3(1.0, 0.42, 0.08), age);
        a = 1.0 - smoothstep(0.6, 1.0, age);
        add = 0.3;
    } else {
        // fumaca, vapor e respingos: iluminados em faixas, como o resto do mundo
        vec3 n = normalize(uCamR * (vC.x / wob) + uCamU * (vC.y / wob) - uCamF * nz);
        float band = dot(n, uSun) > 0.1 ? 1.0 : 0.0;
        vec3 base = kind == SMOKE ? vec3(mix(0.16, 0.42, smoothstep(0.0, 0.7, age))) : vec3(0.95, 0.96, 0.98);
        vec3 shade = mix(uShade, vec3(dot(uShade, vec3(0.333))), 0.6);   // sombra menos azulada
        col = base * mix(shade, uLight, band) * (kind == SMOKE ? 1.25 : 1.0);
        if (kind == SMOKE) col += vec3(0.55, 0.14, 0.03) * (1.0 - smoothstep(0.0, 0.2, age)) * (1.0 - rr);  // brasa por baixo
        if (kind == SPRAY) a = 1.0 - smoothstep(0.6, 1.0, age);
        else a = (1.0 - smoothstep(0.45, 1.0, age)) * smoothstep(0.0, 0.06, age) * (kind == SMOKE ? 0.94 : 0.8);
    }
    // contorno de desenho; some junto quando o balao fica transparente (sem aneis sobrepostos)
    if (kind != FLASH && kind != SPARK && rr > 1.0 - 1.8 * fw) col *= mix(1.0, 0.5, smoothstep(0.35, 0.8, a));
    a *= (1.0 - smoothstep(1.0 - fw, 1.0, rr)) * soft;
    oColor = vec4(col * a, a * (1.0 - add));
}`;
