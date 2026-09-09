/* ------------------------------------------------------------------
   Shiny Sticker — WebGL pipeline.
   Two passes:
     1. sdf       : distance-to-nearest-opaque-pixel, quarter res. Cached —
                    only re-runs when the source or the padding changes.
     2. composite : shadow -> die-cut border -> artwork + flake mosaic
   Everything is authored in "design px" (output px / exportScale) so the
   flake size stays constant whatever resolution you export at.

   Coordinate convention: vUV is TOP-DOWN (0,0 = top-left) so it matches
   image space. The SDF is a render target whose rows run bottom-up, so it
   is read back through sdfUV(). Don't undo either half without the other.
------------------------------------------------------------------- */

const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main(){ vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uOutSize;
uniform vec2 uPad;
uniform vec2 uSrcSize;
uniform float uMaxDist;

float sampleA(vec2 px){
  vec2 uv = (px - uPad) / uSrcSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture2D(uSrc, uv).a;
}
`;

/* ---- pass 1: coarse ring search + local refine -> normalised distance ---- */
const FRAG_SDF = COMMON + `
void main(){
  vec2 px = vUV * uOutSize;
  float d = uMaxDist;

  if (sampleA(px) > 0.5) {
    d = 0.0;
  } else {
    float coarse = uMaxDist;
    for (int r = 1; r <= 12; r++){
      float rad = uMaxDist * float(r) / 12.0;
      for (int t = 0; t < 16; t++){
        float ang = 6.2831853 * float(t) / 16.0 + float(r) * 0.61;
        if (sampleA(px + rad * vec2(cos(ang), sin(ang))) > 0.5) coarse = min(coarse, rad);
      }
    }
    d = coarse;
    float lo = max(0.0, coarse - uMaxDist / 12.0);
    for (int k = 1; k < 8; k++){
      float rad = lo + (coarse - lo) * float(k) / 8.0;
      for (int t = 0; t < 16; t++){
        float ang = 6.2831853 * float(t) / 16.0 + float(k) * 1.13;
        if (sampleA(px + rad * vec2(cos(ang), sin(ang))) > 0.5) d = min(d, rad);
      }
    }
  }
  gl_FragColor = vec4(d / uMaxDist, 0.0, 0.0, 1.0);
}
`;

/* ---- pass 2: the actual look ---- */
const FRAG_COMPOSITE = COMMON + `
uniform sampler2D uSDF;
uniform float uScale;
uniform int   uMode;
uniform float uIntensity;
uniform float uFlakeScale;
uniform float uSpread;
uniform float uSparkle;
uniform float uAngle;
uniform float uSeed;
uniform float uGloss;
uniform float uTint;
uniform float uHoloMix;
uniform float uHoloAuto;
uniform float uHoloLift;
uniform float uHoloN;
uniform vec3  uHoloPal0;
uniform vec3  uHoloPal1;
uniform vec3  uHoloPal2;
uniform vec3  uHoloPal3;
uniform vec3  uHoloPal4;
uniform vec3  uHoloPal5;
uniform float uColorVary;
uniform float uJitter;
uniform float uCover;
uniform float uVary;
uniform float uBorder;
uniform float uBorderW;
uniform float uBorderHolo;
uniform float uShadow;
uniform float uShadowBlur;
uniform float uShadowOpacity;
uniform vec2  uShadowOff;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Cosine palette — full spectrum, no muddy midpoints.
vec3 pal(float t){
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 hardLight(vec3 b, vec3 s){
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), s));
}

// solid = how much the flake occludes the ink rather than interacting with it.
vec3 layFlake(vec3 b, vec3 s, float solid){
  return mix(mix(hardLight(b, s), mix(b, s, 0.45), 0.26), s, solid);
}

// The user's palette for the holo flashes: each flake picks one at random.
vec3 pickPal(float r){
  float k = r * uHoloN;
  vec3 c = uHoloPal0;
  if (k > 1.0) c = uHoloPal1;
  if (k > 2.0) c = uHoloPal2;
  if (k > 3.0) c = uHoloPal3;
  if (k > 4.0) c = uHoloPal4;
  if (k > 5.0) c = uHoloPal5;
  return c;
}

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float dd = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, dd, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

/* One layer of overlapping metallic discs — a full mosaic, no gaps.
   Returns rgb + coverage, plus specular and per-pixel holo coverage.

   tintAmt 0 = pure spectral holo.
   tintAmt 1 = each disc takes the colour of the artwork under its centre,
               drifted by uColorVary, with uHoloMix of them as flashes in
               either the auto spectrum or the user's palette.             */
vec4 flakes(vec2 pd, float cell, float rMin, float rMax, float soft, float salt,
            float tintAmt, vec3 fallback, out float spec, out float holoCov){
  float cs = max(cell, 0.5);
  vec2 gp = pd / cs;
  vec2 g = floor(gp), f = fract(gp);
  vec3 col = vec3(0.0);
  float cov = 0.0;
  spec = 0.0;
  holoCov = 0.0;
  float sd = uSeed + salt;
  vec2 ldir = vec2(cos(uAngle), sin(uAngle));
  float sweep = dot(pd, ldir) * 0.0026;

  // Two z-tiers, so overlapping discs don't all stack in one diagonal
  // direction — the mosaic boundaries come out random, like a real sheet.
  for (int tier = 0; tier < 2; tier++){
    for (int j = -1; j <= 1; j++){
      for (int i = -1; i <= 1; i++){
        vec2 o = vec2(float(i), float(j));
        vec2 id = g + o;
        float z = hash12(id + sd + 61.7);
        if (tier == 0 && z >= 0.5) continue;
        if (tier == 1 && z <  0.5) continue;

        vec2 h = hash22(id + sd);
        vec2 c = o + 0.5 + (h - 0.5) * uJitter;
        float rad = mix(rMin, rMax, hash12(id + sd + 11.3)) * uCover;
        float dd = length(f - c);
        float m = smoothstep(rad, rad * soft, dd);
        m *= 1.0 - uVary * hash12(id + sd + 17.1);
        if (m <= 0.001) continue;

        float b = hash12(id + sd + 8.9);
        // each disc catches the light from one side, like a real sequin
        float lit = 0.5 + 0.5 * dot(normalize(f - c + 1e-4), ldir);

        float hue = hash12(id + sd + 3.7);
        vec3 rainbow = clamp(pal(hue * uSpread + sweep)
                             * (0.62 + 0.5 * b) * (0.78 + 0.44 * lit), 0.0, 1.0);
        vec3 fc = rainbow;
        float thisHolo = 0.0;

        if (tintAmt > 0.001){
          // sample the artwork at the disc's CENTRE — the whole flake is one
          // colour, a sequin on the ink rather than a filter over it
          vec2 cuv = ((g + c) * cs * uScale - uPad) / uSrcSize;
          vec4 os = vec4(0.0);
          if (cuv.x >= 0.0 && cuv.x <= 1.0 && cuv.y >= 0.0 && cuv.y <= 1.0) os = texture2D(uSrc, cuv);
          vec3 objc = mix(fallback, os.rgb, step(0.35, os.a));

          float ol = dot(objc, LUMA);
          vec3 sat = clamp(mix(vec3(ol), objc, 1.35), 0.0, 1.0);

          // per-flake drift around the object's own hue
          vec3 hsv = rgb2hsv(sat);
          hsv.x = fract(hsv.x + (hash12(id + sd + 41.3) - 0.5) * 0.20 * uColorVary);
          hsv.y = clamp(hsv.y * (1.0 - 0.6 * uColorVary * hash12(id + sd + 43.7))
                        + 0.10 * uColorVary * hash12(id + sd + 47.9), 0.0, 1.0);
          vec3 objV = hsv2rgb(hsv);

          // target lightness for this facet: anchored to the object, with a
          // floor so dark ink still throws visible flashes
          float facet = (0.55 + 0.95 * b) * (0.84 + 0.32 * lit);
          float fLum = clamp(ol * facet + (1.0 - ol) * 0.20 * b * b, 0.0, 1.0);
          vec3 tinted = clamp(objV * (fLum / max(dot(objV, LUMA), 0.02)), 0.0, 1.0);

          // the flashes: auto spectrum, or one of the user's palette colours,
          // recoloured AT THAT SAME LIGHTNESS so a black sticker stays black
          vec3 holoBase = mix(pickPal(hash12(id + sd + 71.3)), rainbow, uHoloAuto);
          vec3 hb = rgb2hsv(holoBase);
          hb.x = fract(hb.x + (hash12(id + sd + 51.1) - 0.5) * 0.14 * uColorVary);
          hb.y = clamp(hb.y * (1.0 - 0.35 * uColorVary * hash12(id + sd + 53.3)), 0.0, 1.0);
          holoBase = hsv2rgb(hb);
          vec3 iri = clamp(holoBase * (fLum / max(dot(holoBase, LUMA), 0.03)) * uHoloLift, 0.0, 1.0);
          tinted = mix(tinted, iri, 0.12);

          // in auto mode dark ink keeps its flashes near-monochrome like real
          // film; a hand-picked palette is left alone
          float chromaOK = mix(1.0, 0.3 + 0.7 * sqrt(clamp(ol * 1.6, 0.0, 1.0)), uHoloAuto);
          float isHolo = step(1.0 - uHoloMix, hash12(id + sd + 21.7));
          vec3 holoCol = mix(iri, vec3(fLum * 1.15 * uHoloLift),
                             mix(0.16, 0.35, uHoloAuto) * hash12(id + sd + 27.3));
          holoCol = mix(vec3(dot(holoCol, vec3(0.333))), holoCol, chromaOK);

          fc = mix(mix(rainbow, tinted, tintAmt), clamp(holoCol, 0.0, 1.0), isHolo * tintAmt);
          thisHolo = isHolo * tintAmt;
        }

        float sp = pow(hash12(id + sd + 5.1), 5.0) * (0.35 + 0.65 * lit);
        col = mix(col, fc, m);
        holoCov = mix(holoCov, thisHolo, m);
        cov = max(cov, m);
        spec = max(spec, sp * m);
      }
    }
  }
  return vec4(col, cov);
}

// Oil-slick foil: domain-warped fbm driving the palette.
vec4 foil(vec2 pd, out float spec){
  vec2 q = pd / max(150.0 * uFlakeScale, 1.0);
  vec2 w = vec2(fbm(q * 1.7 + uSeed + 3.1), fbm(q * 1.7 + uSeed + 7.7));
  float n = fbm(q + w * 1.1 + uSeed);
  float sweep = dot(pd, vec2(cos(uAngle), sin(uAngle))) * 0.0018;
  vec3 col = pal(n * 2.6 * uSpread + sweep);
  spec = pow(clamp((n - 0.45) * 3.0, 0.0, 1.0), 3.0);
  return vec4(col, 1.0);
}

// The SDF is a render target — its rows run bottom-up while vUV is top-down.
vec2 sdfUV(vec2 uv){ return vec2(uv.x, 1.0 - uv.y); }

vec4 over(vec4 s, vec4 d){
  float a = s.a + d.a * (1.0 - s.a);
  vec3 c = (s.rgb * s.a + d.rgb * d.a * (1.0 - s.a)) / max(a, 1e-5);
  return vec4(c, a);
}

void main(){
  vec2 px = vUV * uOutSize;
  vec2 pd = px / uScale;

  vec2 suv = (px - uPad) / uSrcSize;
  vec4 src = vec4(0.0);
  if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) src = texture2D(uSrc, suv);

  float d = texture2D(uSDF, sdfUV(vUV)).r * uMaxDist;
  float bw = uBorderW * uScale;

  // ---- artwork + flake mosaic ----------------------------------------
  vec4 artL = vec4(0.0);
  if (src.a > 0.002){
    float sp1 = 0.0, sp2 = 0.0, hc1 = 0.0, hc2 = 0.0;
    vec4 fl = vec4(0.0), fl2 = vec4(0.0);
    if (uMode == 0) {                       // sequin confetti — one even layer
      fl  = flakes(pd, 10.5 * uFlakeScale, 0.64, 0.78, 0.94,  0.0, uTint, src.rgb, sp1, hc1);
    } else if (uMode == 1) {                // fine glitter dust
      fl  = flakes(pd,  4.6 * uFlakeScale, 0.60, 0.76, 0.80,  0.0, uTint, src.rgb, sp1, hc1);
      fl2 = flakes(pd,  2.1 * uFlakeScale, 0.44, 0.62, 0.66, 31.7, uTint, src.rgb, sp2, hc2);
    } else {                                // prismatic foil
      fl  = foil(pd, sp1);
      // Object tint is hidden on the Foil tab (Rikki, 2026-09-09) and the Foil
      // preset pins uTint to 0, so this branch is unreachable from the panel.
      // Kept because it is correct and one line in HIDDEN brings it back.
      if (uTint > 0.001) {
        // Tint must COLOUR the foil, not erase it. The old version keyed off
        // the foil's luminance, which pal() keeps nearly flat — the swirl lives
        // in the hue — so tinting collapsed to a flat wash of the artwork.
        // Instead: keep the foil's light/dark as a modulation of the artwork's
        // own lightness (same luminance matching the flake path uses, so a
        // black sticker stays black), take hue and saturation from the artwork,
        // and leave a narrow hue swing so it still reads as iridescent.
        vec3  oh = rgb2hsv(src.rgb);
        vec3  fh = rgb2hsv(fl.rgb);
        float ol = dot(src.rgb, LUMA);
        float f  = fh.z;

        // Lightness is ALWAYS matched to the artwork, whatever the hue does —
        // that is what keeps a black sticker black. Do not let the hue blend
        // below feed back into L, or neutrals bleach out (the old chroma-gate
        // bug in the flake path).
        float L = clamp(ol * (0.55 + 0.9 * f) + (1.0 - ol) * 0.28 * f * f, 0.0, 1.0);

        // A coloured artwork lends its own hue; a neutral one (black, white,
        // grey) has no hue to lend, so the foil keeps a muted version of its
        // own. Black holo foil is dark AND iridescent, not flat black.
        float w = clamp(oh.y * 2.2, 0.0, 1.0);
        float hue = mix(fh.x, fract(oh.x + (fh.x - 0.5) * 0.16), w);
        float sat = mix(fh.y * 0.55, oh.y * (0.85 + 0.30 * f), w);

        vec3 tf = hsv2rgb(vec3(hue, clamp(sat, 0.0, 1.0), L));
        fl.rgb = mix(fl.rgb, tf, uTint);
      }
    }

    // Keep the mosaic off the artwork's antialiased rim. Without this the
    // flakes are laid at full strength on half-transparent edge pixels, which
    // then composite over the die-cut and read as colour leaking past it.
    // Genuinely translucent artwork (a 50%-opacity layer) still gets ~0.9.
    float core = smoothstep(0.06, 0.62, src.a);

    vec3 art = mix(src.rgb, src.rgb * 0.9 + 0.07, 0.3);   // gentle plastic lift

    // base diffraction sheen — fades out entirely as Object tint comes up
    float band = dot(pd, vec2(cos(uAngle), sin(uAngle))) * 0.004 * uSpread;
    vec3 sheen = mix(vec3(0.5), pal(band + 0.1), 0.85);
    art = mix(art, hardLight(art, sheen), 0.19 * uIntensity * (1.0 - uTint));

    // the mosaic. Shimmer scales how solidly it covers the ink.
    float solidity = mix(0.75, 0.30, uHoloAuto);
    // Foil composites straight in proportion to tint. layFlake at solid = 0 is
    // essentially hard-light, and hard-light can never lift a black base, so a
    // black sticker showed no tinted foil at all. The tinted colour is already
    // luminance-matched, so laying it straight is both correct and visible.
    float solid1 = (uMode == 2) ? uTint * 0.92 : hc1 * solidity;
    float a1 = clamp(fl.a * uIntensity * 0.78, 0.0, 1.0) * core;
    art = mix(art, layFlake(art, fl.rgb, solid1), a1);
    float a2 = clamp(fl2.a * uIntensity * 0.6, 0.0, 1.0) * core;
    art = mix(art, layFlake(art, fl2.rgb, hc2 * solidity), a2);

    // flakes catch the most light where the ink is dark (rainbow mode only)
    float luma = dot(src.rgb, LUMA);
    art += (fl.rgb * a1 + fl2.rgb * a2 * 0.6) * (1.0 - luma) * 0.28 * uIntensity * (1.0 - 0.8 * uTint);
    art += (sp1 * a1 + sp2 * a2 * 0.6) * uSparkle * 0.95;

    float gloss = smoothstep(1.0, 0.05, length(vUV - vec2(0.32, 0.24)) * 1.55);
    art += gloss * 0.10 * uGloss;

    artL = vec4(clamp(art, 0.0, 1.0), src.a);
  }

  // ---- die-cut border (only evaluated where it can show) ---------------
  vec4 borderL = vec4(1.0, 1.0, 1.0, 0.0);
  if (uBorder > 0.5 && src.a < 0.995){
    float borderMask = 1.0 - smoothstep(bw - 1.2, bw + 1.2, d);
    if (borderMask > 0.001){
      vec3 bcol = vec3(0.985);
      if (uBorderHolo > 0.002){
        float bsp = 0.0, bhc = 0.0;
        vec4 bf = flakes(pd, 7.0 * uFlakeScale, 0.62, 0.76, 0.85, 5.3, 0.0, vec3(0.9), bsp, bhc);
        vec3 bfc = mix(vec3(dot(bf.rgb, vec3(0.333))), bf.rgb, 0.16);
        vec3 silver = layFlake(vec3(0.9), mix(vec3(0.88), bfc, bf.a * 0.5), 0.0);
        bcol = mix(bcol, clamp(silver + bsp * 0.4, 0.0, 1.0), uBorderHolo);
      }
      borderL = vec4(bcol, borderMask);
    }
  }

  // ---- drop shadow -------------------------------------------------------
  float shA = 0.0;
  if (uShadow > 0.5){
    vec2 off = uShadowOff * uScale;
    vec2 s2 = (px - off) / uOutSize;
    float d2 = uMaxDist;
    if (s2.x >= 0.0 && s2.x <= 1.0 && s2.y >= 0.0 && s2.y <= 1.0) d2 = texture2D(uSDF, sdfUV(s2)).r * uMaxDist;
    float edge = (uBorder > 0.5) ? bw : 0.0;
    shA = (1.0 - smoothstep(edge, edge + max(uShadowBlur * uScale, 1.0), d2)) * uShadowOpacity;
  }
  vec4 shadowL = vec4(vec3(0.02, 0.02, 0.06), shA);

  vec4 res = shadowL;
  res = over(borderL, res);
  res = over(artL, res);
  gl_FragColor = res;
}
`;

/* ------------------------------------------------------------------ */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

function program(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

class HoloRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: true
    });
    if (!gl) throw new Error('WebGL is unavailable in this window.');
    this.gl = gl;

    this.pSDF = program(gl, FRAG_SDF);
    this.pComp = program(gl, FRAG_COMPOSITE);
    this._loc = new Map();

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.srcTex = gl.createTexture();
    this.sdfTex = gl.createTexture();
    this.fbo = gl.createFramebuffer();
    [this.srcTex, this.sdfTex].forEach((t) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    });
    this._gen = 0;
    this._sdfKey = null;
  }

  setSource(bitmap) {
    const gl = this.gl;
    this.srcW = bitmap.width;
    this.srcH = bitmap.height;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this._gen++;
  }

  _u(P, name) {
    const key = P === this.pSDF ? 's:' + name : 'c:' + name;
    let l = this._loc.get(key);
    if (l === undefined) { l = this.gl.getUniformLocation(P, name); this._loc.set(key, l); }
    return l;
  }

  /**
   * k — render scale factor (1 = full res, <1 = preview)
   * o — options, all sizes in design px
   */
  render(o, k) {
    const gl = this.gl;
    const scale = o.exportScale * k;
    const padOut = Math.ceil(o.pad * scale);
    const maxDist = Math.max(padOut, 6);
    const srcW = this.srcW * k;
    const srcH = this.srcH * k;
    const outW = Math.max(2, Math.round(srcW + padOut * 2));
    const outH = Math.max(2, Math.round(srcH + padOut * 2));

    // --- pass 1: SDF at quarter res, cached across slider drags ----
    const sw = Math.max(2, Math.ceil(outW / 4));
    const sh = Math.max(2, Math.ceil(outH / 4));
    const key = [this._gen, outW, outH, padOut, maxDist].join(':');
    if (key !== this._sdfKey) {
      gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sdfTex, 0);
      gl.viewport(0, 0, sw, sh);
      gl.useProgram(this.pSDF);
      this._common(this.pSDF, outW, outH, padOut, srcW, srcH, maxDist);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(this._u(this.pSDF, 'uSrc'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this._sdfKey = key;
    }

    // --- pass 2: composite to the canvas --------------------------
    this.canvas.width = outW;
    this.canvas.height = outH;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.pComp);
    const P = this.pComp;
    this._common(P, outW, outH, padOut, srcW, srcH, maxDist);
    const u = (n) => this._u(P, n);
    gl.uniform1f(u('uScale'), scale);
    gl.uniform1i(u('uMode'), o.mode);
    gl.uniform1f(u('uIntensity'), o.intensity);
    gl.uniform1f(u('uFlakeScale'), o.flakeScale);
    gl.uniform1f(u('uSpread'), o.spread);
    gl.uniform1f(u('uSparkle'), o.sparkle);
    gl.uniform1f(u('uAngle'), (o.angle * Math.PI) / 180);
    gl.uniform1f(u('uSeed'), o.seed);
    gl.uniform1f(u('uGloss'), o.gloss);
    gl.uniform1f(u('uTint'), o.tint);
    gl.uniform1f(u('uHoloMix'), o.holoMix);
    gl.uniform1f(u('uHoloAuto'), o.holoAuto ? 1 : 0);
    gl.uniform1f(u('uHoloLift'), o.holoLift);
    const pal = o.holoPal && o.holoPal.length ? o.holoPal : [[0.93, 0.92, 0.96]];
    gl.uniform1f(u('uHoloN'), pal.length);
    for (let i = 0; i < 6; i++) {
      const c = pal[Math.min(i, pal.length - 1)];
      gl.uniform3f(u('uHoloPal' + i), c[0], c[1], c[2]);
    }
    gl.uniform1f(u('uColorVary'), o.colorVary);
    gl.uniform1f(u('uJitter'), o.jitter);
    gl.uniform1f(u('uCover'), o.cover);
    gl.uniform1f(u('uVary'), o.vary);
    gl.uniform1f(u('uBorder'), o.border ? 1 : 0);
    gl.uniform1f(u('uBorderW'), o.borderW);
    gl.uniform1f(u('uBorderHolo'), o.borderHolo);
    gl.uniform1f(u('uShadow'), o.shadow ? 1 : 0);
    gl.uniform1f(u('uShadowBlur'), o.shadowBlur);
    gl.uniform1f(u('uShadowOpacity'), o.shadowOpacity);
    gl.uniform2f(u('uShadowOff'), o.shadowX, o.shadowY);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(u('uSrc'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
    gl.uniform1i(u('uSDF'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return { width: outW, height: outH, padOut: padOut, scale: scale };
  }

  _common(P, outW, outH, pad, srcW, srcH, maxDist) {
    const gl = this.gl;
    gl.uniform2f(this._u(P, 'uOutSize'), outW, outH);
    gl.uniform2f(this._u(P, 'uPad'), pad, pad);
    gl.uniform2f(this._u(P, 'uSrcSize'), srcW, srcH);
    gl.uniform1f(this._u(P, 'uMaxDist'), maxDist);
  }
}

if (typeof module !== 'undefined') module.exports = { HoloRenderer, FRAG_SDF, FRAG_COMPOSITE, VERT };
