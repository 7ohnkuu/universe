// =============================================================================
//  太陽系行星運動展示 + 外部黑洞引力透鏡  (three.js)
//  - 真實克卜勒軌道 (解克卜勒方程, 含偏心率/傾角/升交點/近日點幅角)
//  - GPU 加速: 太陽/吸積盤/星空著色器, 引力透鏡後處理, HDR Bloom
//  - 距離為可視化壓縮 (a^0.65), 但週期比/偏心率/傾角皆為真實數據
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// 介面文字一律經 __i18n (由 index.html 在 main.js 之前以傳統 script 同步載入,
// module 一律 defer, 所以這裡一定拿得到)。
// 拿不到 (i18n.js 本身載入失敗) 時退回下面這張中文表 —— index.html 的預置文字
// 本來就是中文, 兩者一致; 不能退回「把 key 當文字」, 那會把對的中文蓋壞。
const I18N = window.__i18n || null;
const HAS_I18N = !!I18N;
const ZH = {
  'loader.tex':   (v) => `載入中 · 貼圖 ${v.done}/${v.total}`,
  'unit.yrPerSec': (v) => v.v + ' 年/秒',
  'btn.pause':    () => '⏸ 暫停',
  'btn.play':     () => '▶ 播放',
  'label.bh':     () => '黑洞 (引力透鏡)',
  'err.texFail':  () => '貼圖載入失敗 (將使用程序化/純色降級):',
  'err.patchInclude': () => '晨昏線 patch: 找不到 lights_physical_pars_fragment include, 維持原始著色',
  'err.patchDiffuse': () => '晨昏線 patch: 找不到 directDiffuse 注入點, 維持原始著色',
};
const t = HAS_I18N ? I18N.t : (k, v) => (ZH[k] ? ZH[k](v) : k);
// 行星顯示名: 邏輯鍵就是中文名, 無字典時原樣回傳即正確
const pname = HAS_I18N ? I18N.pname : (n) => n;

// 啟動探針: 只要模組開始求值就設為 true, 讓 index.html 看門狗能區分
// 「模組沒載入 (vendor/ 缺失)」與「載入了但初始化出錯」
window.__universeBooted = true;
const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

// -----------------------------------------------------------------------------
//  行星真實數據  (a: AU, e: 偏心率, period: 年, radiusKm, incl/node/peri: 度,
//  tilt: 自轉軸傾角, spinHr: 自轉週期(負=逆行), type 用於貼圖)
// -----------------------------------------------------------------------------
const PLANETS = [
  { name:'水星', a:0.39, e:0.206, period:0.241,  radiusKm:2440,  incl:7.00, node:48.3, peri:29.1,  tilt:0.03,  spinHr:1407.6,  type:'rocky', color:[140,140,140], seed:11 },
  { name:'金星', a:0.72, e:0.007, period:0.615,  radiusKm:6052,  incl:3.39, node:76.7, peri:54.9,  tilt:177.4, spinHr:-5832.5, type:'rocky', color:[226,194,122], seed:22 },
  { name:'地球', a:1.00, e:0.017, period:1.000,  radiusKm:6371,  incl:0.00, node:0.0,  peri:114.2, tilt:23.44, spinHr:23.93,   type:'earth', color:[42,111,219], seed:33, moon:true },
  { name:'火星', a:1.52, e:0.093, period:1.881,  radiusKm:3390,  incl:1.85, node:49.6, peri:286.5, tilt:25.19, spinHr:24.62,   type:'rocky', color:[193,68,14],  seed:44 },
  { name:'木星', a:5.20, e:0.049, period:11.86,  radiusKm:69911, incl:1.30, node:100.5,peri:273.9, tilt:3.13,  spinHr:9.93,    type:'gas',   color:[216,180,140], color2:[150,110,80], bands:14, seed:55 },
  { name:'土星', a:9.58, e:0.056, period:29.46,  radiusKm:58232, incl:2.49, node:113.7,peri:339.4, tilt:26.73, spinHr:10.7,    type:'gas',   color:[227,210,162], color2:[180,160,110], bands:10, seed:66, ring:true },
  { name:'天王星',a:19.2, e:0.046, period:84.0,   radiusKm:25362, incl:0.77, node:74.0, peri:96.9,  tilt:97.77, spinHr:-17.24,  type:'ice',   color:[159,224,230], seed:77 },
  { name:'海王星',a:30.0, e:0.009, period:164.8,  radiusKm:24622, incl:1.77, node:131.8,peri:273.2, tilt:28.32, spinHr:16.11,   type:'ice',   color:[59,91,219],  seed:88 },
];

// 距離壓縮係數 (讓內外行星都可視), 行星大小相對比保持真實
const DIST_K = 66;
const distScale = a => Math.pow(a, 0.65) * DIST_K;
const SUN_R = 16;                 // 太陽視覺半徑
const JUP_R = 8;                  // 木星視覺半徑 (其餘行星依真實半徑比)
PLANETS.forEach(p => { p.aDisp = distScale(p.a); p.rDisp = (p.radiusKm / 69911) * JUP_R; p.M0 = Math.random() * TWO_PI; });

// -----------------------------------------------------------------------------
//  場景 / 相機 / 渲染器
// -----------------------------------------------------------------------------
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 30000);
const CAM_HOME = new THREE.Vector3(0, 320, 900);
camera.position.copy(CAM_HOME);

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 陰影每幀更新 (mapSize 已降 1024² + far 700, 成本 1/16); 節拍刷新會欠採樣月球陰影
app.appendChild(renderer.domElement);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

// CSS2D 標籤層
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
const labelLayer = document.getElementById('labels');
labelLayer.appendChild(labelRenderer.domElement);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';

// 微弱星際環境光 (PMREM IBL): 夜面不再純黑, 海洋獲得 GGX 高光
function buildEnvTexture(){
  const W = 64, H = 32, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0e1e'); g.addColorStop(0.5, '#05070f'); g.addColorStop(1, '#000000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(60,50,40,0.25)'; ctx.fillRect(0, H/2 - 1, W, 2); // 黃道面暖帶
  for (let i = 0; i < 40; i++){ ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + Math.random()*0.5) + ')'; ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(buildEnvTexture()).texture;
pmrem.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 8000;
controls.minDistance = 30;

// 黃道面群組: 將標準軌道數學 (x-y 平面) 旋轉成水平 (x-z 平面)
const ecliptic = new THREE.Group();
ecliptic.rotation.x = -Math.PI / 2;
scene.add(ecliptic);

// 可被點擊聚焦的物件 (行星/太陽/黑洞)
const clickable = [];
const clickProxyMat = new THREE.MeshBasicMaterial(); // 共用的隱形點擊代理材質 (r160: visible=false 仍可 raycast)

// -----------------------------------------------------------------------------
//  光源: 太陽為點光源 (產生真實明暗與行星陰影)
// -----------------------------------------------------------------------------
// decay=0 (不隨距離衰減) 下, intensity 6.0 讓所有行星向陽面線性亮度衝到 2-3,
// 整面超過 bloom 閾值 -> 過度發光 + bloom mip 方塊偽影 (金星截圖)。
// 1.3 時行星日面峰值 ≈ albedo(0.9)×1.3 ≈ 1.17; 加上疊加混合的星點 (≤0.5) 仍 < 閾值(2.0)
// -> 任何表面/星點都不進輝光鏈; 只有太陽 (×3.0) 與吸積盤 (col×2.0) 超過閾值發光。
const sunLight = new THREE.PointLight(0xfff3e0, 1.3, 0, 0.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);   // 立方陰影 6 面 × 此尺寸; 只用來表現月球/環食, 不需極限解析度
sunLight.shadow.normalBias = 0.3;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 700;          // 覆蓋海王星軌道 (~610), 原 4000 浪費深度精度
sunLight.shadow.bias = -0.0005;
ecliptic.add(sunLight);
scene.add(new THREE.AmbientLight(0x223344, 0.06)); // 極弱環境光, 保留夜面真實感

// =============================================================================
//  星空 (GPU Points + 閃爍著色器)
// =============================================================================
function buildStars() {
  const N = 9000, R = 12000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const size = new Float32Array(N);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // 均勻分佈在球殼上
    const u = Math.random() * 2 - 1, t = Math.random() * TWO_PI;
    const r = Math.sqrt(1 - u * u);
    pos[i*3] = R * r * Math.cos(t);
    pos[i*3+1] = R * u;
    pos[i*3+2] = R * r * Math.sin(t);
    const hue = 0.55 + (Math.random() - 0.5) * 0.15;
    c.setHSL(hue, 0.4, 0.35 + Math.random() * 0.25);
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    phase[i] = Math.random() * TWO_PI;
    size[i] = 1.0 + Math.random() * 2.5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float phase; attribute float aSize; attribute vec3 color;
      uniform float uTime; uniform float uPixel; varying vec3 vCol; varying float vTw;
      void main(){
        vCol = color;
        vTw = 0.6 + 0.4 * sin(uTime * 1.5 + phase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixel * vTw * 1.1;   // 固定球殼半徑: 距離項會使尺寸坍縮到次像素
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vTw;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a = 1.0 - smoothstep(0.0, 0.5, length(d));
        // 亮度遠低於 bloom threshold(1.7): 星點不得進入輝光鏈, 否則被渲染成方塊偽影
        gl_FragColor = vec4(vCol * vTw * 0.5, a);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  scene.add(pts);
  return m;
}
const starMat = buildStars();

// =============================================================================
//  太陽 (GLSL fbm 湍流 + HDR 自發光)
// =============================================================================
const sunUniforms = { uTime: { value: 0 } };
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_R, 64, 64),
  new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: `varying vec3 vN; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vN; varying vec2 vUv; uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
      float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }
      void main(){
        vec2 p = vUv * vec2(6.0, 3.0);
        float n = fbm(p + vec2(uTime*0.05, uTime*0.03));
        float n2 = fbm(p*2.0 - uTime*0.08);
        float h = n*0.7 + n2*0.3;
        vec3 deep = vec3(0.9, 0.25, 0.02);
        vec3 mid  = vec3(1.0, 0.6, 0.12);
        vec3 hot  = vec3(1.0, 0.95, 0.7);
        vec3 col = mix(deep, mid, smoothstep(0.2,0.55,h));
        col = mix(col, hot, smoothstep(0.55,0.9,h));
        // 邊緣增亮 (臨邊昏暗反向, 讓輝光更強)
        float rim = pow(clamp(1.0 - abs(vN.z), 0.0, 1.0), 1.5);
        col += rim * vec3(1.0,0.5,0.2) * 0.3;
        gl_FragColor = vec4(col * 3.0, 1.0);  // 熱區 ~2.5 超過 bloom threshold(2.0) -> 柔和暈, 顆粒紋理仍清晰
      }`,
  })
);
sun.position.set(0, 0, 0);
ecliptic.add(sun);
sun.userData.focusIndex = -2;
clickable.push(sun);

// 太陽柔和光暈 (附加混合精靈, 增強立體輝光)
const glow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(), color: 0xffcc66, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
glow.scale.set(SUN_R * 4.5, SUN_R * 4.5, 1);
ecliptic.add(glow);

function makeGlowTexture() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,230,170,0.35)');
  g.addColorStop(0.25, 'rgba(255,170,80,0.16)');
  g.addColorStop(0.6, 'rgba(255,140,60,0.05)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// =============================================================================
//  程序化行星貼圖 (value-noise fbm, 離線生成)
// =============================================================================
function rand2(seed){ let s = seed >>> 0; return () => (s = (s*1664525+1013904223)>>>0)/4294967296; }
function valueNoise(seed){
  const rnd = rand2(seed);
  const p = Array.from({length:256}, (_, i) => i);
  for (let i = 255; i > 0; i--){ const j = Math.floor(rnd()*(i+1)); [p[i],p[j]]=[p[j],p[i]]; }
  const perm = new Uint8Array(512); for (let i=0;i<512;i++) perm[i]=p[i&255];
  const fade = t => t*t*t*(t*(t*6-15)+10);
  const lerp = (a,b,t) => a+(b-a)*t;
  return (x,y) => {
    const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi;
    const u=fade(xf), v=fade(yf);
    const aa=perm[(perm[xi&255]+yi)&255]/255, ab=perm[(perm[xi&255]+yi+1)&255]/255;
    const ba=perm[(perm[xi+1&255]+yi)&255]/255, bb=perm[(perm[xi+1&255]+yi+1)&255]/255;
    return lerp(lerp(aa,ba,u), lerp(ab,bb,u), v);
  };
}
function fbm(noise,x,y,oct=5){ let v=0,a=0.5,f=1; for(let i=0;i<oct;i++){ v+=a*noise(x*f,y*f); f*=2; a*=0.5; } return v; }
const lerp = (a,b,t) => a + (b - a) * t;

const smooth = (a,b,x) => { const t = Math.min(1, Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };

// 柔和晨昏線: wrap diffuse, uWrap 越大過渡越寬 (岩石 0.08 / 地球 0.12 / 氣態 0.2)
// r160 在 onBeforeCompile 時源碼仍是未展開的 ShaderLib — #include 尚未 resolve,
// 故必須替換 include 標記本身 (與 injectNightLights 對 emissivemap 的做法一致)
//
// ⚠ 只能 wrap diffuse 項, 絕對不能覆寫 dotNL 本身:
//   three 的 RE_Direct_Physical 把 dotNL 同時餵給 diffuse 與 specular —
//   vec3 irradiance = dotNL * directLight.color;
//   reflectedLight.directSpecular += irradiance * BRDF_GGX(...);
// 一旦改動 dotNL, 陰影面 (dotNL≈0) 也會被灌進光線, 該處 BRDF_GGX 的
// V_GGX_SmithCorrelated = 0.5 / max(gv + gl, EPSILON) 分母退化到 EPSILON,
// 加上 point-light cube shadow 在 normalBias 位移下取到錯位的 texel,
// 就在晨昏線/輪廓上燒出單像素 HDR (實測 luminance 20~500, 遠超 bloom 閾值 2),
// 經 UnrealBloomPass 的 mip 鏈放大成行星旁邊陣的方形白光斑 — 即「行星異常閃爍」.
// 正解: 保留 hard dotNL 給 specular, 另設 dotNLwrap 只換掉 directDiffuse 的 irradiance.
const WRAP_NEEDLE = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
const WRAP_DECL   = 'float dotNLwrap = pow( saturate( ( dot( geometryNormal, directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) ), 1.0 + uWrap );';
const DIFFUSE_NEEDLE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const DIFFUSE_PATCH  = 'reflectedLight.directDiffuse += dotNLwrap * directLight.color * BRDF_Lambert( material.diffuseColor );';
const WRAP_MARKER = '#include <lights_physical_pars_fragment>';
function applyWrapLighting(mat, wrap, extraPatch){
  mat.onBeforeCompile = shader => {
    shader.uniforms.uWrap = { value: wrap };
    if (!shader.fragmentShader.includes(WRAP_MARKER)){
      console.warn(t('err.patchInclude'));
    } else {
      let src = shader.fragmentShader.replace(WRAP_MARKER,
        'uniform float uWrap;\n' +
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(WRAP_NEEDLE, WRAP_NEEDLE + '\n\t' + WRAP_DECL));
      if (!src.includes(DIFFUSE_NEEDLE)){
        console.warn(t('err.patchDiffuse'));
      } else {
        src = src.replace(DIFFUSE_NEEDLE, DIFFUSE_PATCH);
      }
      shader.fragmentShader = src;
    }
    if (extraPatch) extraPatch(shader);
  };
  mat.customProgramCacheKey = () => 'wrap' + wrap + (extraPatch ? '-night' : '');
}
// 夜燈晨昏混合: 白天關燈, 夜面淡入 (edge 順序正確, 不用反向 smoothstep — 負向屬未定義行為)
function injectNightLights(shader){
  shader.uniforms.uSunDirView = { value: new THREE.Vector3(0,0,1) };
  shader.fragmentShader = 'uniform vec3 uSunDirView;\n' + shader.fragmentShader;
  const needle = '#include <emissivemap_fragment>';
  if (shader.fragmentShader.includes(needle)){
    shader.fragmentShader = shader.fragmentShader.replace(needle,
      needle + '\n  totalEmissiveRadiance *= 1.0 - smoothstep(-0.18, 0.06, dot(normalize(vNormal), normalize(uSunDirView)));');
  }
  earthNightShader = shader; // 供每幀更新 uSunDirView
}
let earthNightShader = null;
// 域扭曲 fbm (湍流感更自然)
function warpFbm(n, x, y, oct){
  const q = fbm(n, x, y, oct);
  const w = fbm(n, x+5.2, y+1.3, oct);
  return fbm(n, x + q*1.5, y + w*1.5, oct);
}

// 產生 顏色 + 法線 + 粗糙度 三張貼圖, 模擬真實地表/大氣特徵
function genPlanet(p){
  const W=512, H=256;
  const colCv=document.createElement('canvas'); colCv.width=W; colCv.height=H;
  const nrmCv=document.createElement('canvas'); nrmCv.width=W; nrmCv.height=H;
  const rghCv=document.createElement('canvas'); rghCv.width=W; rghCv.height=H;
  const cctx=colCv.getContext('2d'), nctx=nrmCv.getContext('2d'), rctx=rghCv.getContext('2d');
  const cimg=cctx.createImageData(W,H), nimg=nctx.createImageData(W,H), rimg=rctx.createImageData(W,H);
  const n=valueNoise(p.seed||1);
  const HARR=new Float32Array(W*H);
  const bump = (p.type==='gas'||p.type==='ice') ? 0.5 : (p.name==='金星' ? 0.3 : 2.2);
  const c1=p.color, c2=p.color2||p.color;

  for(let y=0;y<H;y++){
    const v=y/H, lat=Math.abs(v-0.5)*2; // 0=赤道 1=極
    for(let x=0;x<W;x++){
      const u=x/W;
      let r,g,b,h,rough=0.9;
      if(p.type==='earth'){
        const e=warpFbm(n, u*5, v*5, 6);
        if(e>0.55){
          const t=(e-0.55)/0.45; // 海拔
          if(t<0.15){ r=lerp(205,95,t/0.15); g=lerp(195,135,t/0.15); b=lerp(150,85,t/0.15); }
          else if(t<0.55){ r=lerp(70,55,(t-0.15)/0.4); g=lerp(130,100,(t-0.15)/0.4); b=lerp(60,50,(t-0.15)/0.4); }
          else { r=lerp(95,150,(t-0.55)/0.45); g=lerp(82,140,(t-0.55)/0.45); b=lerp(62,120,(t-0.55)/0.45); }
          h=t; rough=0.95;
          if(t>0.8){ const s=(t-0.8)/0.2; r=lerp(r,242,s); g=lerp(g,242,s); b=lerp(b,246,s); h=1; }
        } else {
          const d=e/0.55; r=lerp(6,30,d); g=lerp(32,82,d); b=lerp(72,142,d); h=0; rough=0.18; // 海洋反光
        }
        if(lat>0.82){ const s=Math.min(1,(lat-0.82)/0.18); r=lerp(r,238,s); g=lerp(g,242,s); b=lerp(b,248,s); h=Math.max(h,0.2); rough=0.6; }
      } else if(p.type==='gas' || p.type==='ice'){
        const warped=warpFbm(n, u*3, v*3, 5);
        const band=0.5+0.5*Math.sin((v*p.bands + (warped-0.5)*1.2)*Math.PI*2.0);
        r=lerp(c1[0],c2[0],band); g=lerp(c1[1],c2[1],band); b=lerp(c1[2],c2[2],band);
        const sh=0.85+0.3*warped; r*=sh; g*=sh; b*=sh; h=band*0.5; rough=0.85;
        if(p.type==='gas' && p.name==='木星'){
          const dl=Math.hypot(u-0.62, v-0.62);
          const spot=Math.exp(-(dl*dl)/(2*0.010));
          r=lerp(r,205,spot); g=lerp(g,82,spot); b=lerp(b,52,spot); h=Math.max(h,0.6);
        }
        if(p.type==='ice' && p.name==='海王星'){
          const dl=Math.hypot(u-0.4, v-0.4);
          const spot=Math.exp(-(dl*dl)/(2*0.006));
          r=lerp(r,30,spot); g=lerp(g,42,spot); b=lerp(b,120,spot);
        }
      } else if(p.name==='金星'){
        const c=warpFbm(n, u*4, v*4, 6); const sh=0.8+0.4*c;
        r=235*sh; g=200*sh; b=120*sh; h=0.05; rough=0.6;
      } else { // 岩石: 水星 / 火星
        const e=warpFbm(n, u*6, v*6, 6); const base=p.color; const sh=0.5+0.9*e;
        r=base[0]*sh; g=base[1]*sh; b=base[2]*sh; h=e; rough=0.95;
        if(p.name==='火星'){
          if(e<0.4){ r*=0.8; g*=0.8; b*=0.85; }
          if(lat>0.86){ const s=Math.min(1,(lat-0.86)/0.14); r=lerp(r,235,s); g=lerp(g,238,s); b=lerp(b,240,s); h=Math.max(h,0.1); rough=0.5; }
        }
      }
      const idx=(y*W+x)*4;
      cimg.data[idx]=Math.min(255,r); cimg.data[idx+1]=Math.min(255,g); cimg.data[idx+2]=Math.min(255,b); cimg.data[idx+3]=255;
      HARR[y*W+x]=h;
      const rv=Math.max(0,Math.min(255,rough*255));
      rimg.data[idx]=rv; rimg.data[idx+1]=rv; rimg.data[idx+2]=rv; rimg.data[idx+3]=255;
    }
  }
  // 由高度場梯度產生法線貼圖 (真實立體起伏)
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const xl=HARR[y*W+((x-1+W)%W)], xr=HARR[y*W+((x+1)%W)];
    const yd=HARR[((y-1+H)%H)*W+x], yu=HARR[((y+1)%H)*W+x];
    let nx=(xl-xr)*bump, ny=(yd-yu)*bump, nz=1.0;
    const len=Math.hypot(nx,ny,nz); nx/=len; ny/=len; nz/=len;
    const idx=(y*W+x)*4;
    nimg.data[idx]=Math.round((nx*0.5+0.5)*255); nimg.data[idx+1]=Math.round((ny*0.5+0.5)*255); nimg.data[idx+2]=Math.round((nz*0.5+0.5)*255); nimg.data[idx+3]=255;
  }
  // 無縫接縫: 末列複製首列
  for(let y=0;y<H;y++){ const i0=y*W*4, i1=(y*W+(W-1))*4;
    for(const arr of [cimg.data,nimg.data,rimg.data]){ arr[i1]=arr[i0]; arr[i1+1]=arr[i0+1]; arr[i1+2]=arr[i0+2]; } }

  cctx.putImageData(cimg,0,0); nctx.putImageData(nimg,0,0); rctx.putImageData(rimg,0,0);
  // 顏色圖 SRGB; 法線/粗糙度為資料紋理必須 NoColorSpace (否則 GPU 線性化解碼會扭曲著色)
  const mkCol=cv=>{ const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return t; };
  const mkDat=cv=>{ const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.NoColorSpace; t.anisotropy=8; return t; };
  return { color:mkCol(colCv), normal:mkDat(nrmCv), rough:mkDat(rghCv) };
}

// 地球雲層 (半透明, 獨立自轉)
function genClouds(p){
  const W=512,H=256, cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d'), img=ctx.createImageData(W,H); const n=valueNoise(p.seed+777);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const u=x/W, v=y/H; const c=warpFbm(n, u*4, v*4, 6);
    const a=smooth(0.5,0.72,c)*0.85*smooth(0.0,0.12,Math.abs(v-0.5)*2); // 赤道雲多, 極區少
    const idx=(y*W+x)*4; img.data[idx]=255; img.data[idx+1]=255; img.data[idx+2]=255; img.data[idx+3]=Math.round(a*255);
  }
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return t;
}

// 由 daymap 亮度 Sobel 產生法線貼圖 (降採樣 1024x512, 強度內建)
function normalFromHeight(img, strength){
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
  const src = ctx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W*H; i++){ const j = i*4; lum[i] = (src[j]*0.299 + src[j+1]*0.587 + src[j+2]*0.114) / 255; }
  const out = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const xl = lum[y*W + ((x-1+W)%W)], xr = lum[y*W + ((x+1)%W)];
    const yd = lum[((y-1+H)%H)*W + x], yu = lum[((y+1)%H)*W + x];
    let nx = (xl - xr) * strength, ny = (yd - yu) * strength, nz = 1.0;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y*W + x) * 4;
    out.data[i] = Math.round((nx*0.5+0.5)*255); out.data[i+1] = Math.round((ny*0.5+0.5)*255); out.data[i+2] = Math.round((nz*0.5+0.5)*255); out.data[i+3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.anisotropy = MAX_ANISO; return t;
}

// 大氣層 (菲涅爾邊緣輝光, BackSide 加法混合; 向陽側亮, 背陽側暗)
const atmoMats = []; // { mat, obj } — 每幀更新 uSunDirView
function addAtmosphere(radius, color, power, ownerObj){
  const mat = new THREE.ShaderMaterial({
    transparent:true, side:THREE.BackSide, depthWrite:false, blending:THREE.AdditiveBlending,
    uniforms:{ glow:{ value:new THREE.Color(color) }, uPow:{ value: power }, uSunDirView:{ value:new THREE.Vector3(0,0,1) } },
    vertexShader:`varying vec3 vN; varying vec3 vV;
      void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader:`varying vec3 vN; varying vec3 vV; uniform vec3 glow; uniform float uPow; uniform vec3 uSunDirView;
      void main(){
        float f=pow(clamp(1.0-abs(dot(vN,vV)),0.0,1.0),uPow); // BackSide 無自動法線翻轉, 用 abs 取掠射角; clamp 防插值誤差致負底數
        float day=0.15+0.85*max(dot(normalize(vN), normalize(uSunDirView)),0.0);
        gl_FragColor=vec4(glow*f*day, f*0.9*day);
      }`,
  });
  atmoMats.push({ mat, obj: ownerObj });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
}

// 夜光貼圖: specular(海洋白)反相得陸地遮罩, 乘 fbm 群聚斑點, 極區衰減
function genNightLights(specImg){
  const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.drawImage(specImg, 0, 0, W, H);
  const spec = ctx.getImageData(0, 0, W, H).data;
  const img = ctx.createImageData(W, H);
  const n = valueNoise(999);
  for (let y = 0; y < H; y++){
    const lat = Math.abs(y/H - 0.5) * 2;                    // 0=赤道 1=極
    const polar = smooth(0.75, 0.9, lat);                   // 極區熄燈
    for (let x = 0; x < W; x++){
      const i = (y*W + x) * 4;
      const land = 1 - spec[i] / 255;                       // 海洋白 -> 陸地遮罩
      const c = warpFbm(n, x/W * 8, y/H * 8, 5);
      const city = smooth(0.58, 0.75, c) * (0.4 + 0.6 * smooth(0.45, 0.7, fbm(n, x/W * 20, y/H * 20, 4)));
      const v = Math.round(255 * land * city * (1 - polar));
      img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t;
}

// =============================================================================
//  真實 NASA / Solar System Scope 貼圖 (本地同源載入, 失敗則降級程序化)
// =============================================================================
const TEX_BASE = './textures/';
// 貼圖解析度開關: '8k' | '4k' | '2k'  (一鍵切換, 執行期即時重載; 預設 4k 省頻寬/顯存)
let QUALITY = document.getElementById('quality').value; // 與下拉選單一致 (預設 4k)
// 重新載入世代代碼: 舊世代的 in-flight 載入完成時作廢並釋放 (防 8k/2k 交叉覆寫)
let texGen = 0;
// 天王星/海王星 SSS 僅提供 2k; 地球法線/高光僅 2k; 木星/土星無真實 8k (檔與 4k 相同) -> 別名 4k
function prefix(){ return QUALITY === '8k' ? '8k_' : QUALITY === '4k' ? '4k_' : ''; }
function planetDay(p){
  if (p.name === '天王星') return TEX_BASE + 'uranus.jpg'; // 僅 2k
  if (p.name === '海王星') return TEX_BASE + 'neptune.jpg'; // 僅 2k
  const base = { '水星':'mercury', '金星':'venus_surface', '火星':'mars', '木星':'jupiter', '土星':'saturn' }[p.name];
  const fake8k = (base === 'jupiter' || base === 'saturn') && QUALITY === '8k';
  return TEX_BASE + (fake8k ? '4k_' : prefix()) + base + '.jpg';
}
function earthTex(){
  const pre = prefix();
  return { day: TEX_BASE + pre + 'earth_daymap.jpg', normal: TEX_BASE + 'earth_normal.jpg',
           spec: TEX_BASE + 'earth_specular.jpg', clouds: TEX_BASE + pre + 'earth_clouds.jpg' };
}
function ringTex(){ return TEX_BASE + prefix() + 'saturn_ring_alpha.png'; }
function moonTex(){ return TEX_BASE + prefix() + 'moon.jpg'; }

// 離主執行緒解碼 (ImageBitmapLoader: createImageBitmap 在瀏覽器執行緒池解 JPEG); 不支援時回退 TextureLoader
const texLoader = new THREE.TextureLoader();
texLoader.crossOrigin = 'anonymous';
const bmpLoader = new THREE.ImageBitmapLoader();
bmpLoader.crossOrigin = 'anonymous';
// bitmap 解碼在瀏覽器執行緒池; 方向與 GPU UNPACK_FLIP_Y 路徑保持和 TextureLoader 一致 (不預翻轉)
bmpLoader.setOptions({ premultiplyAlpha: 'none' });
let loadTotal = 0, loadDone = 0;
// 載入進度文字: 進度只在載入階段顯示, 且由本函數獨寫 (el 上的 data-i18n 已卸下),
// 所以換語言時進度不會被靜態字典蓋掉。
function renderLoaderTex(){
  const el = document.getElementById('loader');
  if (!el || el.classList.contains('done')) return;
  if (!el.dataset.tex) return;                 // 尚未進入貼圖階段 → 維持「初始化星系…」
  if (el.dataset.msg) return;                  // 錯誤訊息優先, 不搶它的文字
  el.textContent = t('loader.tex', { done: loadDone, total: loadTotal });
}
function loadTex(url, srgb){
  loadTotal++;
  // 注意: 參數不叫 t —— 那會遮蔽外層的翻譯函數 t()
  const finish = tex => {
    loadDone++;
    const el = document.getElementById('loader');
    if (el){
      // 進入「貼圖進度」階段: 卸下 data-i18n, 改由 renderLoaderTex() 全權接管,
      // 否則換語言時 applyStatic() 會把進度條打回「初始化星系…」
      el.removeAttribute('data-i18n');
      el.dataset.tex = '1';
      renderLoaderTex();
    }
    return tex;
  };
  return new Promise(res => {
    const fail = () => { console.warn(t('err.texFail'), url); res(finish(null)); };
    const tag = tex => { tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.anisotropy = MAX_ANISO; res(finish(tex)); };
    if (typeof createImageBitmap === 'function'){
      bmpLoader.load(url, bmp => { const tex = new THREE.Texture(bmp); tex.needsUpdate = true; tag(tex); },
                     undefined, fail);
    } else {
      texLoader.load(url, tag, undefined, fail);
    }
  });
}
// 將地球 specular 貼圖反相為 roughness (海洋白=反光 -> roughness 低)
function invertToRoughness(tex){
  const img = tex.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  for (let i = 0; i < d.data.length; i += 4){ const v = 255 - d.data[i]; d.data[i] = d.data[i+1] = d.data[i+2] = v; }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.anisotropy = MAX_ANISO; return t;
}
// 程序化降級 (真實貼圖載入失敗時): 顏色+法線+粗糙度, 每個行星只生成一次並重用
function applyProcedural(p, mat){
  if (mat.map) return;
  const g = p._proc || (p._proc = genPlanet(p));
  mat.map = g.color; mat.normalMap = g.normal; mat.roughnessMap = g.rough;
  mat.color.set(0xffffff); mat.needsUpdate = true;
}
// 以真實貼圖覆蓋初始純色材質; 先載入後替換 (不空白), 舊世代結果作廢並釋放
async function upgradePlanet(p, mat, gen){
  const T = p._tex || (p._tex = {});
  const stale = () => gen !== texGen;
  const drop = t => t && t.dispose();
  if (p.name === '地球'){
    const u = earthTex();
    if (T.day !== u.day){
      const day = await loadTex(u.day, true);
      if (stale()){ drop(day); return; }
      if (day){
        if (mat.map) mat.map.dispose();
        mat.map = day; mat.color.set(0xffffff); mat.needsUpdate = true; T.day = u.day;
      } else applyProcedural(p, mat);
      // 失敗也繼續其他槽位 (normal/spec/雲 URL 獨立, 可能載入成功)
    }
    if (T.normal !== u.normal){
      const nm = await loadTex(u.normal, false);
      if (stale()){ drop(nm); return; }
      if (nm){ if (mat.normalMap) mat.normalMap.dispose(); mat.normalMap = nm; mat.needsUpdate = true; T.normal = u.normal; }
    }
    if (T.spec !== u.spec){
      const sp = await loadTex(u.spec, false);
      if (stale()){ drop(sp); return; }
      if (sp){
        if (mat.roughnessMap) mat.roughnessMap.dispose();
        mat.roughnessMap = invertToRoughness(sp);
        const lights = genNightLights(sp.image);   // 陸地遮罩 x fbm 斑點 x 緯度衰減
        if (lights){
          if (mat.emissiveMap) mat.emissiveMap.dispose();
          mat.emissiveMap = lights; mat.emissive.set(0xffb46a); mat.emissiveIntensity = 2.0;
        }
        sp.dispose();                              // 源圖只被 canvas 管线消費, 不進 GPU -> 立即釋放
        mat.needsUpdate = true; T.spec = u.spec;
      }
    }
    // 雲: JPG 無 alpha -> 以亮度當 alphaMap (資料紋理, 線性色彩空間)
    if (T.clouds !== u.clouds){
      const cl = await loadTex(u.clouds, false);
      if (stale()){ drop(cl); return; }
      if (cl && p._clouds){
        const cm = p._clouds.material;
        if (cm.map) cm.map.dispose();               // 釋放程序化雲 texture
        if (cm.alphaMap) cm.alphaMap.dispose();
        cm.map = null; cm.alphaMap = cl;
        cm.color.set(0xffffff); cm.transparent = true; cm.needsUpdate = true;
        T.clouds = u.clouds;
      }
    }
  } else {
    const url = planetDay(p);
    if (T.day !== url){
      const day = await loadTex(url, true);
      if (stale()){ drop(day); return; }
      if (!day){ applyProcedural(p, mat); return; }
      if (mat.map) mat.map.dispose();
      if (mat.roughnessMap) mat.roughnessMap.dispose();
      if (mat.normalMap) mat.normalMap.dispose();
      mat.map = day; mat.roughnessMap = null; mat.color.set(0xffffff);
      mat.normalMap = (p.name === '水星' || p.name === '火星') ? normalFromHeight(day.image, 3.0) : null;
      if (mat.normalMap) mat.normalScale.set(0.8, 0.8);
      mat.needsUpdate = true; T.day = url;
    }
  }
}
async function upgradeRing(ring, gen){
  const url = ringTex();
  if (ring.userData.texUrl === url) return;
  const t = await loadTex(url, true);
  if (gen !== texGen){ t && t.dispose(); return; }
  if (!t) return; // 失敗保留程序化著色器環
  const old = ring.material;
  ring.material = new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, roughness: 1, metalness: 0, envMapIntensity: 0.2, alphaTest: 0.12 });
  // alphaTest>0 讓 r160 自動複製 map+alphaTest 成 distance-material 變體 -> 環縫有真實透明陰影
  if (old){ if (old.map) old.map.dispose(); old.dispose(); }
  ring.castShadow = true;
  ring.receiveShadow = true;
  ring.userData.texUrl = url;
}
async function upgradeMoon(moon, gen){
  const url = moonTex();
  const T = moon.userData;
  if (T.texUrl === url) return;
  const t = await loadTex(url, true);
  if (gen !== texGen){ t && t.dispose(); return; }
  if (!t) return;
  const mat = moon.material;
  if (mat.map) mat.map.dispose();
  mat.map = t; mat.color.set(0xffffff);
  if (mat.normalMap) mat.normalMap.dispose();
  mat.normalMap = normalFromHeight(t.image, 3.0);
  mat.normalScale.set(0.8, 0.8); mat.needsUpdate = true;
  T.texUrl = url;
}
// 切換解析度: 先載入後抵達再釋放舊紋理; URL 未變的槽位跳過重載
function reloadTextures(){
  const gen = ++texGen;
  const jobs = [];
  for (const o of planetObjs){
    jobs.push(upgradePlanet(o.data, o.mesh.material, gen));
    if (o.ring) jobs.push(upgradeRing(o.ring, gen));
    if (o.moon) jobs.push(upgradeMoon(o.moon, gen));
  }
  return Promise.all(jobs);
}

// =============================================================================
//  建立行星 (含軌道線, 標籤, 土星環, 地球衛星)
// =============================================================================
const focusSelect = document.getElementById('focus');
const planetObjs = [];   // { data, obj(tilted group), mesh(spins), orbitBase(matrix), labelEl, ring, moon }
// 追蹤 select 裡的動態 option (行星), 才能在換語言時原位改文字而不動 value/選中項
const focusOptions = [];

PLANETS.forEach((p, idx) => {
  // 軌道基礎旋轉矩陣: Rz(node)*Rx(incl)*Rz(peri)
  const m = new THREE.Matrix4();
  const rz1 = new THREE.Matrix4().makeRotationZ(p.peri * DEG);
  const rx  = new THREE.Matrix4().makeRotationX(p.incl * DEG);
  const rz2 = new THREE.Matrix4().makeRotationZ(p.node * DEG);
  m.multiplyMatrices(rz2, rx); m.multiply(rz1);

  // 自轉軸傾斜群組
  const obj = new THREE.Group();
  obj.rotation.z = p.tilt * DEG;
  ecliptic.add(obj);

  // 初始用純色材質, 隨後以真實貼圖非同步覆蓋 (載入失敗則降級程序化)
  const matParams = { color: new THREE.Color(p.color[0]/255, p.color[1]/255, p.color[2]/255), roughness: 1.0, metalness: 0.0 };
  const mat = p.name === '地球'
    ? new THREE.MeshPhysicalMaterial({ ...matParams, clearcoat: 0.25, clearcoatRoughness: 0.25 })
    : new THREE.MeshStandardMaterial(matParams);
  const wrapV = (p.type === 'gas' || p.type === 'ice') ? 0.2 : p.name === '地球' ? 0.12 : 0.08;
  applyWrapLighting(mat, wrapV, p.name === '地球' ? injectNightLights : null);
  mat.envMapIntensity = (p.type === 'gas' || p.type === 'ice') ? 0.25 : p.name === '地球' ? 0.35 : 0.15;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.rDisp, 64, 64), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.focusIndex = idx;
  obj.add(mesh);
  clickable.push(mesh);
  // 隱形點擊代理球: 半徑至少 9.5 (預設視距 ~950 下約 10px), 讓小行星容易點中
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(Math.max(p.rDisp * 2.5, 9.5), 16, 12), clickProxyMat);
  proxy.visible = false;
  proxy.userData.focusIndex = idx;
  obj.add(proxy);
  clickable.push(proxy);
  p._upg = upgradePlanet(p, mat, texGen); // 非同步載入真實 NASA 貼圖 (降級則程序化)

  // 地球: 雲層 + 藍色大氣; 金星: 黃色大氣
  if (p.name === '地球') {
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(p.rDisp * 1.012, 64, 64),
      new THREE.MeshStandardMaterial({ map: genClouds(p), transparent: true, depthWrite: false, roughness: 1, metalness: 0, opacity: 0.9, envMapIntensity: 0.3, alphaTest: 0.35 })
    );
    obj.add(clouds); p._clouds = clouds;
    clouds.castShadow = true; // alphaTest>0 -> r160 自動以 map/alphaMap 生成 distance 變體, 雲影不再是實心球
    obj.add(addAtmosphere(p.rDisp * 1.03, 0x3a7bd5, 2.5, obj));
  } else if (p.name === '金星') {
    obj.add(addAtmosphere(p.rDisp * 1.05, 0xd9b06a, 2.5, obj));
  } else if (p.name === '火星') {
    obj.add(addAtmosphere(p.rDisp * 1.02, 0xd88a5a, 3.5, obj));
  } else if (p.name === '木星') {
    obj.add(addAtmosphere(p.rDisp * 1.03, 0xd8bd93, 2.8, obj));
  } else if (p.name === '土星') {
    obj.add(addAtmosphere(p.rDisp * 1.03, 0xe6d8ab, 2.8, obj));
  } else if (p.name === '天王星') {
    obj.add(addAtmosphere(p.rDisp * 1.04, 0xa8ecf2, 2.8, obj));
  } else if (p.name === '海王星') {
    obj.add(addAtmosphere(p.rDisp * 1.04, 0x4f74ff, 2.8, obj));
  }

  // 土星環
  let ring = null;
  if (p.ring) {
    const inner = p.rDisp * 1.3, outer = p.rDisp * 2.4;
    const ringGeo = new THREE.RingGeometry(inner, outer, 96, 1);
    // r160 RingGeometry 的 UV 是平面投影 (x/y 直徑), 環貼圖是沿 x 的徑向剖面 ->
    // 改寫為徑向 UV: u=(r-inner)/(outer-inner), 貼圖才呈現同心環帶與圓形卡西尼縫
    {
      const posA = ringGeo.attributes.position, uvA = ringGeo.attributes.uv;
      for (let i = 0; i < posA.count; i++){
        const r = Math.hypot(posA.getX(i), posA.getY(i));
        uvA.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      uvA.needsUpdate = true;
    }
    ring = new THREE.Mesh(
      ringGeo,
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        vertexShader: `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `
          varying vec2 vP;
          void main(){
            float r=length(vP); float t=(r-${inner.toFixed(2)})/(${(outer-inner).toFixed(2)});
            float bands=0.5+0.5*sin(t*60.0);
            float a=smoothstep(0.0,0.06,t)*(1.0-smoothstep(0.82,1.0,t))*(0.35+0.65*bands);
            // 卡西尼縫
            a*= smoothstep(0.02,0.04,abs(t-0.55));
            vec3 col=mix(vec3(0.85,0.78,0.6), vec3(0.6,0.52,0.4), bands);
            gl_FragColor=vec4(col, a);
          }`,
      })
    );
    ring.rotation.x = -Math.PI / 2; // 置於赤道面
    obj.add(ring);
    p._ringUpg = upgradeRing(ring, texGen); // 以真實土星環貼圖覆蓋 (失敗保留程序化環)
  }

  // 地球衛星
  let moon = null;
  if (p.moon) {
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 1.0 });
    applyWrapLighting(moonMat, 0.08, null);
    moonMat.envMapIntensity = 0.15;
    moon = new THREE.Mesh(
      new THREE.SphereGeometry(p.rDisp * 0.27, 64, 64),
      moonMat
    );
    moon.castShadow = true; moon.receiveShadow = true;
    p._moonUpg = upgradeMoon(moon, texGen); // 以真實月球貼圖覆蓋
    const moonPivot = new THREE.Group();
    moon.position.x = p.rDisp * 2.2;
    moonPivot.add(moon);
    obj.add(moonPivot);
    p._moonPivot = moonPivot;
  }

  // 軌道線
  const SEG = 256, op = new Float32Array((SEG+1)*3);
  for (let i=0;i<=SEG;i++){
    const E = (i/SEG)*TWO_PI;
    const xv = p.aDisp*(Math.cos(E)-p.e);
    const yv = p.aDisp*Math.sqrt(1-p.e*p.e)*Math.sin(E);
    const v = new THREE.Vector3(xv, yv, 0).applyMatrix4(m);
    op[i*3]=v.x; op[i*3+1]=v.y; op[i*3+2]=v.z;
  }
  const og = new THREE.BufferGeometry();
  og.setAttribute('position', new THREE.BufferAttribute(op, 3));
  const orbitLine = new THREE.LineLoop(og, new THREE.LineBasicMaterial({ color:0x4a6a8a, transparent:true, opacity:0.45 }));
  ecliptic.add(orbitLine);

  // 標籤 (div 存進 planetObjs, 換語言時由 renderDynamicUI() 重繪)
  const div = document.createElement('div'); div.className='label'; div.textContent=pname(p.name);
  const label = new CSS2DObject(div); label.position.set(0, p.rDisp*1.6, 0); obj.add(label);

  planetObjs.push({ data:p, obj, mesh, orbitBase:m, orbitLine, labelEl:div,
                    ring: p.ring ? ring : null, moon: p.moon ? moon : null });
  const opt = new Option(pname(p.name), String(idx));
  focusSelect.add(opt);
  focusOptions.push({ opt, name: p.name });
});

// =============================================================================
//  解克卜勒方程  M = E - e*sin(E)
// =============================================================================
function solveKepler(M, e){
  M = M % TWO_PI; if (M < 0) M += TWO_PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let i=0;i<8;i++) E -= (E - e*Math.sin(E) - M) / (1 - e*Math.cos(E));
  return E;
}

// =============================================================================
//  黑洞 (事件視界 + 吸積盤 + 引力透鏡後處理)
// =============================================================================
const BH = { R: 820, incl: 20*DEG, horizonR: 26, diskInner: 34, diskOuter: 150, angle: 0, periodYr: 600, group: null, diskMat: null, pos: new THREE.Vector3() };

function buildBlackHole(){
  const g = new THREE.Group();

  // 事件視界 (純黑球)
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(BH.horizonR, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true })
  );
  horizon.userData.focusIndex = -3;
  clickable.push(horizon);
  g.add(horizon);

  // 吸積盤 (GLSL: 溫度梯度 + 湍流旋臂 + 都卜勒束流)
  const dmat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:{value:0}, uOpacity:{value:1}, inner:{value:BH.diskInner}, outer:{value:BH.diskOuter},
      uBhViewPos:{ value:new THREE.Vector3() },   // 黑洞中心 (view space), 每幀更新
      uEinstein:{ value: BH.horizonR * 1.6 },     // 愛因斯坦半徑 = 41.6, 控制 halo 大小
      uCamAz:{ value: 0 },                        // 相機在盤面局部座標的方位角, 每幀更新
    },
    vertexShader: `
      varying vec2 vP;
      varying float vWarp;
      uniform vec3 uBhViewPos;
      uniform float uEinstein;
      void main(){
        vP = position.xy;                             // 未變形盤面座標 → fragment 著色不變
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 rel = mv.xyz - uBhViewPos;
        float behind = uBhViewPos.z - mv.z;           // >0: 頂點在黑洞後方 (相機看 -z)
        float w = smoothstep(0.0, 25.0, behind);      // 只彎後側, 跨盤面平滑過渡
        float b = length(rel.xy);                     // 撞擊參數
        vec2 dir = rel.xy / max(b, 1e-3);
        float bApp = sqrt(b*b + uEinstein*uEinstein); // 弱場透鏡反演: 背後點推出到愛因斯坦環外
        mv.xy = mix(mv.xy, uBhViewPos.xy + dir * bApp, w);
        vWarp = w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vP;
      varying float vWarp;
      uniform float uTime; uniform float uOpacity; uniform float inner; uniform float outer; uniform float uCamAz;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
      float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.0; a*=0.5;} return v; }
      // 3D noise: 角座標落在圓上 (cos,sin) -> 對 ang 天然 2π 週期, 無 atan2 跳變接縫
      float hash3(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
      float noise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float n000=hash3(i), n100=hash3(i+vec3(1,0,0)), n010=hash3(i+vec3(0,1,0)), n110=hash3(i+vec3(1,1,0));
        float n001=hash3(i+vec3(0,0,1)), n101=hash3(i+vec3(1,0,1)), n011=hash3(i+vec3(0,1,1)), n111=hash3(i+vec3(1,1,1));
        return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                   mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z); }
      float fbm3(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise3(p); p*=2.0; a*=0.5;} return v; }
      void main(){
        float r=length(vP);
        float t=(r-inner)/(outer-inner);
        if(t<0.0||t>1.0) discard;
        float ang=atan(vP.y, vP.x);
        // 旋臂湍流: (cos,sin) 圓形域取樣, 時間項=圓面旋轉 (無接縫)
        float phi=ang + uTime*0.6;
        float sw=fbm3(vec3(cos(phi)*3.0, sin(phi)*3.0, r*0.06 - uTime*0.35));
        // 溫度梯度: 內側高溫(藍白) -> 外側低溫(橙紅) (不變)
        vec3 hot=vec3(0.75,0.88,1.0), mid=vec3(1.0,0.6,0.22), cool=vec3(0.55,0.12,0.05);
        vec3 col=mix(hot, mid, smoothstep(0.0,0.35,t));
        col=mix(col, cool, smoothstep(0.35,1.0,t));
        // R3 都卜勒束流: 接近側藍移增亮, 遠離側紅移變暗
        // 推導: 盤面速度 v ∝ (−sinθ, 0, −cosθ)·r (θ=ang+φ, φ=群組自旋), 相機方位 A=uCamAz
        // => v·camDir ∝ −sin(A+ang), 故 dopp>0 必須是「接近」-> 取負號
        float dopp = -sin(uCamAz + ang);
        float dm = smoothstep(-1.0, 1.0, dopp);
        col *= mix(vec3(1.20,0.70,0.45), vec3(0.70,0.85,1.30), dm); // 紅移 <- -> 藍移
        float doppler = 0.55 + 0.95*dm;               // 亮度不對稱
        float bright=0.5+0.9*sw;
        col *= (0.8 + 2.2*bright) * doppler;
        // R6 引力紅移: 內緣指數歸零, 先經深紅再入黑
        float gr = 1.0 - exp(-9.0*t);
        col = mix(vec3(0.30,0.02,0.0), col, smoothstep(0.0,0.20,t));
        col *= gr*gr;
        // 透鏡弧增亮 (bloom 過曝則降為 0.25)
        col *= 1.0 + 0.4*vWarp;
        float alpha=smoothstep(0.0,0.05,t)*(1.0-smoothstep(0.7,1.0,t))*(0.5+0.6*sw);
        alpha *= gr;                                  // 內緣 alpha 同步熄滅, 不留亮邊
        gl_FragColor=vec4(col*2.0, alpha*uOpacity);   // uOpacity 路徑不變
      }`,
  });
  const disk = new THREE.Mesh(new THREE.RingGeometry(BH.diskInner, BH.diskOuter, 256, 48), dmat);
  disk.rotation.x = -Math.PI / 2;
  g.add(disk);
  BH.diskMat = dmat;

  // 標籤
  const div = document.createElement('div'); div.className='label bh'; div.textContent=t('label.bh');
  const label = new CSS2DObject(div); label.position.set(0, BH.horizonR*2.2, 0); g.add(label);
  BH.label = label; // CSS2DRenderer 只看自身 visible (不看祖先) -> 開關黑洞時必須手動隱藏

  // 置於黃道面外的傾斜軌道
  scene.add(g);
  BH.group = g;
}
buildBlackHole();

// 引力透鏡 後處理著色器 (螢幕空間近似)
const LensingShader = {
  uniforms: {
    tDiffuse: { value: null },
    bhUV:     { value: new THREE.Vector2(0.5, 0.5) },
    bhRadius: { value: 0.03 },
    strength: { value: 3.5 },
    aspect:   { value: innerWidth / innerHeight },
    ringColor:{ value: new THREE.Color(0xffb066) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 bhUV; uniform float bhRadius;
    uniform float strength; uniform float aspect; uniform vec3 ringColor;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if(strength <= 0.0001){ gl_FragColor = texture2D(tDiffuse, uv); return; }
      vec2 d = uv - bhUV; d.x *= aspect;
      float dist = length(d);
      // 事件視界由 3D 純黑視界球遮擋 (深度正確, 不會咬掉前方的近側吸積盤)
      if(dist < bhRadius){ gl_FragColor = texture2D(tDiffuse, uv); return; }
      // 光線向質量彎曲 -> 取樣點往中心位移
      float bend = strength * bhRadius * bhRadius / dist;
      bend = min(bend, dist - bhRadius);
      vec2 dir = d / dist;
      // 位移在長寬比校正空間量測, 回到 uv 只有 x 分量需要除以 aspect
      vec2 sUv = uv - vec2(dir.x * bend / aspect, dir.y * bend);
      // 彎曲後取樣落在畫面外 -> 顯示未彎曲原圖 (避免邊緣像素被 clamped 拉成拖影)
      if(sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0){ gl_FragColor = texture2D(tDiffuse, uv); return; }
      vec3 col = texture2D(tDiffuse, sUv).rgb;
      // R4 光子環: 細銳高斯環 (1.06x 視界半徑) + 微弱寬暈
      float ringC = bhRadius * 1.06;
      float ringW = bhRadius * 0.05;
      float ringQ = (dist - ringC) / ringW;
      float ring = exp(-ringQ * ringQ); // 不用 pow(負數, 2.0): GLSL ES 對負底數未定義
      float haloG = exp(-(dist - bhRadius) * 6.0) * 0.12;
      col += ringColor * (ring * 1.5 + haloG) * strength * 0.28;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// =============================================================================
//  後處理管線: Render -> 引力透鏡 -> Bloom(HDR) -> Output
// =============================================================================
// MSAA 必須開在 composer 自己的 render target 上 (場景渲染到 rt1, 非預設框架緩衝)
const composerRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight,
  { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerRT);
composer.setSize(innerWidth, innerHeight); // 同步 _width/_pixelRatio 與所有 pass
composer.addPass(new RenderPass(scene, camera));
const lensingPass = new ShaderPass(LensingShader);
composer.addPass(lensingPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.6, 2.0);
bloom.highPassUniforms['smoothWidth'].value = 0.3; // 預設 0.01 閾帶太尖 -> 高光逐幁閃縮; 放寬後輝光平滑
composer.addPass(bloom);
composer.addPass(new OutputPass());

// =============================================================================
//  UI 控制
// =============================================================================
let simSpeed = 0.2;          // 年 / 秒
let paused = false;
let showOrbits = true, showLabels = true, lensOn = true, bhOn = true;
let followIdx = -1;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = id => document.getElementById(id);
$('speed').addEventListener('input', e => {
  simSpeed = parseFloat(e.target.value);
  $('speedVal').textContent = t('unit.yrPerSec', { v: simSpeed.toFixed(2) });
});
$('quality').addEventListener('change', e => {
  QUALITY = e.target.value; $('qualVal').textContent = QUALITY; // 8k/4k/2k 與語言無關
  reloadTextures(); // 即時釋放舊紋理並重載新解析度
});
$('pause').addEventListener('click', e => {
  paused = !paused;
  e.target.removeAttribute('data-i18n'); // 之後由本處全權接管 (靜態字典不能再覆寫播放/暫停)
  e.target.textContent = paused ? t('btn.play') : t('btn.pause');
  e.target.classList.toggle('on', paused);
});
$('reset').addEventListener('click', () => {
  followIdx = -1; flyTo.active = false; $('focus').value = '-1';
  hasTrack = false;
  controls.minDistance = 30;
  camera.position.copy(CAM_HOME); controls.target.set(0,0,0);
});
$('focus').addEventListener('change', e => { focusOn(parseInt(e.target.value)); });

// =============================================================================
//  面板自動收回: 不互動時滑出螢幕, 讓畫面可看範圍最大化。
//  兩種方式收回: (1) 手動按 ✕  (2) 閒置 6 秒且指標不在面板上。
//  📌 釘選可關閉自動收回 (只保留手動 ✕), 選擇記在 localStorage。
//    未釘選時, 使用者操作面板會重置閒置計時; 操作畫面 (拖曳/滾輪/點擊行星) 也會重置,
//    避免「正要看畫面結果面板突然消失」的反直覺體驗。
// =============================================================================
const UI_IDLE_MS = 6000;
const $ui = $('ui'), $uiShow = $('uiShow'), $uiPin = $('uiPin'), $uiHide = $('uiHide');
let uiPinned = false, uiCollapsed = false, uiIdleTimer = 0;
try { uiPinned = localStorage.getItem('universe.uiPinned') === '1'; } catch (e) { /* 隱私模式: 忽略 */ }

function setUi(collapsed){
  if (collapsed === uiCollapsed) return;
  uiCollapsed = collapsed;
  $ui.classList.toggle('collapsed', collapsed);
  $uiShow.classList.toggle('show', collapsed);
  // aria-expanded 掛在喚出鈕上: 螢幕閱讀器從這裡得知面板開闔狀態
  $uiShow.setAttribute('aria-expanded', String(!collapsed));
  if (collapsed){
    // 收起時把焦點交回喚出鈕, 避免焦點落在 visibility:hidden 的元素裡
    if ($ui.contains(document.activeElement)) $uiShow.focus();
  } else {
    armUiIdle();            // 重新展開 = 使用者需要它, 重新開始計時
  }
}
function armUiIdle(){
  clearTimeout(uiIdleTimer);
  if (uiPinned || uiCollapsed) return;
  uiIdleTimer = setTimeout(uiIdleTick, UI_IDLE_MS);
}
// 游標還停在面板上時不收起: 閱讀/對焦某個控件而幾秒不動是常事,
// 直接抽走會讓人以為當機。只在真正支援 hover 的裝置上檢查 ——
// 觸控裝置的 :hover 會「黏住」(點完就一直在 hover 態), 那樣面板就永遠不會收了。
const CAN_HOVER = matchMedia('(hover: hover)').matches;
function uiIdleTick(){
  if (uiPinned || uiCollapsed) return;
  if (CAN_HOVER && $ui.matches(':hover')) { armUiIdle(); return; }  // 還在用, 重新倒數
  setUi(true);
}
function setPinned(v, arm){
  uiPinned = v;
  $uiPin.setAttribute('aria-pressed', String(v));
  try { localStorage.setItem('universe.uiPinned', v ? '1' : '0'); } catch (e) { /* 忽略 */ }
  if (!v && arm) armUiIdle();      // 解除釘選 = 重新開始計時
  if (v) clearTimeout(uiIdleTimer); // 釘選 = 停止計時
}
$uiHide.addEventListener('click', () => setUi(true));
$uiShow.addEventListener('click', () => setUi(false));
$uiPin.addEventListener('click', e => setPinned(!uiPinned, true));
// 面板內任何操作都視為「正在使用」, 重置閒置計時
$ui.addEventListener('pointerdown', armUiIdle);
$ui.addEventListener('input', armUiIdle);
// 操作畫面 (拖曳/滾輪/點擊) 也算在用, 別把面板從眼前抽走
renderer.domElement.addEventListener('pointerdown', armUiIdle);
renderer.domElement.addEventListener('wheel', armUiIdle, { passive: true });
setPinned(uiPinned, false);  // 只同步 📌 初始外觀, 不起計時: 載入中閒置時間沒有意義
$uiShow.setAttribute('aria-expanded', 'true');   // 初始展開 (setUi 只在狀態變化時寫)
// 計時不在這裡起跑: 載入中面板被 #loader 蓋住, 閒置時間沒有意義,
// 只會發生「畫面一出現面板就自動消失」的體驗。改由 hideLoader() 完成後才開始計時。

// 換語言時 aria 標籤由 applyStatic() 處理; 這裡只需讓標題屬性跟著更新
window.addEventListener('langchange', () => {
  $uiPin.setAttribute('aria-pressed', String(uiPinned));
});

// =============================================================================
//  圖例 (右下角文字備註) 自動隱藏: 這是一讀完就不再需要的說明, 不該常駐畫面。
//  策略與面板不同 —— 圖例沒有「正在使用」的概念, 所以用
//  「閒置 12 秒」+「手動 ✕」兩種;  ✕ 只在 hover 時浮現, 平時不打擾閱讀。
//  隱藏後右下角留一枚輕量喚回鈕 (記住這次關閉, 同一 session 不再自動彈回)。
// =============================================================================
const LEGEND_IDLE_MS = 12000;
const $legend = document.querySelector('.legend-wrap');
const $legendShow = $('legendShow'), $legendHide = $('legendHide');
let legendShown = true, legendIdleTimer = 0, legendDismissed = false;

function setLegend(shown){
  if (shown === legendShown) return;
  legendShown = shown;
  $legend.classList.toggle('hidden', !shown);
  $legendShow.classList.toggle('show', !shown);
  if (shown) armLegendIdle();   // 喚回 = 使用者需要它, 重新開始計時
}
function armLegendIdle(){
  clearTimeout(legendIdleTimer);
  if (!legendShown) return;
  legendIdleTimer = setTimeout(() => setLegend(false), LEGEND_IDLE_MS);
}
$legendHide.addEventListener('click', e => {
  e.stopPropagation();
  setLegend(false);
  legendDismissed = true;       // 手動關閉 = 明確不需要, 這一 session 不再自動彈回
});
$legendShow.addEventListener('click', () => { legendDismissed = false; setLegend(true); });
// 計時不在這裡起跑: 與面板同一個理由, 載入中隱藏沒有意義。改由 hideLoader() 起 arm。

// --- 點擊行星自動飛行靠近 ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isPrimary) return; // 次要指針/右鍵不記錄也不中斷飛行
  flyTo.active = false; downXY = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointercancel', () => { downXY = null; });
renderer.domElement.addEventListener('wheel', () => { flyTo.active = false; }, { passive: true });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downXY) return;
  const dx = e.clientX - downXY[0], dy = e.clientY - downXY[1]; downXY = null;
  if (e.button !== 0 || !e.isPrimary) return; // 右鍵平移/中鍵/多指不觸發聚焦 (L7)
  if (Math.hypot(dx, dy) > 6) return; // 拖曳旋轉不觸發
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickable, false);
  // r160 Raycaster 不看 visible -> 隐藏的黑洞仍可被命中, 這裡手動過濾 (M1)
  const hit = hits.find(h => h.object.userData.focusIndex !== undefined &&
    !(h.object.userData.focusIndex === -3 && !bhOn));
  if (hit) focusOn(hit.object.userData.focusIndex);
});

const flyTo = { active: false, index: -1, dist: 200, t: 0 };
function getFocusPos(idx, out){
  if (idx === -2) out.set(0, 0, 0);                 // 太陽 (黃道群組原點)
  else if (idx === -3) out.copy(BH.pos);            // 黑洞
  else planetObjs[idx].obj.getWorldPosition(out);   // 行星
  return out;
}
// 等螢幕佔比聚焦: 目標直徑固定佔畫面高度 FOCUS_FRAC (fov=50° => FOCUS_K≈6.5)
const FOCUS_FRAC = 0.35;
const FOCUS_K = 1 / Math.tan(camera.fov * 0.5 * FOCUS_FRAC * DEG);
// 跟隨每幀位移暫存器: 先以「目標位移」平移整個 rig (camera+target), 零滯後追擊
const _fd = new THREE.Vector3(), _trackPos = new THREE.Vector3(), _prevTrack = new THREE.Vector3();
let hasTrack = false;
function focusEffR(idx){
  if (idx === -2) return SUN_R * 1.5;              // 太陽
  const p = PLANETS[idx];
  return p.rDisp * (p.ring ? 2.9 : 1.4);           // 土星含環餘裕 (環外緣 2.4×rDisp)
}
function focusDistFor(idx){
  if (idx === -3) return BH.diskOuter * 0.9 + 30;  // 黑洞: 停在吸積盤外側
  return focusEffR(idx) * FOCUS_K;
}
function focusOn(idx){
  if (idx === -3 && !bhOn) { $('focus').value = String(followIdx); return; } // 隱藏的黑洞不可聚焦
  followIdx = idx; $('focus').value = String(idx);
  hasTrack = false; // 重設跟隨暫存器, 避免跨目標的大位移
  if (idx === -1) { flyTo.active = false; controls.minDistance = 30; return; } // 自由視角
  flyTo.active = true; flyTo.index = idx; flyTo.t = 0;
  // 依目標大小動態調整最近距離 (黑洞維持 30); 以目的地 effR 設定避免中途換目標時 snap
  controls.minDistance = idx === -3 ? 30 : Math.max(focusEffR(idx) * 1.05, 0.5);
  flyTo.dist = focusDistFor(idx);
}
/* 簡易透明度漸變: 180ms ease-out cubic; 依 key 中斷同目標的舊漸變 (新值接管) */
const fades = [];
function fadeTo(key, apply, from, to, ms, done){
  for (let i = fades.length - 1; i >= 0; i--) if (fades[i].key === key) fades.splice(i, 1);
  fades.push({ key, apply, from, to, ms, t0: performance.now(), done });
}
function stepFades(){
  const now = performance.now();
  for (let i = fades.length - 1; i >= 0; i--){
    const f = fades[i];
    const t = Math.min(1, (now - f.t0) / f.ms);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    f.apply(f.from + (f.to - f.from) * e);
    if (t >= 1){ fades.splice(i, 1); f.done && f.done(); }
  }
}
const ORBIT_OPACITY = 0.45;
$('tOrbits').addEventListener('click', e => {
  showOrbits = !showOrbits; e.target.classList.toggle('on', showOrbits);
  e.target.setAttribute('aria-pressed', String(showOrbits));
  const mats = planetObjs.map(o => o.orbitLine.material);
  const cur = mats[0].opacity;
  if (showOrbits) planetObjs.forEach(o => o.orbitLine.visible = true);
  fadeTo('orbits', v => mats.forEach(m => m.opacity = v), cur, showOrbits ? ORBIT_OPACITY : 0, 180,
    () => { if (!showOrbits) planetObjs.forEach(o => o.orbitLine.visible = false); });
});
let labelsHideTimer = 0;
$('tLabels').addEventListener('click', e => {
  showLabels = !showLabels; e.target.classList.toggle('on', showLabels);
  e.target.setAttribute('aria-pressed', String(showLabels));
  clearTimeout(labelsHideTimer); // 取消前一次尚未觸發的隱藏 (L4: off→on→off 不再腰斬第二次淡出)
  if (showLabels) { labelLayer.style.display = ''; requestAnimationFrame(() => labelLayer.classList.remove('hidden')); }
  else { labelLayer.classList.add('hidden'); labelsHideTimer = setTimeout(() => { if (!showLabels) labelLayer.style.display = 'none'; }, 200); }
});
$('tLens').addEventListener('click', e => {
  lensOn = !lensOn; e.target.classList.toggle('on', lensOn);
  e.target.setAttribute('aria-pressed', String(lensOn));
});
$('tBH').addEventListener('click', e => {
  bhOn = !bhOn; e.target.classList.toggle('on', bhOn);
  e.target.setAttribute('aria-pressed', String(bhOn));
  const horizonMat = BH.group.children[0].material;
  const bhLabelDiv = BH.label.element;
  const cur = horizonMat.opacity;
  if (bhOn) { BH.group.visible = true; BH.label.visible = true; bhLabelDiv.style.display = ''; }
  // 標籤由 CSS2DRenderer 獨立渲染 (不看祖先 visible), 必須與群組一起淡出/隱藏 (H4)
  fadeTo('bh', v => {
    horizonMat.opacity = v; BH.diskMat.uniforms.uOpacity.value = v;
    bhLabelDiv.style.opacity = String(v);
  }, cur, bhOn ? 1 : 0, 180,
    () => { if (!bhOn){
      BH.group.visible = false; BH.label.visible = false; bhLabelDiv.style.display = 'none';
      if (followIdx === -3) focusOn(-1); // 停止追擊隱形黑洞
    } });
});

// =============================================================================
//  動畫迴圈
// =============================================================================
const clock = new THREE.Clock();
let simTime = 0; // 模擬年數
const _wp = new THREE.Vector3(), _cam = new THREE.Vector3();
const _tmpV = new THREE.Vector3();
const _sv = new THREE.Vector3();
const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

function updatePlanet(o, dt){
  const p = o.data;
  const M = p.M0 + TWO_PI * simTime / p.period;
  const E = solveKepler(M, p.e);
  const xv = p.aDisp * (Math.cos(E) - p.e);
  const yv = p.aDisp * Math.sqrt(1 - p.e*p.e) * Math.sin(E);
  const v = new THREE.Vector3(xv, yv, 0).applyMatrix4(o.orbitBase);
  o.obj.position.copy(v);
  // 自轉: 真實週期比, 但視覺上限速。0.2 年/秒 × 365 轉/年 = 73 轉/秒,
  // 遠超畫面更新率 -> 紋理閃爍。以 dt 積分並鉗制在 0.8 轉/秒以內 (保留逆行符號)。
  const spinYr = p.spinHr / (24 * 365.25);
  const MAX_SPD = 0.8 * TWO_PI;                      // rad/s
  let w = TWO_PI * simSpeed / spinYr;
  if (w > MAX_SPD) w = MAX_SPD; else if (w < -MAX_SPD) w = -MAX_SPD;
  p._spin = (p._spin || 0) + dt * w;
  o.mesh.rotation.y = p._spin;
  if (p._clouds) p._clouds.rotation.y = p._spin * 1.5;       // 雲層略快於地表
  if (p._moonPivot){                                          // 月球軌道同限速: 0.0748 年週期@0.2 = 2.7 轉/秒
    let wm = TWO_PI * simSpeed / 0.0748;
    if (wm > MAX_SPD) wm = MAX_SPD;
    p._moonPhase = (p._moonPhase || 0) + dt * wm;
    p._moonPivot.rotation.y = p._moonPhase;
  }
}

let lensSmooth = 2.5;          // 透鏡強度包絡 (L12: 開關時淡入淡出而非瞬變)
const _desired = new THREE.Vector3();

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) simTime += dt * simSpeed;

  // 行星 (暫停時不積分自轉)
  const simDt = paused ? 0 : dt;
  for (const o of planetObjs) updatePlanet(o, simDt);
  stepFades();

  // 太陽 / 星空 / 吸積盤 動畫
  sunUniforms.uTime.value = simTime;
  starMat.uniforms.uTime.value = simTime * 0.5;
  if (bhOn) BH.diskMat.uniforms.uTime.value = simTime * 0.5;

  // 黑洞軌道
  if (bhOn) {
    BH.angle += dt * simSpeed * (TWO_PI / BH.periodYr);
    BH.pos.set(
      BH.R * Math.cos(BH.angle),
      BH.R * Math.sin(BH.angle) * Math.sin(BH.incl),
      BH.R * Math.sin(BH.angle) * Math.cos(BH.incl)
    );
    BH.group.position.copy(BH.pos);
    BH.group.rotation.y += dt * 0.05; // 緩慢自旋視覺
  }

  // 目標每幀位移 -> 直接平移整個鏡頭 rig (camera+target), 零滯後追擊;
  // 飛行/跟隨只需收斂剩餘誤差, 對內行星高速軌道也能抵達 (H1)
  const tracking = flyTo.active ? flyTo.index : (followIdx !== -1 ? followIdx : -1);
  if (tracking !== -1) {
    getFocusPos(tracking, _trackPos);
    if (hasTrack) _fd.subVectors(_trackPos, _prevTrack); else _fd.set(0, 0, 0);
    _prevTrack.copy(_trackPos); hasTrack = true;
    if (_fd.lengthSq() > 1e-12){ camera.position.add(_fd); controls.target.add(_fd); }
  }

  // 鏡頭跟隨 / 點擊飛行
  if (flyTo.active) {
    getFocusPos(flyTo.index, _wp);
    _cam.copy(camera.position).sub(_wp);
    if (_cam.lengthSq() < 1e-6) _cam.set(0, 0.4, 1);
    _cam.normalize();
    _desired.copy(_wp).add(_cam.multiplyScalar(flyTo.dist));
    if (reduceMotion) {
      controls.target.copy(_wp);
      camera.position.copy(_desired);
      flyTo.active = false;
    } else {
      flyTo.t += dt;
      controls.target.lerp(_wp, damp(9.0, dt));
      camera.position.lerp(_desired, damp(6.3, dt));
      // 抵達目標距離, 或 2.2s 安定上限 (殘差在此時間內已指數收斂)
      if (camera.position.distanceTo(_desired) < Math.max(flyTo.dist * 0.06, 0.1) || flyTo.t > 2.2) flyTo.active = false;
    }
  } else if (followIdx !== -1) {
    // H5: 太陽/黑洞 (-2/-3) 同樣進入跟隨
    getFocusPos(followIdx, _wp);
    controls.target.lerp(_wp, damp(7.7, dt));
  }

  controls.update();
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  // 黑洞: 視空間位置 (幾何透鏡彎曲) + 相機盤面方位角 (都卜勒方向)
  if (bhOn) {
    _tmpV.copy(BH.pos).applyMatrix4(camera.matrixWorldInverse);
    BH.diskMat.uniforms.uBhViewPos.value.copy(_tmpV);
    _tmpV.copy(camera.position);
    BH.group.worldToLocal(_tmpV);               // 含軌道位置/傾角/自旋 (r160 worldToLocal 會自更新矩陣)
    BH.diskMat.uniforms.uCamAz.value = Math.atan2(_tmpV.z, _tmpV.x);
  }

  // 大氣/夜燈的視空間太陽方向
  for (const a of atmoMats){
    a.obj.getWorldPosition(_sv).negate().normalize();        // 世界座標: 行星 -> 太陽
    _sv.transformDirection(camera.matrixWorldInverse);        // -> 視空間
    a.mat.uniforms.uSunDirView.value.copy(_sv);
    if (a.obj === planetObjs[2].obj && earthNightShader) earthNightShader.uniforms.uSunDirView.value.copy(_sv);
  }

  // 引力透鏡: 投影黑洞到螢幕空間; 強度平滑 (L12), 且僅在黑洞「本幀確實可投影」時輸出,
  // 否則用上一幀的 bhUV/bhRadius 會在空處殘留幽靈光子環 (後台驗證: real)
  const wantLens = (lensOn && bhOn) ? 2.5 : 0;
  lensSmooth += (wantLens - lensSmooth) * damp(12.0, dt);
  if (lensSmooth < 0.001) lensSmooth = 0;
  let lensProjected = false;
  if (lensSmooth > 0.001 && bhOn) {
    const view = _tmpV.copy(BH.pos).applyMatrix4(camera.matrixWorldInverse);
    if (view.z < 0) { // 在相機前方
      const ndc = _tmpV.copy(BH.pos).project(camera);
      lensingPass.uniforms.bhUV.value.set(ndc.x*0.5+0.5, ndc.y*0.5+0.5);
      const dist = camera.position.distanceTo(BH.pos);
      const fov = camera.fov * DEG;
      const rUV = (BH.horizonR / dist) / (2 * Math.tan(fov/2));
      lensingPass.uniforms.bhRadius.value = rUV;
      lensProjected = true;
    }
  }
  lensingPass.uniforms.strength.value = lensProjected ? lensSmooth : 0;

  composer.render();
  labelRenderer.render(scene, camera);
}

// =============================================================================
//  視窗縮放
// =============================================================================
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight); // 已含所有 pass (含 bloom) 的像素比縮放尺寸
  labelRenderer.setSize(innerWidth, innerHeight);
  lensingPass.uniforms.aspect.value = innerWidth / innerHeight;
  starMat.uniforms.uPixel.value = renderer.getPixelRatio();
});

// =============================================================================
//  換語言: 重繪所有「由 main.js 寫入」的動態文字
//  (index.html 的 data-i18n 靜態部分由 applyStatic() 負責, 這裡只補它看不到的)
// =============================================================================
function renderDynamicUI(){
  // 1. 3D 標籤 (行星顯示名 + 黑洞)
  for (const o of planetObjs) if (o.labelEl) o.labelEl.textContent = pname(o.data.name);
  if (BH.label && BH.label.element) BH.label.element.textContent = t('label.bh');
  // 2. 鏡頭追蹤選單: 只改 text, value (索引) 不動 → 選中項不會被刷掉
  for (const f of focusOptions) f.opt.textContent = pname(f.name);
  // 3. 目前狀態相關的即時文字
  $('speedVal').textContent = t('unit.yrPerSec', { v: simSpeed.toFixed(2) });
  const pb = $('pause');
  pb.textContent = paused ? t('btn.play') : t('btn.pause');
  // 4. 載入進度 (若已淡出, renderLoaderTex 自行 return)
  renderLoaderTex();
}
window.addEventListener('langchange', renderDynamicUI);
renderDynamicUI(); // 初始同步: index.html 的預置文字一律是中文, 語言為 en 時靠這裡轉正

// 啟動: 等初始貼圖批次載入完成再淡出載入覆蓋層 (M4)
window.__universeReady = true;
const loaderEl = document.getElementById('loader');
async function hideLoader(){
  const jobs = [];
  for (const p of PLANETS){
    if (p._upg) jobs.push(p._upg);
    if (p._ringUpg) jobs.push(p._ringUpg);
    if (p._moonUpg) jobs.push(p._moonUpg);
  }
  try { await Promise.all(jobs); } catch (e){ /* 單檔失敗已在 loadTex 內處理 */ }
  if (window.__universeError) return; // 錯誤覆蓋層優先, 不得被淡出蓋掉
  loaderEl.classList.add('done');
  armUiIdle();  // 載入結束才開始算「閒置」: 載入期間計時沒有意義, 只會讓面板一出現就消失
  if (!legendDismissed) armLegendIdle();  // 圖例同理, 載入完才開始倒數
  loaderEl.addEventListener('transitionend', () => { loaderEl.style.display = 'none'; }, { once: true });
  setTimeout(() => { loaderEl.style.display = 'none'; }, 400); // 保底: transitionend 未觸發時也會移除
}
animate();
hideLoader();
