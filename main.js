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
  // 冥王星 (矮行星, 古柏帶天體): 高離心率 (0.244) 與高軌道傾角 (17.16°) 是它的招牌。
  // binary = 冥王星–凱龍雙體系統: 兩者繞【共同質心】互繞。sepF 以冥王星顯示半徑為單位,
  // 取真實值 16.5 (=19640 km / 1188 km), 於是冥王星到質心 = sepF×q/(1+q) = 1.79×半徑
  // > 1 ⇒ 質心落在冥王星【表面之外】。這是它與一般「行星＋衛星」最不同之處。
  // 潮汐互鎖: 兩者永遠以同一面朝向對方 (自轉週期 = 公轉週期 = 6.387 天)。
  { name:'冥王星',a:39.5, e:0.2488, period:248.0,  radiusKm:1188,  incl:17.16,node:110.3,peri:113.8, tilt:122.53,spinHr:-153.3,  type:'dwarf', color:[201,172,142], seed:99,
    binary:{ name:'Charon', map:'charon', radiusKm:606, periodD:6.387, massRatio:0.1217, sepF:16.5, color:[150,145,140] } },
];

// 距離壓縮係數 (讓內外行星都可視), 行星大小相對比保持真實
const DIST_K = 66;
const distScale = a => Math.pow(a, 0.65) * DIST_K;
const SUN_R = 16;                 // 太陽視覺半徑

// 衛星資料表: periodD 為真實軌道週期 (天), 故 Io:Europa:Ganymede 的
// 4:2:1 拉普拉斯共振在模擬中自動成立。aKm/radiusKm 為真實值 (文件用),
// aF/rF 為相對宿主的壓縮顯示比例 (與距離壓縮同一哲學)。
// map: 貼圖檔名; mapMode: 'cyl' = 真等距圓柱全球地圖 (NASA PIA03781),
//      'band' = 球面鑲嵌取赤道帶鏡像拼接 (來源為 NASA 球面視角圖, 如實標註)。
const MOONS = [
  { host:'木星', name:'Io',       periodD:1.769,  aKm:421700,  radiusKm:1822, aF:2.6, rF:0.105, color:[230,200,90],  map:'io',       mapMode:'disc' },
  { host:'木星', name:'Europa',   periodD:3.551,  aKm:671034,  radiusKm:1561, aF:3.3, rF:0.090, color:[210,200,180], map:'europa',   mapMode:'disc' },
  { host:'木星', name:'Ganymede', periodD:7.155,  aKm:1070412, radiusKm:2634, aF:4.2, rF:0.148, color:[150,140,130], map:'ganymede', mapMode:'cyl'  },
  { host:'木星', name:'Callisto', periodD:16.689, aKm:1882709, radiusKm:2410, aF:5.3, rF:0.136, color:[120,110,100], map:'callisto', mapMode:'disc' },
  { host:'土星', name:'Enceladus',periodD:1.370,  aKm:237948,  radiusKm:252,  aF:3.4, rF:0.055, color:[240,245,250], map:'enceladus',mapMode:'disc', plume:true },
  { host:'土星', name:'Titan',    periodD:15.945, aKm:1221870, radiusKm:2575, aF:5.0, rF:0.145, color:[220,170,80],  map:'titan',    mapMode:'disc' },
];
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
const sunUniforms = { uTime: { value: 0 }, uVis: { value: 1 } };
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_R, 64, 64),
  new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: `varying vec3 vN; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vN; varying vec2 vUv; uniform float uTime; uniform float uVis;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
      float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }
      void main(){
        vec2 p = vUv * vec2(6.0, 3.0);
        // uVis: 戴森殼遮蔽後對外可見的比例 (1-f)。恆星仍在燃燒, 只是被擋住了。
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
        gl_FragColor = vec4(col * 3.0 * uVis, 1.0);  // 熱區 ~2.5 超過 bloom threshold(2.0) -> 柔和暈, 顆粒紋理仍清晰
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
// 解析式環影: 薄環在立方陰影圖 (1024²) 中只佔幾個 texel, PCF 救不回 ——
// 環投在球面的影子會變成鋸齒黑帶。改以解析解: 表面點→太陽射線與環面
// (赤道面, 即物件空間 y=0) 求交, 以交點半徑取環貼圖 alpha 衰減直射光。
// 與解析度無關、零鋸齒; 環縫 (卡西尼縫) 自然透出亮光。
const RS_VS_DECL   = 'varying vec3 vObjPosRS;';
const RS_VS_SET    = 'vObjPosRS = position;';
const RS_VS_MARKER = '#include <project_vertex>';
const RS_FS_HEAD = `
uniform sampler2D uRingTex;
uniform vec2  uRingRad;   // 環內/外半徑 (物件空間)
uniform vec3  uSunObj;    // 太陽位置 (物件空間)
uniform float uRingOn;    // 環貼圖就緒與否 (程序化降級環無 alpha, 不投影)
varying vec3 vObjPosRS;
float ringShadowFactor(){
  if ( uRingOn < 0.5 ) return 1.0;
  vec3 L = normalize( uSunObj - vObjPosRS );
  if ( abs( L.y ) < 1e-4 ) return 1.0;      // 射線平行環面: 無影
  float t = -vObjPosRS.y / L.y;             // 與 y=0 平面交點參數
  if ( t <= 0.0 ) return 1.0;               // 交點在表面點後方: 無影
  vec2 q = vObjPosRS.xz + L.xz * t;
  float r = length( q );
  if ( r < uRingRad.x || r > uRingRad.y ) return 1.0;
  float u0 = ( r - uRingRad.x ) / ( uRingRad.y - uRingRad.x );
  float du = 0.12 / ( uRingRad.y - uRingRad.x );   // ~0.12 單位徑向模糊 = 半影軟邊
  float a = ( texture2D( uRingTex, vec2(u0-du,0.5) ).a
            + texture2D( uRingTex, vec2(u0,0.5) ).a
            + texture2D( uRingTex, vec2(u0+du,0.5) ).a ) / 3.0;
  return 1.0 - 0.85 * a;                    // 環非全不透明, 保留 15% 透光
}`;
const RS_LFB_MARKER = '#include <lights_fragment_begin>';
const RS_LIGHT_NEEDLE = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const RS_LIGHT_PATCH  = RS_LIGHT_NEEDLE + '\n\t\tdirectLight.color *= ringShadowFactor();';
function applyRingShadow(mat, p, obj){
  const inner = p.rDisp * 1.3, outer = p.rDisp * 2.4;
  p._rsU = {
    tex: { value: null },
    rad: { value: new THREE.Vector2(inner, outer) },
    sun: { value: new THREE.Vector3() },
    on:  { value: 0 },
  };
  p._rsQinv = obj.quaternion.clone().invert();   // 世界→物件空間 (軸傾為常數)
  const prevCompile = mat.onBeforeCompile;         // 串接 wrap lighting 的 patch, 不可覆寫
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = shader => {
    if (prevCompile) prevCompile(shader);
    shader.uniforms.uRingTex = p._rsU.tex;
    shader.uniforms.uRingRad = p._rsU.rad;
    shader.uniforms.uSunObj  = p._rsU.sun;
    shader.uniforms.uRingOn  = p._rsU.on;
    if (!shader.vertexShader.includes(RS_VS_MARKER)){
      console.warn(t('err.patchInclude'));
    } else {
      shader.vertexShader = RS_VS_DECL + '\n' + shader.vertexShader
        .replace(RS_VS_MARKER, RS_VS_MARKER + '\n\t' + RS_VS_SET);
    }
    if (!shader.fragmentShader.includes(RS_LFB_MARKER)
        || !THREE.ShaderChunk.lights_fragment_begin.includes(RS_LIGHT_NEEDLE)){
      console.warn(t('err.patchDiffuse'));
    } else {
      shader.fragmentShader = RS_FS_HEAD + '\n' + shader.fragmentShader
        .replace(RS_LFB_MARKER,
          THREE.ShaderChunk.lights_fragment_begin.replace(RS_LIGHT_NEEDLE, RS_LIGHT_PATCH));
    }
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '+ringshadow';
}
// 土星環的視角相關亮度 (opposition surge + forward scattering)。
//
//  真實土星環不是朗伯反射面, 亮度依【相位角 α】(在環處, 太陽與觀者兩方向夾角)
//  而變:
//   · α→0 (衝日, 太陽在觀者背後): 【Seeliger 效應 / 衝日增亮】。環粒子間的
//     互相遮蔽在此刻歸零 (shadow-hiding) + 相干背散射 => 環急遽變亮。
//     這正是「衝日」時土星環最亮、卡西尼縫最明顯的原因。
//   · α→180° (背光, 太陽在環另一側): 【前向散射】。微米級冰粒把光向前散射,
//     背光看環反而更亮 (與行星大氣前向散射同源)。
//  兩者都是相位角的函數, 中間 (α≈90°, 側光) 最暗。
//
//  為何可用單一標量: 環的徑向尺度 (~1.4×rDisp) 遠小於土星–太陽距離, 故整個環面
//  的相位角近乎一致 (差異 < 1°), 不需逐 texel 計算 —— 這是物理上合理的近似。
//
//  上限: 峰值倍率壓在 ~1.55, 環色 (≤0.85) × 1.55 ≈ 1.32 < bloom threshold(2.0),
//  故增亮是真的變亮, 不會被 UnrealBloomPass 燒成方塊 (與星點/行星同一戒律)。
const RING_SURGE_OPP = 0.45, RING_W_OPP = 0.105;   // 衝日: 幅度, 半寬 (rad, ≈6°)
const RING_SURGE_FWD = 0.55, RING_W_FWD = 0.21;    // 前向: 幅度, 半寬 (rad, ≈12°)
function ringBrightness(phaseRad){
  const a = phaseRad;
  const opp = RING_SURGE_OPP * Math.exp(-0.5 * Math.pow(a / RING_W_OPP, 2));
  const fwd = RING_SURGE_FWD * Math.exp(-0.5 * Math.pow((Math.PI - a) / RING_W_FWD, 2));
  return 1 + opp + fwd;
}
// 太陽在世界原點。傳入環宿主 (土星 obj) 的世界座標與相機世界座標, 回傳相位角 α。
const _rbToSun = new THREE.Vector3(), _rbToCam = new THREE.Vector3();
function ringPhaseAngle(hostWorld, camWorld){
  _rbToSun.copy(hostWorld).negate();            // 環 -> 太陽 (世界原點)
  _rbToCam.copy(camWorld).sub(hostWorld);       // 環 -> 相機
  if (_rbToSun.lengthSq() < 1e-9 || _rbToCam.lengthSq() < 1e-9) return 0;
  return _rbToSun.angleTo(_rbToCam);            // [0, π]
}
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
  // 快取鍵必須區分【不同的】extraPatch: 早期版一律回傳 '-night', 若木星差速自轉
  // 與地球夜燈 wrap 值相同會共用同一個已編譯程式 (著色器張冠李戴)。
  // 以 extraPatch.key 區分 (無 key 時退回 '-night' 保持相容)。
  const patchKey = extraPatch ? '-' + (extraPatch.key || 'night') : '';
  mat.customProgramCacheKey = () => 'wrap' + wrap + patchKey;
}
// 木星差速自轉 (differential rotation): 真實木星不是剛體 —— 赤道帶自轉週期
// 9h50m (System I), 極區 9h55m (System II), 其間是交替的東/西向噴流 (zonal jets)。
// 視覺實作: 剛體自轉 (mesh.rotation.y) 之上, 再依【緯度】對 map 的 u 座標加一個
// 隨時間累積的剪切偏移 ⇒ 赤道跑在前、高緯滯後、噴流帶彼此滑動 —— 一眼就是「活」的木星。
// 為何 patch map_fragment 而非幾何: 差速是紋理層現象, 動幾何會破壞球體與光照。
// uDiffTime 由每幀 p._spin 餵入 (與自轉同源, 暫停即凍結); uDiffAmp 控制剪切幅度。
function injectDifferentialRotation(shader){
  shader.uniforms.uDiffTime = { value: 0 };
  // uDiffAmp: 剪切幅度。真實木星赤道/極區自轉差 ≈ 0.85% (9h50m vs 9h55m),
  // 但那是【每轉】的量, 且會隨時間累積 —— 每個緯度帶是水平的週期條紋,
  // 沿 u 平移永遠不會「亂掉」(條紋只是橫向滑動), 故可略大於真實值以肉眼可見。
  // 0.012 => 赤道每轉約超前極區 0.07 個紋理寬 (≈真實的 8x), 帶紋保持連貫,
  // 大紅斑會在數十轉後緩慢漂移 —— 這正是「活」的木星。
  shader.uniforms.uDiffAmp = { value: 0.012 };
  const chunk = THREE.ShaderChunk.map_fragment;
  if (!chunk.includes('texture2D( map, vMapUv )')){
    console.warn(t('err.patchDiffuse'));   // r160 若改了取樣行名, 退回無差速 (不崩潰)
    return;
  }
  const patched = chunk.replace('texture2D( map, vMapUv )',
    'texture2D( map, vec2( vMapUv.x + uZonalOffset(vMapUv.y), vMapUv.y ) )');
  const decl = `
uniform float uDiffTime;
uniform float uDiffAmp;
float uZonalOffset(float v){
  float lat = (v - 0.5) * 3.14159265;              // v=0.5 赤道 -> lat=0; 兩極 -> ±π/2
  float w = 0.55 * (cos(lat) - 1.0);               // 赤道超轉 (w=0), 越高緯越滯後
  w += 0.16 * sin(4.0 * lat);                      // 交替噴流: 相鄰帶反向剪切
  return uDiffTime * w * uDiffAmp;
}`;
  if (!shader.fragmentShader.includes('#include <map_fragment>')){
    console.warn(t('err.patchInclude'));
    return;
  }
  shader.fragmentShader = decl + '\n' + shader.fragmentShader.replace('#include <map_fragment>', patched);
  jupiterDiffShader = shader;                       // 供每幀更新 uDiffTime
}
injectDifferentialRotation.key = 'diff';
let jupiterDiffShader = null;
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
let earthLightning = null;   // 地球夜面閃電系統 (每幀需知道雲層框架下的太陽方向)
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
// 雙波長瑞利散射 (Rayleigh): 大氣散射截面 ∝ λ^-4, 故藍光散射最強 (白天邊緣藍)。
// 當太陽接近地平線 (從大氣某點看), 光穿過的【空氣質量】(air mass) 變長,
// 藍光被散射殆盡, 剩下的直射光偏紅橘 —— 這就是日落時 limb 轉橘紅的原因。
// uRayTau=0 退回單色 fresnel (舊行為); >0 啟用色相位移。以「正規化到峰值 1」的
// 穿透率 T 乘 glow => 純色相位移, 亮度不減 (真實日落是亮的橘色, 不是暗紅色)。
//   T = exp(-tau·(am-1)·k),  k=(0.513,1.0,2.232) 為 650/550/450nm 的 λ^-4 (綠正規化)
//   am = 1/max(mu,0.10),  mu = cos(太陽天頂角) = dot(N, sunDir)
function addAtmosphere(radius, color, power, ownerObj, rayTau){
  const mat = new THREE.ShaderMaterial({
    transparent:true, side:THREE.BackSide, depthWrite:false, blending:THREE.AdditiveBlending,
    uniforms:{ glow:{ value:new THREE.Color(color) }, uPow:{ value: power }, uSunDirView:{ value:new THREE.Vector3(0,0,1) }, uRayTau:{ value: rayTau||0 } },
    vertexShader:`varying vec3 vN; varying vec3 vV;
      void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader:`varying vec3 vN; varying vec3 vV; uniform vec3 glow; uniform float uPow; uniform vec3 uSunDirView; uniform float uRayTau;
      void main(){
        vec3 n = normalize(vN); vec3 s = normalize(uSunDirView);
        float f=pow(clamp(1.0-abs(dot(n,vV)),0.0,1.0),uPow); // BackSide 無自動法線翻轉, 用 abs 取掠射角; clamp 防插值誤差致負底數
        float mu=dot(n,s);                                    // cos(太陽天頂角): 兩向量皆視空間 => 點積與座標框架無關
        float day=0.15+0.85*max(mu,0.0);
        vec3 col=glow;
        if(uRayTau>0.0){
          float am=1.0/max(mu,0.10);                          // 空氣質量 (掠射時趨大)
          vec3 T=exp(-uRayTau*(am-1.0)*vec3(0.513,1.0,2.232)); // λ^-4 消光
          float mx=max(max(T.r,T.g),T.b);
          col=glow*(T/max(mx,1e-4));                          // 正規化峰值 => 純色相位移, 亮度不減
        }
        gl_FragColor=vec4(col*f*day, f*0.9*day);
      }`,
  });
  atmoMats.push({ mat, obj: ownerObj });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
}

// =============================================================================
//  軸傾與季節指示器
//
//  focus 某行星時畫出:
//    · 自轉軸 (實線, 沿 obj 區域 +Y = 軸傾後的旋轉軸, 北極端有箭頭)
//    · 赤道面圓盤 (obj 區域 XZ 面的環 + 淡填充)
//    · 軌道面法線參考 (虛線): 與自轉軸的夾角【就是軸傾】 => 直觀顯示 23.44° 等
//  為何掛在 obj 而非 mesh: mesh 會自轉 (rotation.y), 軸不進動 => 指示器必須
//  不隨自轉動, 故掛在只帶 tilt 的 obj (對雙體冥王星 obj 原點=質心, 軸仍正確)。
// =============================================================================
function makeAxisIndicator(p, rDisp){
  const g = new THREE.Group();
  g.visible = false;
  const L = rDisp * 1.85;                    // 軸長 (單側)
  // 指示器是【教學示意圖】=> 全部 depthTest:false + 高 renderOrder, 使其像 overlay
  // 一樣恆浮在行星之上 (不被行星本體/大氣/環遮擋)。否則軌道法線虛線有一半在
  // 球體內被吃掉, 幾乎看不見 (實測 orangePx=0)。
  const OVER = { depthTest: false, depthWrite: false };
  const axisMat = new THREE.LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.9, ...OVER });
  // 自轉軸線
  const ax = new THREE.BufferGeometry().setFromPoints([ new THREE.Vector3(0,-L,0), new THREE.Vector3(0,L,0) ]);
  const axLine = new THREE.Line(ax, axisMat); axLine.renderOrder = 20; g.add(axLine);
  // 北極箭頭 (小錐體)
  const cone = new THREE.Mesh(new THREE.ConeGeometry(rDisp*0.14, rDisp*0.36, 12),
    new THREE.MeshBasicMaterial({ color: 0xa9dcff, transparent: true, opacity: 0.95, ...OVER }));
  cone.position.y = L + rDisp*0.16; cone.renderOrder = 20;
  g.add(cone);
  // 赤道面圓盤 (XZ 面)
  const eqR = rDisp * 1.32;
  const SEG = 96, cp = new Float32Array((SEG+1)*3);
  for (let i=0;i<=SEG;i++){ const th=i/SEG*TWO_PI; cp[i*3]=Math.cos(th)*eqR; cp[i*3+1]=0; cp[i*3+2]=Math.sin(th)*eqR; }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(cp,3));
  const eqRing = new THREE.LineLoop(eg, new THREE.LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.7, ...OVER }));
  eqRing.renderOrder = 20; g.add(eqRing);
  // 赤道面淡填充 (環面, additive)
  const disc = new THREE.Mesh(new THREE.RingGeometry(eqR*0.55, eqR, 64, 1),
    new THREE.MeshBasicMaterial({ color: 0x3a6fa8, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, ...OVER }));
  disc.rotation.x = -Math.PI/2; disc.renderOrder = 19;
  g.add(disc);
  // 軌道面法線參考 (虛線) 在 finishAxisIndicator() 加入: 必須等 g 掛進 obj 後,
  // 才能用 obj.quaternion (含 tilt) 算出「軌道面法線在 obj 區域座標的方向」。
  g.userData.L = L;
  return g;
}
// 在指示器加入 obj 後呼叫: 算出軌道面法線 (ecliptic 的 +Y) 在 obj 區域框架的方向
function finishAxisIndicator(g, obj, rDisp){
  const orbN = new THREE.Vector3(0,1,0).applyQuaternion(obj.quaternion.clone().invert());
  const L = g.userData.L;
  const dashMat = new THREE.LineDashedMaterial({ color: 0xffc07c, transparent: true, opacity: 0.85,
    dashSize: rDisp*0.2, gapSize: rDisp*0.14, depthTest: false, depthWrite: false });
  // 從行星【表面】畫到 L (不是從中心): 起點已浮出球體, 加上 depthTest:false => 全程可見
  const dg = new THREE.BufferGeometry().setFromPoints([ orbN.clone().multiplyScalar(rDisp), orbN.clone().multiplyScalar(L) ]);
  const dl = new THREE.Line(dg, dashMat);
  dl.computeLineDistances();                  // LineDashedMaterial 必須呼叫才顯示虛線
  dl.renderOrder = 21;
  g.add(dl);
  g.userData.orbNormalLine = dl;
}

// =============================================================================
//  地球夜面閃電 (lightning)
//
//  真實地球每時每刻約有 1500–2000 場雷暴、每秒 ~44 次閃電, 但只有【夜面】的
//  能被看見 (日面被陽光浹沒)。實作: 一個小 sprite 池 (循環重用) + 隨機排程,
//  成本極低 (共用 glow 貼圖、additive、無新貼圖), 效果顯著。
//
//  兩個「必須隨機」的層次不同:
//   · 【觸發排程與位置】用 Math.random() —— 閃電本就是隨機事件, 且每次閃光
//     只活 ~0.2s, 不會變成持續頻閃 (與 TRAPPIST 耀斑相反: 那是緩變物理量,
//     必須決定性, 否則每幀重抽會變高頻噪訊)。
//   · 【強度包絡】用確定性 exp 衰減 × 正弦抖動: 極快上升 + 多次子閃 + 指數衰減,
//     這才是真實閃電的樣子 (不是一次平滑的淡入淡出)。
// =============================================================================
function makeLightning(hostObj, radius){
  const N = 8;                                  // sprite 池 (同時最多 8 道閃)
  const group = new THREE.Group();
  const tex = makeGlowTexture();
  const flashes = [];
  for (let i = 0; i < N; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xd8ecff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    s.visible = false;
    group.add(s);
    flashes.push({ sprite: s, t: -1, life: 0, seed: Math.random() * TWO_PI });
  }
  hostObj.add(group);
  const state = { group, flashes, radius, host: hostObj, timer: 0, next: 0.15, sunDirLocal: new THREE.Vector3(0,0,1) };
  return state;
}
const _lgDir = new THREE.Vector3();
const _lgQ = new THREE.Quaternion();
function lightningTrigger(st){
  const f = st.flashes.find(x => x.t < 0);       // 找一個空閒的
  if (!f) return;
  // 在夜半球隨機取點: sunDirLocal 指向日面中心, 故夜面 = dot(dir, sun)<0
  const sun = st.sunDirLocal;
  let ok = false;
  for (let k = 0; k < 12; k++){
    _lgDir.set(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1);
    if (_lgDir.lengthSq() < 1e-6) continue;
    _lgDir.normalize();
    if (_lgDir.dot(sun) < -0.15){ ok = true; break; }
  }
  if (!ok) _lgDir.copy(sun).negate();            // 保底: 直接取反日點
  f.sprite.position.copy(_lgDir).multiplyScalar(st.radius * 1.005);  // 雲頂高度
  f.t = 0; f.life = 0.16 + Math.random() * 0.14; f.seed = Math.random() * TWO_PI;
  f.sprite.visible = true;
}
function lightningUpdate(st, dt){
  if (!st) return;
  // 觸發排程: 隨機間隔 (0.08–0.5s), 平均每秒數次 —— 肉眼可見但不噎目
  st.timer += dt;
  if (st.timer >= st.next){
    st.timer = 0;
    st.next = 0.08 + Math.random() * 0.42;
    lightningTrigger(st);                        // 偶爾一次雙閃 (鄰近雲團)
    if (Math.random() < 0.25) lightningTrigger(st);
  }
  for (const f of st.flashes){
    if (f.t < 0) continue;
    f.t += dt;
    const u = f.t / f.life;
    if (u >= 1){ f.t = -1; f.sprite.visible = false; f.sprite.material.opacity = 0; continue; }
    // 包絡: 快速上升 (u<0.08) + 抖動 (2–3 次子閃) + 指數衰減
    const rise = smooth(0.0, 0.08, u);            // 用已定義在前的 smooth (同簽名), 免前向引用
    const flicker = Math.max(0, Math.sin(u * Math.PI * (5 + (f.seed % 3))));
    const env = rise * Math.exp(-u * 3.5) * (0.45 + 0.55 * flicker);
    f.sprite.material.opacity = Math.min(1, env);
    f.sprite.scale.setScalar(st.radius * (0.5 + 0.45 * u));
  }
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
  if (p.name === '冥王星') return TEX_BASE + 'pluto.jpg';  // New Horizons 等距圓柱地圖, 單解析度 (無 8k)
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
const texLoader = new THREE.TextureLoader();   // 僅供無 createImageBitmap 的舊瀏覽器退回用
texLoader.crossOrigin = 'anonymous';
let loadTotal = 0, loadDone = 0;
// 位元組級進度: 每個檔案各自記錄 {loaded, total}。
// 為什麼不直接用 loadTotal/loadDone 算百分比: 檔案大小差 6 倍 (月球 3.64 MB 對
// 小行星盤 4 KB), 用檔案數算會嚴重誤導 —— 前 10 個檔案可能就佔了八成體積。
// 為什麼 total 會邊跑邊長: 瀏覽器同源最多約 6 個並行請求, 後面的檔案在排隊時
// 還沒有回應頭, 拿不到 Content-Length。因此以「已知檔案的平均大小 × 檔案總數」
// 推估應下載量; 隨 headers 陸續到達, 估計值會收斂到真實總量, 而進度條單調不倒退。
const loadFiles = new Map();
let loadPctShown = 0;
function trackBytes(url, e){
  let f = loadFiles.get(url);
  if (!f){ f = { loaded: 0, total: 0 }; loadFiles.set(url, f); }
  if (e){ f.loaded = e.loaded || 0; if (e.total) f.total = e.total; }
  renderLoaderTex();
}
const MB = 1048576;
// 載入進度文字: 進度只在載入階段顯示, 且由本函數獨寫 (msg 上的 data-i18n 已卸下),
// 所以換語言時進度不會被靜態字典蓋掉。
function renderLoaderTex(){
  const el = document.getElementById('loader');
  if (!el || el.classList.contains('done')) return;
  if (!el.dataset.tex) return;                 // 尚未進入貼圖階段 → 維持「初始化星系…」
  if (el.dataset.msg) return;                  // 錯誤訊息優先, 不搶它的文字
  const msgEl = el.querySelector('#loaderMsg');
  let loaded = 0, known = 0, files = 0;
  for (const f of loadFiles.values()){
    loaded += f.loaded;
    if (f.total > 0){ known += f.total; files++; }
  }
  const hasBytes = files > 0 && loaded > 0;
  let pct = 0;
  if (loadTotal > 0 && loadDone >= loadTotal) pct = 100;
  else if (hasBytes){
    // 應下載量 = max(已知總量, 平均大小 × 檔案總數); 後者補上排隊中檔案的份額
    const est = Math.max(known, (known / files) * loadTotal);
    pct = est > 0 ? (loaded / est) * 100 : 0;
  } else {
    pct = loadTotal > 0 ? (loadDone / loadTotal) * 100 : 0;
  }
  pct = Math.max(0, Math.min(100, pct));
  loadPctShown = Math.max(loadPctShown, pct);   // 單調: 估算值修正時不讓進度條倒退
  const bar = el.querySelector('#loaderBar');
  const fill = el.querySelector('#loaderFill');
  if (bar && fill){
    bar.classList.add('on');
    fill.style.width = loadPctShown.toFixed(1) + '%';
    bar.setAttribute('aria-valuenow', String(Math.round(loadPctShown)));
    // 位元組已知時才顯示 MB; 只有檔案數時顯示舊格式, 不假裝知道大小
    if (msgEl){
      msgEl.textContent = hasBytes
        ? t('loader.texBytes', { done: loadDone, total: loadTotal,
            mb: (loaded / MB).toFixed(1), mbTotal: (Math.max(known, (known / files) * loadTotal) / MB).toFixed(1),
            pct: Math.round(loadPctShown) })
        : t('loader.tex', { done: loadDone, total: loadTotal });
    }
  }
}
function loadTex(url, srgb){
  loadTotal++;
  trackBytes(url, null);                    // 先登記, 讓總數在第一個回應到達前就是準的
  // 注意: 參數不叫 t —— 那會遮蔽外層的翻譯函數 t()
  const finish = tex => {
    loadDone++;
    const el = document.getElementById('loader');
    if (el){
      // 進入「貼圖進度」階段: 卸下 data-i18n, 改由 renderLoaderTex() 全權接管,
      // 否則換語言時 applyStatic() 會把進度打回「初始化星系…」
      // (data-i18n 現在掛在 #loaderMsg 上, 不是 #loader)
      const msgEl = el.querySelector('#loaderMsg');
      if (msgEl) msgEl.removeAttribute('data-i18n');
      el.dataset.tex = '1';
      renderLoaderTex();
    }
    return tex;
  };
  return new Promise(res => {
    const fail = () => { console.warn(t('err.texFail'), url); res(finish(null)); };
    const tag = tex => { tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.anisotropy = MAX_ANISO; res(finish(tex)); };
    loadBitmap(url).then(bmp => { const tex = new THREE.Texture(bmp); tex.needsUpdate = true; tag(tex); }, fail);
  });
}
// 帶位元組進度的貼圖載入。
// 為什麼不用 ImageBitmapLoader: 它的 load() 雖接受 onProgress, 內部卻直接
// fetch().blob() 而從不呼叫它 (three r160 實測), 所以拿不到任何位元組資訊。
// 這裡自己抓: 迴圈的 ReadableStream 可以逐 chunk 回報, 即使沒有 Content-Length
// (chunked 回應) 也能累加實際下載量。
async function loadBitmap(url){
  // 無 createImageBitmap 的舊瀏覽器: 退回 three 的 ImageLoader (它有進度回報)。
  // 進度精度較差 (整張完成才更新), 但功能不受影響。
  if (typeof createImageBitmap !== 'function'){
    return new Promise((ok2, no) => {
      texLoader.load(url, img => { trackBytes(url, { loaded: 1, total: 1 }); ok2(img); },
        e => trackBytes(url, e), () => no(new Error('load failed: ' + url)));
    });
  }
  // 每請求逾時: 不穩網路下 TCP 可能停滯而不送 RST, fetch 會永遠掛著。
  // hideLoader 等 Promise.all, 一個掛住的請求會讓覆蓋層永久停留。
  // 90s 遠大於實測的單檔最久下載 (冷載入全頁 27–80s, 單檔更短), 不會誤殺慢連線。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90000);
  try {
    const res = await fetch(url, { credentials: 'same-origin', signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    const lenHeader = res.headers.get('content-length');
    const declared = lenHeader ? parseInt(lenHeader, 10) : 0;
    if (declared) trackBytes(url, { loaded: 0, total: declared });   // 先拿到大小, 進度條起步就準
    let bmp;
    // body 為 null 表示這是 204/205 或 HEAD 類回應
    if (!res.body || !res.body.getReader){
      const blob = await res.blob();
      bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      trackBytes(url, { loaded: blob.size, total: blob.size });
    } else {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;){
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
        trackBytes(url, { loaded: got, total: declared });
      }
      trackBytes(url, { loaded: got, total: declared || got });
      bmp = await createImageBitmap(new Blob(chunks, { type: res.headers.get('content-type') || 'image/jpeg' }),
                                         { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    }
    return bmp;
  } finally {
    clearTimeout(timer);   // 涵蓋整個請求 (含 body 串流), 不是只在 headers 後
  }
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
        sp.dispose();                              // 源圖只被 canvas 管線消費, 不進 GPU -> 立即釋放
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
      // 高程導出法線貼圖: 水星/火星/冥王星都有真實地形起伏 (隕石坑/奧林帕斯山/
      // 冥王星的水冰山脈與 Sputnik Planitia), 晨昏線附近立體感最明顯。
      // (真實 LOLA/MOLA/New Horizons DEM 需網路, 本專案離線優先 => 以 albedo 亮度
      //  梯度近似高程; 對無大氣、陰影即地形的天體, 這是標準且忠實的近似。)
      mat.normalMap = (p.name === '水星' || p.name === '火星' || p.name === '冥王星')
        ? normalFromHeight(day.image, 3.0) : null;
      if (mat.normalMap) mat.normalScale.set(0.8, 0.8);
      mat.needsUpdate = true; T.day = url;
    }
  }
}
async function upgradeRing(ring, gen){
  const url = ringTex();
  if (ring.userData.texUrl === url) return;
  const tex = await loadTex(url, true);   // 不叫 t —— 那會遮蔽外層的翻譯函數 t()
  if (gen !== texGen){ tex && tex.dispose(); return; }
  if (!tex) return; // 失敗保留程序化著色器環
  const old = ring.material;
  ring.material = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, roughness: 1, metalness: 0, envMapIntensity: 0.2, alphaTest: 0.12 });
  // 視角相關亮度: 真實環貼圖走 MeshStandardMaterial (PBR), 無法像程序化環那樣
  // 直接在 ShaderMaterial 裡寫 col*uRingBright。改以 onBeforeCompile 在最終
  // gl_FragColor 前乘上 uRingBright (與程序化環同一實體, 共用 ring.userData.brightU)。
  const brightU = ring.userData.brightU;
  if (brightU){
    ring.material.onBeforeCompile = shader => {
      shader.uniforms.uRingBright = brightU;
      const needle = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
      if (shader.fragmentShader.includes(needle)){
        shader.fragmentShader = 'uniform float uRingBright;\n' +
          shader.fragmentShader.replace(needle, 'gl_FragColor = vec4( outgoingLight * uRingBright, diffuseColor.a );');
      } else {
        console.warn(t('err.patchDiffuse'));
      }
    };
    ring.material.customProgramCacheKey = () => 'ringbright';
  }
  // alphaTest>0 讓 r160 自動複製 map+alphaTest 成 distance-material 變體 -> 環縫有真實透明陰影
  if (old){ if (old.map) old.map.dispose(); old.dispose(); }
  ring.castShadow = false;   // 環影改由行星 shader 解析計算 (shadow map 對薄環會鋸齒)
  ring.userData.ringTex = tex; // 供行星 shader 取樣 alpha
  ring.receiveShadow = true;
  ring.userData.texUrl = url;
}
// 衛星貼圖升級。兩種映射模式:
//   'cyl'  = 真等距圓柱全球地圖 (NASA PIA03781), 直接貼球面。
//   'disc' = 來源是 NASA 的【正射圓盤鑲嵌】(球面視角), 直接貼球面會嚴重變形,
//            鏡像拼接則會在極區產生十字假影。正確做法是【逆正射投影展開】:
//            對每個輸出經緯度, 反投影回圓盤座標取樣 (近半球); 遠半球無資料,
//            以經度鏡像補足使接縫連續。來源與轉換在 README 如實標註。
// 極區平滑: 等距圓柱貼圖的極列是一條被拉伸的線, 從極向看會收斂成放射狀
// 條輻 (幾何上正確, 但視覺上是噪訊)。標準做法: 載入時把極區若干列
// 向極點平均色收收, 消除拉伸條輻而保留中緯度細節。
function smoothPoles(cv){
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const k = Math.max(4, Math.round(H * 0.07));
  for (const top of [true, false]){
    const rows = top ? k : k;
    // 極點平均色: 取最靠極的 2 列平均
    const d0 = g.getImageData(0, top ? 0 : H - 2, W, 2).data;
    let r = 0, gg = 0, bb = 0;
    for (let i = 0; i < d0.length; i += 4){ r += d0[i]; gg += d0[i+1]; bb += d0[i+2]; }
    const n = d0.length / 4;
    r /= n; gg /= n; bb /= n;
    for (let j = 0; j < rows; j++){
      const y = top ? j : H - 1 - j;
      const w = j / rows;                       // 0 在極點 → 1 在帶邊
      const d = g.getImageData(0, y, W, 1);
      for (let i = 0; i < d.data.length; i += 4){
        d.data[i]   = d.data[i]   * w + r  * (1 - w);
        d.data[i+1] = d.data[i+1] * w + gg * (1 - w);
        d.data[i+2] = d.data[i+2] * w + bb * (1 - w);
      }
      g.putImageData(d, 0, y);
    }
  }
  return cv;
}
function discToEquirect(img){
  const W = 1024, H = 512;
  const src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
  const sg = src.getContext('2d'); sg.drawImage(img, 0, 0);
  const sd = sg.getImageData(0, 0, img.width, img.height).data;
  // 偵測圓盤: 來源常是【部分照明】的圓盤鑲嵌 (夜側為黑), 照亮區的 bbox
  // 會偏離真實圓盤中心 → 展開出黑色楔形假影。正確做法是對明暗邊界 (limb)
  // 做圓擬合 (Kasa 最小平方法): 從照亮弧還原真實圓心與半徑。
  const edgeX = [], edgeY = [];
  const lum = (x, y) => { const i = (y * img.width + x) * 4; return sd[i] + sd[i+1] + sd[i+2]; };
  for (let y = 1; y < img.height - 1; y += 2) for (let x = 1; x < img.width - 1; x += 2){
    if (lum(x, y) > 60 && (lum(x-1,y) <= 60 || lum(x+1,y) <= 60 || lum(x,y-1) <= 60 || lum(x,y+1) <= 60)){
      edgeX.push(x); edgeY.push(y);
    }
  }
  if (edgeX.length < 50){ return img; }              // 偵測失敗: 退回原圖, 不崩潰
  // 修剪式 Kasa 圓擬合: 邊界點同時含 limb (圓) 與終端線 (橢圓弧), 後者會污染擬合。
  // limb 點彼此自洽於同一圓, 終端線點則否 ⇒ 迭代保留殘差最小的 60% 收斂到 limb。
  let idx = edgeX.map((_, i) => i);
  let cx = 0, cy = 0, R = 1;
  for (let iter = 0; iter < 6; iter++){
    let Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sz=0,Sxz=0,Syz=0; const N=idx.length;
    if (N < 20) break;
    for (const i of idx){
      const x=edgeX[i], y=edgeY[i], z=x*x+y*y;
      Sx+=x; Sy+=y; Sxx+=x*x; Syy+=y*y; Sxy+=x*y; Sz+=z; Sxz+=x*z; Syz+=y*z;
    }
    const A=[[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,N]], B=[-Sxz,-Syz,-Sz];
    const det = A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1]) - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0]) + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
    if (Math.abs(det) < 1e-9) break;
    const D = (B[0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1]) - A[0][1]*(B[1]*A[2][2]-A[1][2]*B[2]) + A[0][2]*(B[1]*A[2][1]-A[1][1]*B[2])) / det;
    const E = (A[0][0]*(B[1]*A[2][2]-A[1][2]*B[2]) - B[0]*(A[1][0]*A[2][2]-A[1][2]*A[2][0]) + A[0][2]*(A[1][0]*B[2]-B[1]*A[2][0])) / det;
    const Ff = (A[0][0]*(A[1][1]*B[2]-B[1]*A[2][1]) - A[0][1]*(A[1][0]*B[2]-B[1]*A[2][0]) + B[0]*(A[1][0]*A[2][1]-A[1][1]*A[2][0])) / det;
    cx = -D/2; cy = -E/2;
    R = Math.sqrt(Math.max(1, D*D/4 + E*E/4 - Ff));
    // 殘差修剪
    const res = idx.map(i => Math.abs(Math.hypot(edgeX[i]-cx, edgeY[i]-cy) - R));
    const sorted = [...res].sort((a,b)=>a-b);
    const thr = sorted[Math.floor(sorted.length * 0.6)];
    idx = idx.filter((_, k) => res[k] <= thr);
  }
  R *= 0.98;                                          // 限縮避免取到圓盤外黑邊
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const out = g.createImageData(W, H), od = out.data;
  // 照亮區平均色: 夜側取樣的後備值 (避免把照明烘進反照率)
  let lr=0, lg=0, lb=0, ln=0;
  for (let i = 0; i < sd.length; i += 16){
    const L = sd[i] + sd[i+1] + sd[i+2];
    if (L > 150){ lr += sd[i]; lg += sd[i+1]; lb += sd[i+2]; ln++; }
  }
  const avgR = ln ? lr/ln : 128, avgG = ln ? lg/ln : 128, avgB = ln ? lb/ln : 128;
  // 夜側門檻用【相對值】: 來源的夜側常是暗綠/暗褐而非純黑 (Io 即如此),
  // 固定門檻 45 會把夜側當成有效資料, 展開出暗色楔形。
  const nightThr = Math.max(45, (avgR + avgG + avgB) * 0.30);
  const samp = (lam, sgn, lat) => {
    const sx = Math.round(cx + Math.cos(lat) * Math.sin(lam) * R * sgn);
    const sy = Math.round(cy - Math.sin(lat) * R);
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) return null;
    const i = (sy * img.width + sx) * 4;
    return (sd[i] + sd[i+1] + sd[i+2] > nightThr) ? i : null;   // 夜側/缺資料
  };
  for (let py = 0; py < H; py++){
    const lat = (0.5 - (py + 0.5) / H) * Math.PI;
    for (let px = 0; px < W; px++){
      const lon = ((px + 0.5) / W - 0.5) * TWO_PI;          // -π..π
      const sgn = lon >= 0 ? 1 : -1;
      const al = Math.abs(lon);
      const lam = al > Math.PI / 2 ? Math.PI - al : al;      // 遠半球折回, 保持接縫連續
      let i = samp(lam, sgn, lat);
      if (i === null) i = samp(lam, -sgn, lat);              // 夜側 → 鏡像到另一側
      const di = (py * W + px) * 4;
      if (i !== null){ od[di] = sd[i]; od[di+1] = sd[i+1]; od[di+2] = sd[i+2]; }
      else { od[di] = avgR; od[di+1] = avgG; od[di+2] = avgB; }  // 仍無資料 → 平均色
      od[di+3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return cv;
}
async function upgradeMoonTex(mesh, mi, gen){
  const md = MOONS[mi];
  const url = TEX_BASE + md.map + '.jpg';
  const T = mesh.userData;
  if (T.texUrl === url) return;
  const t = await loadTex(url, true);
  if (gen !== texGen){ t && t.dispose(); return; }
  if (!t) return;
  let tex = t;
  if (md.mapMode === 'disc'){
    const cv = smoothPoles(discToEquirect(t.image));
    t.dispose();
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAX_ANISO;
  } else {
    // 真等距圓柱同樣需要極區平滑 (PIA03781 的極列也是拉伸的)
    const cv = document.createElement('canvas');
    cv.width = t.image.width; cv.height = t.image.height;
    cv.getContext('2d').drawImage(t.image, 0, 0);
    smoothPoles(cv);
    t.dispose();
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAX_ANISO;
  }
  const mat = mesh.material;
  if (mat.map) mat.map.dispose();
  mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
  T.texUrl = url;
}
// 冥王星–凱龍雙體伴星 (Charon): 單解析度等距圓柱地圖 (gen-pluto-textures.mjs 產製),
// 與月球同一處理 — 極區平滑消除拉伸條輻, 再由高程導出法線貼圖 (晨昏線地形陰影)。
async function upgradeBinary(cMesh, p, gen){
  const bd = p.binary;
  const url = TEX_BASE + bd.map + '.jpg';
  const T = cMesh.userData;
  if (T.texUrl === url) return;
  const t = await loadTex(url, true);
  if (gen !== texGen){ t && t.dispose(); return; }
  if (!t) return;
  const cv = document.createElement('canvas');
  cv.width = t.image.width; cv.height = t.image.height;
  cv.getContext('2d').drawImage(t.image, 0, 0);
  smoothPoles(cv);
  t.dispose();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = MAX_ANISO;
  const mat = cMesh.material;
  if (mat.map) mat.map.dispose();
  if (mat.normalMap) mat.normalMap.dispose();
  mat.map = tex; mat.color.set(0xffffff);
  mat.normalMap = normalFromHeight(tex.image, 3.0);
  mat.normalScale.set(0.8, 0.8); mat.needsUpdate = true;
  T.texUrl = url;
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
    for (const mo of (o.moons || [])) jobs.push(mo.upgrade(gen));
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
  // 地球: 夜燈 patch; 木星: 差速自轉 patch (兩者互斥, 同一顆行星不會同時需要)
  const extra = p.name === '地球' ? injectNightLights : p.name === '木星' ? injectDifferentialRotation : null;
  applyWrapLighting(mat, wrapV, extra);
  if (p.ring) applyRingShadow(mat, p, obj);   // 土星: 解析式環影 (取代鋸齒 shadow map)
  mat.envMapIntensity = (p.type === 'gas' || p.type === 'ice') ? 0.25 : p.name === '地球' ? 0.35 : 0.15;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.rDisp, 64, 64), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.focusIndex = idx;
  // 大氣/衛星的掛點: 一般行星是 obj (原點=行星心); 雙體系統改掛在冥王星本體的
  // holder 上 (原點=質心, 冥王星偏離質心 dP), 否則大氣球會與冥王星錯位。
  let atmoParent = obj;
  let bin = null;
  if (p.binary) {
    // 冥王星–凱龍雙體: 兩者繞【共同質心】互繞, 質心落在冥王星表面之外。
    //   q   = M_charon / M_pluto = 0.1217
    //   sep = 兩者中心距 (顯示單位) = rDisp × sepF (sepF=16.5 為真實比例 19640/1188)
    //   dP  = sep·q/(1+q)  (冥王星→質心),  dC = sep·1/(1+q)  (凱龍→質心)
    // pivot 旋轉 = 公轉; 兩球在 pivot 內不自轉 ⇒ 潮汐互鎖 (同一面永遠朝向對方)。
    const bd = p.binary, q = bd.massRatio;
    const sep = p.rDisp * bd.sepF;
    const dP = sep * q / (1 + q), dC = sep / (1 + q);
    const pivot = new THREE.Group();
    obj.add(pivot);
    const plutoHolder = new THREE.Group(); plutoHolder.position.x = -dP; pivot.add(plutoHolder);
    plutoHolder.add(mesh);
    atmoParent = plutoHolder;
    const cCol = bd.color;
    const cMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cCol[0]/255, cCol[1]/255, cCol[2]/255), roughness: 1.0 });
    applyWrapLighting(cMat, 0.08, null);
    cMat.envMapIntensity = 0.12;
    const cMesh = new THREE.Mesh(new THREE.SphereGeometry(p.rDisp * (bd.radiusKm / p.radiusKm), 48, 48), cMat);
    cMesh.castShadow = true; cMesh.receiveShadow = true;
    const charonHolder = new THREE.Group(); charonHolder.position.x = dC; charonHolder.add(cMesh);
    pivot.add(charonHolder);
    // 質心連線 + 質心標記: 直觀顯示「質心不在冥王星內」 (教學價值)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-dP, 0, 0), new THREE.Vector3(dC, 0, 0) ]);
    pivot.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.4 })));
    const bary = new THREE.Mesh(new THREE.SphereGeometry(Math.max(p.rDisp * 0.12, 0.05), 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    pivot.add(bary);
    p._upgC = upgradeBinary(cMesh, p, texGen);
    bin = { pivot, plutoHolder, charonHolder, mesh, cMesh, cMat, sep, dP, dC, q,
            periodYr: bd.periodD / 365.25, angle: 0, bary };
  } else {
    obj.add(mesh);
  }
  clickable.push(mesh);
  // 隱形點擊代理球: 半徑至少 9.5 (預設視距 ~950 下約 10px), 讓小行星容易點中
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(Math.max(p.rDisp * 2.5, 9.5), 16, 12), clickProxyMat);
  proxy.visible = false;
  proxy.userData.focusIndex = idx;
  obj.add(proxy);
  clickable.push(proxy);
  p._upg = upgradePlanet(p, mat, texGen); // 非同步載入真實 NASA 貼圖 (降級則程序化)

  // 地球: 雲層 + 藍色大氣; 金星: 黃色大氣
  // 大氣一律掛在 atmoParent (=obj, 雙體系統則為冥王星本體 holder) 並以其為
  // ownerObj: addAtmosphere 每幀取 ownerObj 的世界座標算視空間太陽方向,
  // 掛錯父節點會使大氣與行星球體錯位 (質心≠冥王星心)。
  if (p.name === '地球') {
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(p.rDisp * 1.012, 64, 64),
      new THREE.MeshStandardMaterial({ map: genClouds(p), transparent: true, depthWrite: false, roughness: 1, metalness: 0, opacity: 0.9, envMapIntensity: 0.3, alphaTest: 0.35 })
    );
    obj.add(clouds); p._clouds = clouds;
    clouds.castShadow = true; // alphaTest>0 -> r160 自動以 map/alphaMap 生成 distance 變體, 雲影不再是實心球
    // 地球: 氮氧大氣, 強瑞利散射 (tau=0.9) => 日落時 limb 自然轉橘紅
    atmoParent.add(addAtmosphere(p.rDisp * 1.03, 0x3a7bd5, 2.5, atmoParent, 0.9));
    // 夜面閃電: 掛在雲層 (隨雲自轉) 上, sprite 池循環重用
    p._lightning = makeLightning(clouds, p.rDisp * 1.012);
    earthLightning = p._lightning;
  } else if (p.name === '金星') {
    // 金星: 極厚 CO2 大氣, 瑞利散射更強; 基底已偏黃, tau=0.7 把掠射 limb 推向橘紅
    atmoParent.add(addAtmosphere(p.rDisp * 1.05, 0xd9b06a, 2.5, atmoParent, 0.7));
  } else if (p.name === '火星') {
    atmoParent.add(addAtmosphere(p.rDisp * 1.02, 0xd88a5a, 3.5, atmoParent));
  } else if (p.name === '木星') {
    atmoParent.add(addAtmosphere(p.rDisp * 1.03, 0xd8bd93, 2.8, atmoParent));
  } else if (p.name === '土星') {
    atmoParent.add(addAtmosphere(p.rDisp * 1.03, 0xe6d8ab, 2.8, atmoParent));
  } else if (p.name === '天王星') {
    atmoParent.add(addAtmosphere(p.rDisp * 1.04, 0xa8ecf2, 2.8, atmoParent));
  } else if (p.name === '海王星') {
    atmoParent.add(addAtmosphere(p.rDisp * 1.04, 0x4f74ff, 2.8, atmoParent));
  } else if (p.name === '冥王星') {
    // New Horizons 實測: 冥王星有一層稀薄氮氣大氣, 逆光時可見【藍色霾層】。
    // 取極淡的藍白 Fresnel, power 較高 (3.8) 讓它只在極邊緣浮現。
    atmoParent.add(addAtmosphere(p.rDisp * 1.09, 0x9fc4ff, 3.8, atmoParent));
  }

  // 土星環
  let ring = null;
  if (p.ring) {
    // 視角相關亮度的共用 uniform 物件: 程序化環 (ShaderMaterial) 與真實環
    // (upgradeRing 換上的 MeshStandardMaterial) 引用【同一個】物件, 故每幀
    // 只需寫 p._ringBrightU.value 一次, 兩種材質同步。物理見 updatePlanet。
    p._ringBrightU = { value: 1.0 };
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
        uniforms: { uRingBright: p._ringBrightU },   // 視角相關亮度 (見下)
        vertexShader: `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `
          varying vec2 vP; uniform float uRingBright;
          void main(){
            float r=length(vP); float t=(r-${inner.toFixed(2)})/(${(outer-inner).toFixed(2)});
            float bands=0.5+0.5*sin(t*60.0);
            float a=smoothstep(0.0,0.06,t)*(1.0-smoothstep(0.82,1.0,t))*(0.35+0.65*bands);
            // 卡西尼縫
            a*= smoothstep(0.02,0.04,abs(t-0.55));
            vec3 col=mix(vec3(0.85,0.78,0.6), vec3(0.6,0.52,0.4), bands);
            gl_FragColor=vec4(col*uRingBright, a);   // 亮度隨相位角 (衝日增亮/前向散射)
          }`,
      })
    );
    ring.rotation.x = -Math.PI / 2; // 置於赤道面
    ring.userData.brightU = p._ringBrightU;   // 供 upgradeRing 換上的 MeshStandardMaterial 引用同一 uniform
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

  // 伽利略衛星 / 土星衛星: 真實軌道週期比 ⇒ 拉普拉斯共振自動成立
  // (Io:Europa:Ganymede = 1.769:3.551:7.155 天 ≈ 4:2:1)
  // 顯示半徑/軌道為壓縮值 (與行星距離壓縮同一哲學), 真實比例存於 radiusKm/aKm。
  // 潮汐鎖定: 衛星在 pivot 框架內不自轉 ⇒ 同一面永遠朝向宿主。
  const moons = [];
  for (let mi = 0; mi < MOONS.length; mi++){
    const md = MOONS[mi];
    if (md.host !== p.name) continue;
    const mMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(md.color[0]/255, md.color[1]/255, md.color[2]/255), roughness: 1.0 });
    applyWrapLighting(mMat, 0.08, null);
    mMat.envMapIntensity = 0.12;
    const mMesh = new THREE.Mesh(new THREE.SphereGeometry(p.rDisp * md.rF, 48, 48), mMat);
    mMesh.castShadow = true; mMesh.receiveShadow = true;
    mMesh.userData.mi = mi;
    const pivot = new THREE.Group();
    mMesh.position.x = p.rDisp * md.aF;
    pivot.add(mMesh);
    obj.add(pivot);
    const mo = { data: md, mesh: mMesh, pivot, mi,
                 periodYr: md.periodD / 365.25, M0: (mi * 1.7) % TWO_PI };
    // Enceladus 南極噴羽: 真實物理 —— 潮汐加熱驅動的水冰噴流, 餵養土星 E 環
    if (md.plume){
      const N = 220, pos = new Float32Array(N * 3), seed = new Float32Array(N);
      for (let i = 0; i < N; i++){
        const th = Math.random() * TWO_PI, rr = Math.random() * 0.5;
        pos[i*3] = Math.cos(th) * rr; pos[i*3+1] = -1 - Math.random() * 3.2; pos[i*3+2] = Math.sin(th) * rr;
        seed[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const pm = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSize: { value: p.rDisp * md.rF * 26 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aSeed; uniform float uTime; uniform float uSize; varying float vA;
          void main(){
            float t = fract(aSeed + uTime * 0.35);          // 每顆粒自己的噴發週期
            vec3 p = position; p.y *= t;                     // 沿南極軸向外噴
            p.xz *= (0.4 + t * 1.4);                         // 錐形擴散
            vA = (1.0 - t) * smoothstep(0.0, 0.15, t);       // 出生淡入、消散淡出
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * (0.35 + 0.65 * t) / max(-mv.z, 0.1);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying float vA;
          void main(){
            vec2 q = gl_PointCoord - 0.5;
            float d = length(q);
            float a = smoothstep(0.5, 0.05, d) * vA * 0.5;
            gl_FragColor = vec4(vec3(0.85, 0.92, 1.0), a);
          }`,
      });
      const pts = new THREE.Points(g, pm);
      pts.scale.setScalar(p.rDisp * md.rF);
      mMesh.add(pts);
      mo.plumeMat = pm;
    }
    moons.push(mo);
    mo.upg = upgradeMoonTex(mMesh, mi, texGen);
    mo.upgrade = g => upgradeMoonTex(mMesh, mi, g);
  }
  if (moons.length) p._moons = moons;

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
  // 雙體系統必須掛在冥王星本體 (atmoParent=plutoHolder) 而非 obj (質心):
  // 否則標籤會隨雙體互繞而從冥王星身上飄走。
  const div = document.createElement('div'); div.className='label'; div.textContent=pname(p.name);
  const label = new CSS2DObject(div); label.position.set(0, p.rDisp*1.6, 0); atmoParent.add(label);

  // 軸傾指示器: 必須掛在 obj (只帶 tilt, 不自轉也不繞質心)。
  // 對雙體冥王星不能掛 atmoParent(=plutoHolder): 它會隨互繞 pivot 旋轉,
  // 軸會跟著搖擺。掛 obj 時軸線固定為系統自轉軸, 圓盤在質心 (= 系統旋轉軸通過點)。
  const axis = makeAxisIndicator(p, p.rDisp);
  obj.add(axis);
  finishAxisIndicator(axis, obj, p.rDisp);

  planetObjs.push({ data:p, obj, mesh, orbitBase:m, orbitLine, labelEl:div, label,
                    ring: p.ring ? ring : null, moon: p.moon ? moon : null,
                    moons: p._moons || [], bin, axis });
  if (bin) p._binR = bin.dC + p.rDisp * (p.binary.radiusKm / p.radiusKm) + 0.3;  // 聚焦時需涵蓋凱龍軌道
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

// =============================================================================
//  蟲洞 (Ellis–Bronnikov / Ellis drainhole)
//
//  與黑洞的關鍵物理差異 (全部經獨立數值驗證, 見下):
//  1. 零 ADM 質量 ⇒ 遠場偏折無 1/b 項。對零測地線積分得領先項
//     α(b) = (π/4)(a/b)² (次領先 O(a⁴/b⁴)), 對比 Schwarzschild 的 α=4M/b。
//     數值積分在 b/a∈[5,12] 與 (π/4)(a/b)² 比值≈1 (大 b 的漂移是截斷誤差)。
//  2. 無事件視界、無光子球、無陰影: b≤a 時徑向方程無轉折點, 光線【穿越喉】
//     到另一側而非被捕獲 ⇒ 喉在畫面上是一個透視窗, 不是黑洞。
//  3. 愛因斯坦環: 透鏡方程 θ·D = α·D_LS 代入 α∝1/θ² 得 θ³ = 常數,
//     與黑洞的 θ² 標度不同 (arXiv 2607.02889 以此區分蟲洞與黑洞)。
//     故只畫【一個】細愛因斯坦環, 不畫光子環、不畫陰影。
//  4. 喉需要負能量 (違反零能量條件) 才能撐開 —— 面板如實標註, 不假裝已可行。
// =============================================================================
const WH = { R: 560, incl: -14*DEG, throatR: 22, tilt: 25*DEG,
             angle: 0, periodYr: 900, group: null, rimMat: null, label: null,
             pos: new THREE.Vector3() };
let whOn = true, whSmooth = 0;

function buildWormhole(){
  const g = new THREE.Group();
  // 喉緣: 附加混合的淡藍環, 給出深度線索 (透視窗本身由後處理著色器畫)
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(WH.throatR, WH.throatR * 0.06, 16, 160),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false })
  );
  g.add(rim);
  WH.rimMat = rim.material;
  // 不可見但可點: 讓蟲洞能像行星/黑洞一樣被點擊聚焦
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(WH.throatR, 24, 24),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
  );
  hit.userData.focusIndex = -4;
  clickable.push(hit);
  g.add(hit);
  const div = document.createElement('div'); div.className = 'label wh'; div.textContent = t('label.wh');
  const label = new CSS2DObject(div); label.position.set(0, WH.throatR * 2.0, 0); g.add(label);
  WH.label = label;
  g.rotation.x = WH.tilt;
  scene.add(g);
  WH.group = g;
}
buildWormhole();

// =============================================================================
//  彗星 (雙尾: 離子尾 + 塵尾)
//
//  軌道: 高離心率橢圓 (e=0.967, 類哈雷), 真實克卜勒方程求解 ⇒ 近日點附近
//  明顯加速 (面積速度守恆), 這是彗星動力學最可視化的特徵。
//
//  兩尾的物理不同, 方向也不同:
//  · 離子尾 (藍): 受太陽風磁場拖曳, 幾乎精確背離太陽 (輻射向), 窄而直。
//  · 塵尾 (黃白): 塵粒受輻射壓與初速影響, 沿軌跡彎曲落後, 寬而彎。
//  兩者皆以 GPU 粒子 (additive) 實作, 不新增貼圖。
// =============================================================================
const COMET = { a: 17.8, e: 0.967, incl: 24 * DEG, periodYr: 75.3,
                group: null, pos: new THREE.Vector3(), M0: 2.1 };
let cometTailMat = null, cometDustMat = null;

function buildComet(){
  const g = new THREE.Group();
  // 彗核 + 彗髮 (coma)
  const nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 1.0 })
  );
  nucleus.userData.focusIndex = -5;
  clickable.push(nucleus);
  g.add(nucleus);
  const coma = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0xbfe8ff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  coma.scale.set(9, 9, 1);
  g.add(coma);
  COMET.coma = coma;
  const div = document.createElement('div'); div.className = 'label comet'; div.textContent = t('label.comet');
  const label = new CSS2DObject(div); label.position.set(0, 4.5, 0); g.add(label);
  COMET.label = label;

  // 尾: 兩組 GPU 粒子。粒子在「尾向」局部座標中生成, 每幀由 CPU 更新群組朝向,
  // 使離子尾指向背日、塵尾落後軌跡 —— 方向由物理決定, 不是固定裝飾。
  const mkTail = (N, spread, len, col, curve) => {
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++){
      const t = Math.random();                       // 沿尾的參數 0..1
      const ang = Math.random() * TWO_PI, rr = Math.random() * spread * (0.25 + t);
      pos[i*3]   = Math.cos(ang) * rr + curve * t * t;  // 塵尾彎曲項
      pos[i*3+1] = (Math.random() - 0.5) * spread * 0.6;
      pos[i*3+2] = -t * len;                            // 尾朝 -Z (背日)
      seed[i] = t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 3.2 }, uCol: { value: new THREE.Color(col) }, uOp: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSeed; uniform float uSize; varying float vA;
        void main(){
          vA = (1.0 - aSeed) * 0.85;                  // 尾根亮、尾尖淡
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (0.5 + aSeed * 1.6) * (140.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uCol; uniform float uOp; varying float vA;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.06, length(q)) * vA * uOp;
          gl_FragColor = vec4(uCol, a);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    g.add(pts);
    return mat;
  };
  cometTailMat = mkTail(900, 0.5, 26, 0x59b7ff, 0.0);    // 離子尾: 直、藍
  cometDustMat = mkTail(700, 1.6, 18, 0xd8c9a0, 6.0);    // 塵尾: 彎、黃白
  scene.add(g);
  COMET.group = g;
}
buildComet();

// 彗星軌道位置: 真實克卜勒求解 (高 e 時迭代收斂仍穩)
const _cSun = new THREE.Vector3(), _cVel = new THREE.Vector3(), _cTail = new THREE.Vector3();
const _drQ2 = new THREE.Quaternion();
function cometStep(){
  const M = COMET.M0 + TWO_PI * simTime / COMET.periodYr;
  const E = solveKepler(M, COMET.e);
  const aD = distScale(COMET.a);
  const xv = aD * (Math.cos(E) - COMET.e);
  const yv = aD * Math.sqrt(1 - COMET.e * COMET.e) * Math.sin(E);
  // 傾斜軌道面
  COMET.pos.set(xv, yv * Math.sin(COMET.incl), yv * Math.cos(COMET.incl));
  COMET.group.position.copy(COMET.pos);
  // 尾向: 離子尾精確背日; 塵尾落後軌跡切線
  _cSun.copy(COMET.pos).normalize();                 // 背日方向
  // 場景距離 → AU: distScale(a)=a^0.65×DIST_K 的反函數。
  // 不可直接用場景單位比門檻 (近日點場景距離約 46, 遠大於 AU 尺度的 3.2,
  // 會使昇華活動度恒為 0 → 尾永遠不出現; 回歸測試抓到)。
  const rAU = Math.pow(COMET.pos.length() / DIST_K, 1 / 0.65);
  const act = Math.max(0, Math.min(1, (3.2 - rAU) / 2.2));   // 近日點才有尾 (昇華驅動)
  cometTailMat.uniforms.uOp.value = act;
  cometDustMat.uniforms.uOp.value = act * 0.8;
  COMET.coma.material.opacity = 0.25 + act * 0.5;
  // 離子尾朝向背日 (群組 -Z 對齊背日方向)
  _cTail.copy(_cSun);
  COMET.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _cTail);
  // 塵尾: 在背日基礎上向軌跡切線偏轉 (落後)。塵尾是群組的子節點,
  // 其四元數是【局部】座標, 必須先把世界方向換算進群組框架。
  _cVel.set(-Math.sin(E), Math.cos(E) * Math.sqrt(1 - COMET.e * COMET.e), 0).normalize();
  const dustDir = _cTail.clone().multiplyScalar(0.72).addScaledVector(_cVel, 0.55).normalize();
  _drQ.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dustDir);
  _drQ2.copy(COMET.group.quaternion).invert().multiply(_drQ);
  COMET.group.children[3].quaternion.copy(_drQ2);   // children[3] = 塵尾 (0核 1彗髮 2離子 3塵)
}

// =============================================================================
//  小行星帶 + 古柏帶 (GPU 粒子場)
//
//  為什麼用 gl.POINTS 而不是 InstancedMesh:
//    帶內每顆天體在畫面上都是次像素點, 幾何細節完全浪費; Points 一顆一個
//    頂點, 比 instancing 省一個數量級的記憶體與頻寬。位置【全部在頂點著色器
//    內以克卜勒方程即時求解】, CPU 每幀只寫一個 uTime —— 零 per-particle CPU 成本。
//
//  真實物理:
//    · 半主軸分佈不是均勻的, 而是按真實直方圖: 主帶峰值 ~2.7–3.0 AU, 並在
//      木星平均運動共振處鑿出【柯克伍德空隙】(Kirkwood gaps):
//        3:1 @ 2.50 AU · 5:2 @ 2.83 AU · 7:3 @ 2.96 AU · 2:1 @ 3.28 AU
//      共振位置 a = a_J (q/p)^(2/3) (克卜勒第三定律), 已在 Python 側數值確認。
//      另含 Cybele (3.4) 與 Hilda 3:2 (3.97) 兩個真實族群峰。
//    · 古柏帶: 30–50 AU, 含 Plutino 2:3 共振峰 @ 39.4 AU (冥王星正在此) 與
//      1:2 @ 47.8 AU, 50 AU 後密度驟降 (Kuiper cliff)。
//    · 每顆有自己的 e / 傾角 / 三個定向角 / 相位 ⇒ 差速旋轉 (內快外慢),
//      這正是「帶」而非「剛性環」的視覺特徵。
//
//  亮度壓在 bloom threshold(2.0) 以下 (與星點同一戒律): 附加混合 + 低 alpha,
//    密帶重疊累積成霧狀環帶, 單顆仍很暗, 不會被 UnrealBloomPass 燒成方塊。
// =============================================================================
const beltMats = [];                 // 兩條帶的材質 (共用 uTime/uOpacity 語意, 分別 fade)
let beltOn = true, beltGroup = null;
const BELT_RNG = () => { let s = 0x2f6e2b1 >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const _beltQ = new THREE.Quaternion(), _beltM4 = new THREE.Matrix4(),
      _beltRz1 = new THREE.Matrix4(), _beltRx = new THREE.Matrix4(), _beltRz2 = new THREE.Matrix4();
const smoothB = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 主帶密度 (含柯克伍德空隙)。a: AU。回傳相對密度 (未正規化)。
function beltDensityMain(a){
  let d;
  if (a < 2.06) d = 0.12 * smoothB(1.78, 2.06, a);          // 內緣急升 (Hungaria 稀少)
  else d = Math.exp(-0.5 * Math.pow((a - 2.72) / 0.40, 2));  // 主帶高斯
  d += 0.28 * Math.exp(-0.5 * Math.pow((a - 3.40) / 0.07, 2));  // Cybele
  d += 0.30 * Math.exp(-0.5 * Math.pow((a - 3.97) / 0.09, 2));  // Hilda 3:2
  // 柯克伍德空隙: 共振位置挖掉 (深度 depth, 寬度 w)
  const gaps = [[2.0652,0.025,0.75],[2.5018,0.022,0.95],[2.8252,0.016,0.85],
                [2.9581,0.014,0.80],[3.2783,0.022,0.92]];
  for (const [ga, w, dp] of gaps) d *= 1 - dp * Math.exp(-0.5 * Math.pow((a - ga) / w, 2));
  if (a > 3.3 && a < 3.7) d *= 0.35;                        // 主帶與 Hilda 之間的空缺
  return Math.max(0, d);
}
// 古柏帶密度: 冷古典族群 + Plutino 2:3 + 1:2 共振, 50 AU 後驟降。
function beltDensityKuiper(a){
  let d = 0.55 * Math.exp(-0.5 * Math.pow((a - 43.5) / 3.2, 2));   // 冷古典主體
  d += 0.9 * Math.exp(-0.5 * Math.pow((a - 39.4) / 0.5, 2));       // Plutino 2:3 (冥王星)
  d += 0.5 * Math.exp(-0.5 * Math.pow((a - 47.8) / 0.6, 2));       // 1:2 共振
  d *= smoothB(30.0, 32.0, a) * (1 - smoothB(48.0, 51.0, a));      // 內外緣
  return Math.max(0, d);
}
function sampleA(rng, densFn, amin, amax, maxD){
  for (let i = 0; i < 400; i++){
    const a = amin + rng() * (amax - amin);
    if (rng() < densFn(a) / maxD) return a;
  }
  return amin + rng() * (amax - amin);   // 保底 (理論上到不了)
}
function maxDensity(densFn, amin, amax){
  let mx = 0;
  for (let i = 0; i <= 2000; i++) mx = Math.max(mx, densFn(amin + (amax - amin) * i / 2000));
  return mx;
}
// 依軌道要素產生一條帶的幾何 + 材質。cfg: {N, densFn, amin, amax, eMean, inclDeg, colorFn, sizeMin/Max}
function buildBelt(cfg){
  const rng = BELT_RNG();
  const N = cfg.N;
  const maxD = maxDensity(cfg.densFn, cfg.amin, cfg.amax);
  // position 只是 three 需要的佔位屬性 (真實位置在著色器內算);
  // 故必須手動設 boundingSphere 涵蓋整條帶, 否則 three 以 position 算出半徑 0
  // 的包圍球 -> 原點不在視野時整條帶被錯誤剔除。
  const pos = new Float32Array(N * 3);                 // 全 0
  const aE = new Float32Array(N), eE = new Float32Array(N);
  const nE = new Float32Array(N), mE = new Float32Array(N);
  const qE = new Float32Array(N * 4), cE = new Float32Array(N * 3), sE = new Float32Array(N);
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v); };
  let maxSceneR = 0;
  for (let i = 0; i < N; i++){
    const aAU = sampleA(rng, cfg.densFn, cfg.amin, cfg.amax, maxD);
    const aS = distScale(aAU);
    maxSceneR = Math.max(maxSceneR, aS * 1.3);
    const e = Math.min(0.42, Math.max(0, Math.abs(gauss()) * cfg.eMean));
    const incl = Math.min(cfg.inclDeg, Math.abs(gauss()) * cfg.inclDeg * 0.45) * DEG;
    const node = rng() * TWO_PI, peri = rng() * TWO_PI;
    aE[i] = aS; eE[i] = e;
    nE[i] = TWO_PI / Math.pow(aAU, 1.5);              // 平均運動 = 2π / 週期(年), 週期 = a^1.5
    mE[i] = rng() * TWO_PI;
    // 定向: Rz(node)·Rx(incl)·Rz(peri), 與行星 orbitBase 同一慣例 -> 轉成四元數存
    _beltRz1.makeRotationZ(peri); _beltRx.makeRotationX(incl); _beltRz2.makeRotationZ(node);
    _beltM4.multiplyMatrices(_beltRz2, _beltRx); _beltM4.multiply(_beltRz1);
    _beltQ.setFromRotationMatrix(_beltM4);
    qE[i*4] = _beltQ.x; qE[i*4+1] = _beltQ.y; qE[i*4+2] = _beltQ.z; qE[i*4+3] = _beltQ.w;
    const col = cfg.colorFn(aAU, rng);
    cE[i*3] = col[0]; cE[i*3+1] = col[1]; cE[i*3+2] = col[2];
    sE[i] = cfg.sizeMin + rng() * (cfg.sizeMax - cfg.sizeMin);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aElem', new THREE.BufferAttribute(aE, 1));
  g.setAttribute('eElem', new THREE.BufferAttribute(eE, 1));
  g.setAttribute('nElem', new THREE.BufferAttribute(nE, 1));
  g.setAttribute('mElem', new THREE.BufferAttribute(mE, 1));
  g.setAttribute('qElem', new THREE.BufferAttribute(qE, 4));
  g.setAttribute('cElem', new THREE.BufferAttribute(cE, 3));
  g.setAttribute('sElem', new THREE.BufferAttribute(sE, 1));
  // 著色器內算位置 -> three 無從得知真實範圍, 手動給涵蓋整條帶的包圍球
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), maxSceneR);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aElem, eElem, nElem, mElem, sElem;
      attribute vec4 qElem; attribute vec3 cElem;
      uniform float uTime, uPixel; varying vec3 vCol;
      float solveKepler(float M, float e){
        float E = M;
        for (int i = 0; i < 4; i++){ float f = E - e*sin(E) - M; E -= f / (1.0 - e*cos(E)); }
        return E;
      }
      vec3 qrot(vec4 q, vec3 v){ return v + 2.0*cross(q.xyz, cross(q.xyz, v) + q.w*v); }
      void main(){
        float M = mElem + nElem * uTime;
        float E = solveKepler(M, eElem);
        float xv = aElem * (cos(E) - eElem);
        float yv = aElem * sqrt(1.0 - eElem*eElem) * sin(E);
        vec3 p = qrot(qElem, vec3(xv, yv, 0.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vCol = cElem;
        float sz = sElem * uPixel * (200.0 / max(-mv.z, 25.0));
        gl_PointSize = clamp(sz, 0.7, 5.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity; varying vec3 vCol;
      void main(){
        vec2 q = gl_PointCoord - 0.5; float d = length(q);
        float a = smoothstep(0.5, 0.08, d);
        gl_FragColor = vec4(vCol, a * uOpacity);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  beltMats.push(mat);
  return pts;
}
function buildBelts(){
  beltGroup = new THREE.Group();
  // 裝置分級: 行動/低核心數減半粒子, 保持流暢 (SwiftShader 軟體渲染下亦不至卡死)
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const scale = (coarse || cores <= 4) ? 0.4 : 1.0;
  // 主帶: C 型 (外, 暗碳質) -> S 型 (內, 較亮矽酸鹽) 的顏色梯度
  const mainColor = (a, rng) => {
    const tS = smoothB(2.5, 2.1, a);            // 越內越偏 S 型 (亮、偏紅褐)
    const b = 0.16 + 0.20 * tS + rng() * 0.06;
    return [b * (1.0 + 0.25 * tS), b * (0.95 + 0.05 * tS), b * (0.88 - 0.05 * tS)];
  };
  // 古柏帶: 冰冷, 略偏藍白, 稍亮
  const kuiperColor = (a, rng) => {
    const b = 0.20 + rng() * 0.10;
    return [b * 0.86, b * 0.92, b * 1.05];
  };
  const main = buildBelt({ N: Math.round(46000 * scale), densFn: beltDensityMain, amin: 1.78, amax: 4.4,
    eMean: 0.12, inclDeg: 16, colorFn: mainColor, sizeMin: 1.0, sizeMax: 2.4 });
  const kuiper = buildBelt({ N: Math.round(30000 * scale), densFn: beltDensityKuiper, amin: 30, amax: 51,
    eMean: 0.11, inclDeg: 26, colorFn: kuiperColor, sizeMin: 0.9, sizeMax: 2.0 });
  beltGroup.add(main); beltGroup.add(kuiper);
  ecliptic.add(beltGroup);
  return { main, kuiper };
}
const BELTS = buildBelts();
function beltStep(){
  for (const m of beltMats) m.uniforms.uTime.value = simTime;   // 位置全在著色器內, CPU 只推進時間
}

// =============================================================================
//  TRAPPIST-1 系統 (太陽系外, 可切換的第二個場景)
//
//  為什麼值得獨立一章: 這是已知最緊密的行星系統 —— 7 顆地球大小行星全部
//  軌道在半徑 < 0.07 AU (比水星還近), 且構成【完整的共振鏈】:
//    b:c:d:e:f:g:h 的相鄰週期比 = 8:5 · 5:3 · 3:2 · 3:2 · 4:3 · 3:2
//  (Agol et al. 2021, 實測偏差 < 1.3%; 已在 Python 側數值確認)。
//  用真實週期驅動 => 共振鏈在時間拉長後自動浮現, 不是手工對齊。
//
//  宿主是 M8V 紅矮星: Teff=2566 K (深橙紅), R=0.119 R☉ —— 只比木星大 19%。
//  行星全部【潮汐鎖定】(距離太近, 自轉=公轉), 故一面永書、一面永夜。
//  大氣: JWST (2023) 對 b 的觀測【未發現】實質大氣 => 誠實起見不畫大氣殼,
//  以裸岩/冰世界呈現 (與戴森殼「光學誠實」同一哲學: 不為了好看而假裝物理)。
//
//  尺度: 軌道半徑【線性】映射 (a × TRAP_SCALE) 以保留共振幾何; 恆星與行星半徑
//  適度誇大 (真實恆星在此尺度僅 3.7 單位, 會被內行星軌道淹沒)。
// =============================================================================
// 真實資料 (Agol et al. 2021 / NASA Exoplanet Archive): a AU, P 天, R R⊕, M M⊕, Teq K
const TRAP_STAR = { Teff: 2566, R_Rsun: 0.1192, M_Msun: 0.0898, L_Lsun: 0.000524 };
const TRAP_PLANETS = [
  { name:'b', a:0.01154, P:1.510826,  R:1.116, M:1.374, Teq:400, color:[150,120,100], type:'rocky', seed:201 },
  { name:'c', a:0.01580, P:2.421937,  R:1.097, M:1.308, Teq:342, color:[140,124,112], type:'rocky', seed:202 },
  { name:'d', a:0.02227, P:4.049219,  R:0.788, M:0.388, Teq:288, color:[120,130,140], type:'rocky', seed:203 },
  { name:'e', a:0.02925, P:6.099043,  R:0.920, M:0.692, Teq:251, color:[110,124,138], type:'rocky', seed:204 },
  { name:'f', a:0.03849, P:9.207540,  R:1.045, M:1.039, Teq:219, color:[150,158,168], type:'rocky', seed:205 },
  { name:'g', a:0.04683, P:12.352446, R:1.129, M:1.321, Teq:199, color:[168,176,186], type:'rocky', seed:206 },
  { name:'h', a:0.06189, P:18.7728,   R:0.755, M:0.326, Teq:173, color:[188,198,210], type:'rocky', seed:207 },
];
const TRAP_RESONANCE = ['8:5','5:3','3:2','3:2','4:3','3:2'];  // 相鄰週期比 (文件/說明用)
const TRAP_SCALE = 6600;          // 軌道: 場景單位 / AU (線性, 保留共振幾何)
const TRAP_STAR_R = 12;           // 恆星視覺半徑 (真實 3.7 的 ~3.3x 誇大, 否則被內軌淹沒)
const TRAP_PR = 2.6;              // 行星視覺半徑: 場景單位 / R⊕ (地球大小在此尺度太小, 需放大)
const TRAP_DAYS_PER_SEC = 2.0;    // 時間壓縮: simSpeed=1 時每秒推進的「天」數 (共振鏈要慢看)
const TRAP_CAM_HOME = new THREE.Vector3(0, 260, 640);
const TRAP_FOCUS_BASE = 100;      // 聚焦索引: 行星 = 100+i, 恆星 = 90 (避開太陽系的 0..8 與負索引)
const TRAP_STAR_FOCUS = 90;
let trapDays = 0;                 // TRAPPIST 專用模擬時間 (天), 與太陽系 simTime(年) 獨立
const trap = { group: null, star: null, starMat: null, light: null, glow: null,
               planets: [], orbitLines: [], labelEls: [], labelObjs: [], focusOpts: [], flare: 0 };

function buildTrappist(){
  const g = new THREE.Group();
  g.visible = false;
  scene.add(g);
  trap.group = g;

  // --- 紅矮星: 對流顆粒 + 耀斑 (M 矮星頻繁 flares) ---
  const [sr, sg, sb] = blackbodyRGB(TRAP_STAR.Teff);
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlare: { value: 0 }, uCol: { value: new THREE.Color(sr/255, sg/255, sb/255) } },
    vertexShader: `varying vec3 vN; varying vec2 vUv;
      void main(){ vUv=uv; vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vN; varying vec2 vUv; uniform float uTime; uniform float uFlare; uniform vec3 uCol;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
      float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.05; a*=0.5; } return v; }
      void main(){
        vec2 p = vUv * vec2(5.0, 2.5);
        float n = fbm(p + vec2(uTime*0.04, uTime*0.02));
        float n2 = fbm(p*2.2 - uTime*0.05);
        float h = n*0.65 + n2*0.35;
        // M 矮星: 深橙紅核心, 對流斑點 (granulation), 較太陽暗
        vec3 deep = uCol * 0.45, mid = uCol * 0.9, hot = mix(uCol, vec3(1.0,0.85,0.7), 0.5);
        vec3 col = mix(deep, mid, smoothstep(0.25,0.55,h));
        col = mix(col, hot, smoothstep(0.6,0.95,h));
        float rim = pow(clamp(1.0-abs(vN.z),0.0,1.0), 1.5);
        col += rim * uCol * 0.4;
        // 耀斑: 全域增亮 (可超過 bloom 閾值 => 真實的「亮起來」)
        col *= 1.0 + uFlare * 2.5;
        gl_FragColor = vec4(col * (1.6 + uFlare*1.5), 1.0);
      }`,
  });
  const star = new THREE.Mesh(new THREE.SphereGeometry(TRAP_STAR_R, 48, 48), starMat);
  star.userData.focusIndex = TRAP_STAR_FOCUS;
  clickable.push(star);
  g.add(star);
  trap.star = star; trap.starMat = starMat;
  trap.glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0xff6633, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  trap.glow.scale.set(TRAP_STAR_R*5, TRAP_STAR_R*5, 1);
  g.add(trap.glow);
  // 恆星光源: 紅矮星光度僅 0.000524 L☉, 但近距離行星仍受光 => 給足視覺亮度
  const light = new THREE.PointLight(0xff8855, 1.4, 0, 0.0);
  g.add(light);
  trap.light = light;
  const starDiv = document.createElement('div'); starDiv.className = 'label bh'; starDiv.textContent = 'TRAPPIST-1';
  const starLabel = new CSS2DObject(starDiv); starLabel.position.set(0, TRAP_STAR_R*1.6, 0); g.add(starLabel);
  trap.starLabelEl = starDiv; trap.labelObjs.push(starLabel);

  // --- 7 顆行星: 真實週期 => 共振鏈; 潮汐鎖定 (pivot 旋轉, 行星不自轉) ---
  TRAP_PLANETS.forEach((tp, i) => {
    const fake = { name: 'TRAPPIST-1'+tp.name, type: tp.type, color: tp.color, seed: tp.seed };
    const proc = genPlanet(fake);                       // 程序化岩石/冰貼圖 (顏色+法線+粗糙度)
    const mat = new THREE.MeshStandardMaterial({
      map: proc.color, normalMap: proc.normal, roughnessMap: proc.rough,
      color: 0xffffff, roughness: 1.0, metalness: 0.0 });
    mat.normalScale.set(0.8, 0.8);
    applyWrapLighting(mat, 0.1, null);                  // 柔和晨昏線
    mat.envMapIntensity = 0.1;
    const rVis = tp.R * TRAP_PR;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(rVis, 40, 40), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.focusIndex = TRAP_FOCUS_BASE + i;
    const pivot = new THREE.Group();
    const holder = new THREE.Group(); holder.position.x = tp.a * TRAP_SCALE; holder.add(mesh);
    pivot.add(holder); g.add(pivot);
    clickable.push(mesh);
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(Math.max(rVis*2.2, 6), 12, 10), clickProxyMat);
    proxy.visible = false; proxy.userData.focusIndex = TRAP_FOCUS_BASE + i; holder.add(proxy);
    clickable.push(proxy);
    const div = document.createElement('div'); div.className = 'label'; div.textContent = 'TRAPPIST-1'+tp.name;
    const label = new CSS2DObject(div); label.position.set(0, rVis*1.7, 0); holder.add(label);
    trap.labelEls.push(div); trap.labelObjs.push(label);
    // 軌道線 (圓, 半徑真實比例)
    const SEG = 128, op = new Float32Array((SEG+1)*3), rr = tp.a * TRAP_SCALE;
    for (let s = 0; s <= SEG; s++){ const th = s/SEG*TWO_PI; op[s*3]=Math.cos(th)*rr; op[s*3+1]=0; op[s*3+2]=Math.sin(th)*rr; }
    const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(op,3));
    const ol = new THREE.LineLoop(og, new THREE.LineBasicMaterial({ color:0x7a5a4a, transparent:true, opacity:0.4 }));
    g.add(ol); trap.orbitLines.push(ol);
    trap.planets.push({ data: tp, mesh, pivot, holder, rVis, phase: (i*0.9)%TWO_PI });
  });
}
buildTrappist();

// 耀斑排程: 以 trapDays 決定性產生偶發短促耀斑 (M 矮星特徵)。
function trapFlareEnvelope(days){
  // 每 ~0.6 天一個時間窗, 窗內以雜湊決定是否耀斑與強度; 耀斑本身 ~數小時。
  // 必須【決定性】: 以 trapDays 推導, 不用 Math.random() —— 否則每幀重新抽樣,
  // 耀斑會變成高頻閃爍噪訊 (正是本專案最忌的「行星異常閃爍」)。
  const win = Math.floor(days / 0.6);
  const hsh = Math.imul(win >>> 0, 2654435761) >>> 0;   // 32-bit 乘法 (免 Number 精度溢出)
  const u = hsh / 4294967296;
  if (u < 0.55) return 0;                               // 多數窗無耀斑
  const amp = (u - 0.55) / 0.45;                        // 0..1
  const frac = (days / 0.6) - win;                      // 窗內相位 0..1
  const u2 = (Math.imul((win ^ 0x9e3779b9) >>> 0, 40503) >>> 0) / 4294967296;
  const center = 0.3 + 0.4 * u2;                        // 耀斑在窗內的位置
  const w = 0.12;
  const pulse = Math.exp(-0.5 * Math.pow((frac - center) / w, 2));
  return amp * pulse;
}
function trapStep(dt){
  const d = trap;
  // 時間上限速: 最快的 b 星週期 1.51 天, 若每秒推進超過 MAX_TRAP_DAYS,
  // b 星會轉得快到紋理閃爍 (與行星自轉 MAX_SPD 同一誡律)。限速後全部行星
  // 等比例變慢 => 共振鏈的相對週期比仍精確成立。
  const MAX_TRAP_DAYS = 1.8;                       // 天/秒 (b 星 ≤ 1.19 rev/s)
  let daysPerSec = simSpeed * TRAP_DAYS_PER_SEC;
  if (daysPerSec > MAX_TRAP_DAYS) daysPerSec = MAX_TRAP_DAYS;
  trapDays += dt * daysPerSec;
  d.starMat.uniforms.uTime.value = trapDays * 0.6;
  // 行星: 真實週期驅動 => 共振鏈自動成立; 潮汐鎖定 (mesh 在 holder 內不自轉)
  for (const pl of d.planets){
    pl.pivot.rotation.y = pl.phase + TWO_PI * trapDays / pl.data.P;
  }
  // 耀斑 -> 恆星增亮 + 光源脈動
  const fl = trapFlareEnvelope(trapDays);
  d.starMat.uniforms.uFlare.value = fl;
  d.light.intensity = 1.4 * (1 + fl * 1.8);
  d.glow.scale.setScalar(TRAP_STAR_R * (5 + fl * 1.5));
  d.flare = fl;
}
// trap 模式的相機跟隨/渲染尾巴 (與太陽系共用同一套 flyTo/follow 邏輯)。
function trapAnimateTail(dt){
  const tracking = flyTo.active ? flyTo.index : (followIdx !== -1 ? followIdx : -1);
  if (tracking !== -1) {
    getFocusPos(tracking, _trackPos);
    if (hasTrack) _fd.subVectors(_trackPos, _prevTrack); else _fd.set(0, 0, 0);
    _prevTrack.copy(_trackPos); hasTrack = true;
    if (_fd.lengthSq() > 1e-12){ camera.position.add(_fd); controls.target.add(_fd); }
  }
  if (flyTo.active) {
    getFocusPos(flyTo.index, _wp);
    _cam.copy(camera.position).sub(_wp);
    if (_cam.lengthSq() < 1e-6) _cam.set(0, 0.4, 1);
    _cam.normalize();
    _desired.copy(_wp).add(_cam.multiplyScalar(flyTo.dist));
    if (reduceMotion) { controls.target.copy(_wp); camera.position.copy(_desired); flyTo.active = false; }
    else {
      flyTo.t += dt;
      controls.target.lerp(_wp, damp(9.0, dt));
      camera.position.lerp(_desired, damp(6.3, dt));
      if (camera.position.distanceTo(_desired) < Math.max(flyTo.dist * 0.06, 0.1) || flyTo.t > 2.2) flyTo.active = false;
    }
  } else if (followIdx !== -1) {
    getFocusPos(followIdx, _wp);
    controls.target.lerp(_wp, damp(7.7, dt));
  }
  controls.update();
  composer.render();
  labelRenderer.render(scene, camera);
}

// =============================================================================
//  場景切換 (太陽系 ⇄ TRAPPIST-1)
//
//  兩套系統共用同一個 scene/camera/composer, 但座標與時間尺度不同,
//  同一畫面只顯示一套。切換時必須:
//    1. 群組 visible: 太陽系在 ecliptic 下 (行星/帶/戴森/太陽),
//       但黑洞/蟲洞/彗星是【直接掛在 scene】的 => 需個別隱藏。
//    2. CSS2D 標籤不看祖先 visible => 必須逐一設 label.visible。
//    3. 後處理透鏡 pass 僅屬太陽系 => trap 模式停用。
//    4. 相機/追蹤/焦點選單重置 (兩套 focusIndex 不重疊)。
// =============================================================================
function syncSystemLabels(){
  const s = SYSTEM === 'solar';
  for (const o of planetObjs) if (o.label) o.label.visible = s;
  if (BH.label) BH.label.visible = s && bhOn;
  if (WH.label) WH.label.visible = s && whOn;
  if (COMET.label) COMET.label.visible = s;
  for (const lo of trap.labelObjs) lo.visible = !s;
}
// 軸傾指示器: 只在【太陽系模式】且【聚焦某行星】(followIdx ∈ 0..N-1) 時顯示該行星的軸。
// TRAPPIST 模式的行星索引 ≥100, 不在 planetObjs 範圍 => 全部隱藏。
function syncAxisIndicators(){
  const s = SYSTEM === 'solar';
  const focused = s && followIdx >= 0 && followIdx < planetObjs.length ? followIdx : -1;
  planetObjs.forEach((o, i) => { if (o.axis) o.axis.visible = (i === focused); });
}
// 焦點選單: 前 5 個靜態選項 (自由/太陽/黑洞/蟲洞/彗星) 常駐 index.html;
// 尾端依系統重建 (太陽系行星 或 TRAPPIST 天體)。
function rebuildFocusTail(){
  while (focusSelect.options.length > 5) focusSelect.remove(5);
  focusOptions.length = 0; trap.focusOpts.length = 0;
  const staticIdx = [1, 2, 3, 4];        // 太陽/黑洞/蟲洞/彗星 (index 0 = 自由視角)
  if (SYSTEM === 'solar'){
    staticIdx.forEach(i => { focusSelect.options[i].disabled = false; });
    planetObjs.forEach((o, idx) => {
      const opt = new Option(pname(o.data.name), String(idx));
      focusSelect.add(opt); focusOptions.push({ opt, name: o.data.name });
    });
  } else {
    staticIdx.forEach(i => { focusSelect.options[i].disabled = true; });  // 太陽系天體不可聚焦
    focusSelect.add(new Option(t('trap.star'), String(TRAP_STAR_FOCUS)));
    trap.planets.forEach((pl, i) => {
      const opt = new Option('TRAPPIST-1' + pl.data.name, String(TRAP_FOCUS_BASE + i));
      focusSelect.add(opt); trap.focusOpts.push(opt);
    });
  }
}
function updateSpeedLabel(){
  const el = $('speedVal');
  if (!el) return;
  el.textContent = SYSTEM === 'solar'
    ? t('unit.yrPerSec', { v: simSpeed.toFixed(2) })
    : t('unit.dayPerSec', { v: (simSpeed * TRAP_DAYS_PER_SEC).toFixed(1) });
}
function renderTrapNote(){
  const el = $('trapNote');
  if (el) el.innerHTML = SYSTEM === 'trap' ? `<span class="ds-note">${t('trap.note')}</span>` : '';
}
function setSystem(sys){
  if (sys === SYSTEM) return;
  SYSTEM = sys;
  const toSolar = sys === 'solar';
  // 群組可見性
  ecliptic.visible = toSolar;                       // 太陽/行星/帶/戴森/軌道線/sunLight
  BH.group.visible = toSolar && bhOn;               // 黑洞/蟲洞/彗星是 scene 直接子節
  WH.group.visible = toSolar && whOn;
  COMET.group.visible = toSolar;
  trap.group.visible = !toSolar;
  syncSystemLabels();
  // 後處理: 透鏡僅屬太陽系 (trap 無黑洞/蟲洞)
  lensingPass.enabled = toSolar;
  whLensingPass.enabled = toSolar;
  if (!toSolar){ lensingPass.uniforms.strength.value = 0; whLensingPass.uniforms.strength.value = 0; }
  // 焦點/相機重置
  followIdx = -1; flyTo.active = false; hasTrack = false;
  controls.minDistance = 30;
  syncAxisIndicators();   // 切系統 => 取消行星聚焦 => 軸指示器全隱
  rebuildFocusTail();
  focusSelect.value = '-1';
  camera.position.copy(toSolar ? CAM_HOME : TRAP_CAM_HOME);
  controls.target.set(0, 0, 0);
  controls.update();
  updateSpeedLabel();
  renderTrapNote();
  // trap 模式時間尺度不同, 重置各自的積分器避免跳變
  if (!toSolar) trapDays = 0;
}

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
//  蟲洞透鏡 後處理著色器
//
//  偏折律 α(b) = K·a²/b² (Ellis–Bronnikov 零測地線積分的領先項),
//  對比黑洞 pass 的 α ∝ 1/b。兩者在畫面上的差別:
//    · 黑洞: 偏折在視界外側很強, 有光子環與陰影盤。
//    · 蟲洞: 偏折在喉外迅速衰減 (1/b²), 無陰影、無光子環;
//      b≤a 的光線穿喉而過 → 喉是一個透視窗, 顯示「另一側」。
//  愛因斯坦環: θ³=常數 ⇒ 只畫一個細環, 不畫多重環。
// =============================================================================
const WormholeLensingShader = {
  uniforms: {
    tDiffuse: { value: null },
    whUV:     { value: new THREE.Vector2(0.5, 0.5) },
    whRadius: { value: 0.03 },   // 喉的螢幕半徑 (UV)
    strength: { value: 0 },
    aspect:   { value: innerWidth / innerHeight },
    ringColor:{ value: new THREE.Color(0x7fb8ff) },
    otherTint:{ value: new THREE.Color(0x2a3f66) },  // 「另一側」的色偏
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 whUV; uniform float whRadius;
    uniform float strength; uniform float aspect; uniform vec3 ringColor; uniform vec3 otherTint;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if(strength <= 0.0001){ gl_FragColor = texture2D(tDiffuse, uv); return; }
      vec2 d = uv - whUV; d.x *= aspect;
      float dist = length(d);
      vec2 dir = dist > 1e-6 ? d / dist : vec2(0.0);
      // b ≤ a: 光線穿喉而過 → 顯示「另一側」。
      // 映射必須【連續且有界】: 早先版用鏡像 + clamp(mUv,0,1), 中心區會採到
      // 螢幕邊緣的常數色 → 產生放射狀扇形假影; 且外環的偏折 cap 過寬,
      // 把外環帶折回喉盤, 將扇形複製到喉外。此處改為:
      //   rr = a·(dist/a)^0.8  (輕度放大, dist=a 時 rr=a 連續, 不越出喉盤)
      // 不做鏡像反轉: 穿喉後的天空方向在畫面上沒有第二個場景可採,
      // 用同向輕度放大 + 色偏近似「另一側」, 至少連續且不產生假影。
      if(dist < whRadius){
        float rr = whRadius * pow(max(dist, 1e-4) / whRadius, 0.8);
        vec2 mUv = whUV + vec2(dir.x * rr / aspect, dir.y * rr);
        vec3 other = texture2D(tDiffuse, mUv).rgb;
        // 喉緣增亮: dist 越接近 whRadius 越亮 (負能量物質的視覺隱喻, 裝飾層)
        float edge = smoothstep(whRadius * 0.72, whRadius, dist);
        vec3 col = mix(other * 0.85 + otherTint * 0.35, ringColor * 0.55, edge * 0.5);
        gl_FragColor = vec4(col, 1.0); return;
      }
      // b > a: α = K a²/b² → 取樣點向喉位移, 位移量 ∝ 1/dist²。
      // cap 取 0.5·(dist−a): 保證取樣點留在喉外 (dist−bend ≥ 0.5(dist+a) > a),
      // 不會折回喉盤而複製喉內內容。
      float bend = strength * whRadius * whRadius * whRadius * 2.0 / (dist * dist);
      bend = min(bend, 0.5 * (dist - whRadius));
      vec2 sUv = uv - vec2(dir.x * bend / aspect, dir.y * bend);
      if(sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0){ gl_FragColor = texture2D(tDiffuse, uv); return; }
      vec3 col = texture2D(tDiffuse, sUv).rgb;
      // 單一愛因斯坦環 (θ³=常數): 細高斯環於 1.55× 喉半徑, 無光子環、無陰影
      float ringC = whRadius * 1.55;
      float ringW = whRadius * 0.035;
      float q = (dist - ringC) / ringW;
      float ring = exp(-q * q);
      col += ringColor * ring * strength * 0.18;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// =============================================================================
//  後處理管線: Render -> 引力透鏡 -> 蟲洞透鏡 -> Bloom(HDR) -> Output
// =============================================================================
// MSAA 必須開在 composer 自己的 render target 上 (場景渲染到 rt1, 非預設框架緩衝)
const composerRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight,
  { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerRT);
composer.setSize(innerWidth, innerHeight); // 同步 _width/_pixelRatio 與所有 pass
composer.addPass(new RenderPass(scene, camera));
const lensingPass = new ShaderPass(LensingShader);
composer.addPass(lensingPass);
const whLensingPass = new ShaderPass(WormholeLensingShader);
composer.addPass(whLensingPass);
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
// 場景切換: 'solar' = 太陽系 (預設), 'trap' = TRAPPIST-1。兩套座標/時間尺度不同,
// 同一畫面只顯示一套 (另一套 group.visible=false); 切換時重置相機與追蹤。
let SYSTEM = 'solar';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = id => document.getElementById(id);
$('speed').addEventListener('input', e => {
  simSpeed = parseFloat(e.target.value);
  updateSpeedLabel();                            // 依系統顯示「年/秒」或「天/秒」
});
$('system').addEventListener('change', e => { setSystem(e.target.value); armUiIdle(); });
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
  syncAxisIndicators();   // 重置 => 取消聚焦 => 軸指示器隱藏
  camera.position.copy(SYSTEM === 'trap' ? TRAP_CAM_HOME : CAM_HOME); controls.target.set(0,0,0);
});
$('focus').addEventListener('change', e => { focusOn(parseInt(e.target.value)); });

// =============================================================================
//  鍵盤快捷鍵
//  全部沿用既有控制項的 click() / handler, 不另外實作一份狀態邏輯 ——
//  否則滑鼠與鍵盤兩條路徑遲早會不一致 (例如按鈕的 aria-pressed 忘了同步)。
//  快捷鍵對應面板上的按鈕, 面板底部有一行對照表。
// =============================================================================
function isTypingTarget(el){
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}
function nudgeSpeed(dir){
  const inp = $('speed');
  const step = 0.05;                       // 滑桿本身的 step 是 0.01, 鍵盤用大一點的步長
  let v = parseFloat(inp.value) + dir * step;
  v = Math.max(parseFloat(inp.min), Math.min(parseFloat(inp.max), v));
  inp.value = String(v);
  inp.dispatchEvent(new Event('input', { bubbles: true }));  // 沿用既有 handler 更新 simSpeed
}
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // 不搶瀏覽器/作業系統快捷鍵
  const typing = isTypingTarget(e.target);
  const onControl = typing || (e.target && e.target.closest && e.target.closest('button'));
  const k = e.key;
  // 空白鍵: 焦點在按鈕上時讓瀏覽器原生的 click 處理, 否則會同時觸發「切換」與「暫停」
  if (k === ' ' || k === 'Spacebar'){
    if (onControl) return;
    e.preventDefault(); $('pause').click(); return;
  }
  if (typing) return;                       // 其餘快捷鍵在輸入/選單操作中一律不生效
  if (k >= '1' && k <= '8'){                 // 數字鍵依系統對應不同天體
    e.preventDefault();
    const n = parseInt(k, 10);
    if (SYSTEM === 'trap'){ if (n >= 1 && n <= 7) focusOn(TRAP_FOCUS_BASE + n - 1); }
    else focusOn(n - 1);                     // 太陽系: 1-8 = 八顆行星 (+冥王星=9? 數字鍵只到 8)
    return;
  }
  switch (k){
    case '0': e.preventDefault(); focusOn(-2); break;          // 太陽
    case '9': e.preventDefault(); focusOn(-3); break;          // 黑洞
    case '[': case '-': e.preventDefault(); nudgeSpeed(-1); break;
    case ']': case '=': case '+': e.preventDefault(); nudgeSpeed(1); break;
    case 'r': case 'R': e.preventDefault(); $('reset').click(); break;
    case 'l': case 'L': e.preventDefault(); $('tLabels').click(); break;
    case 'o': case 'O': e.preventDefault(); $('tOrbits').click(); break;
    case 'b': case 'B': e.preventDefault(); $('tBH').click(); break;
    case 'g': case 'G': e.preventDefault(); $('tLens').click(); break;
    case 'd': case 'D': e.preventDefault(); $('tDyson').click(); break;
    case 'w': case 'W': e.preventDefault(); $('tWH').click(); break;
    case 'c': case 'C': e.preventDefault(); focusOn(-5); break;   // 彗星
    case 'p': case 'P': e.preventDefault(); focusOn(8); break;    // 冥王星 (索引 8; 數字鍵已滿, 用字母)
    case 'a': case 'A': e.preventDefault(); $('tBelt').click(); break;  // 小行星帶
    case 's': case 'S': e.preventDefault(); {                     // 切換星際系統 (太陽系 ⇄ TRAPPIST-1)
      const sel = $('system'); sel.value = sel.value === 'solar' ? 'trap' : 'solar';
      sel.dispatchEvent(new Event('change', { bubbles: true }));   // 沿用既有 handler (不另寫一套狀態邏輯)
      break; }
  }
});

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
  // r160 Raycaster 不看 visible -> 隱藏的黑洞仍可被命中, 這裡手動過濾 (M1)
  const hit = hits.find(h => h.object.userData.focusIndex !== undefined &&
    !(h.object.userData.focusIndex === -3 && !bhOn) &&
    !(h.object.userData.focusIndex === -4 && !whOn));
  if (hit) focusOn(hit.object.userData.focusIndex);
});

const flyTo = { active: false, index: -1, dist: 200, t: 0 };
// TRAPPIST 聚焦索引: 恆星 = TRAP_STAR_FOCUS(90), 行星 = TRAP_FOCUS_BASE(100)+i。
// 與太陽系的 0..8 與負索引不重疊, 故同一套 focusOn/flyTo 可共用。
const isTrapIdx = idx => idx === TRAP_STAR_FOCUS || idx >= TRAP_FOCUS_BASE;
function trapPlanetOf(idx){ return trap.planets[idx - TRAP_FOCUS_BASE]; }
function getFocusPos(idx, out){
  if (idx === -2) out.set(0, 0, 0);                 // 太陽 (黃道群組原點)
  else if (idx === -3) out.copy(BH.pos);            // 黑洞
  else if (idx === -4) out.copy(WH.pos);            // 蟲洞
  else if (idx === -5) out.copy(COMET.pos);         // 彗星
  else if (idx === TRAP_STAR_FOCUS) out.set(0, 0, 0);          // TRAPPIST 恆星 (群組原點)
  else if (idx >= TRAP_FOCUS_BASE) trapPlanetOf(idx).mesh.getWorldPosition(out);  // TRAPPIST 行星
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
  if (idx === -4) return WH.throatR * 2.2;         // 蟲洞: 含喉緣餘裕
  if (idx === -5) return 6;                        // 彗星: 含彗髮餘裕
  if (idx === TRAP_STAR_FOCUS) return TRAP_STAR_R * 1.5;   // TRAPPIST 恆星
  if (idx >= TRAP_FOCUS_BASE) return trapPlanetOf(idx).rVis * 3.0;  // TRAPPIST 行星 (含軌道餘裕)
  const p = PLANETS[idx];
  return p._binR || p.rDisp * (p.ring ? 2.9 : 1.4);           // 土星含環餘裕; 雙體含凱龍軌道餘裕
}
function focusDistFor(idx){
  if (idx === -3) return BH.diskOuter * 0.9 + 30;  // 黑洞: 停在吸積盤外側
  if (idx === -4) return WH.throatR * 4.5;         // 蟲洞: 停在喉外, 透鏡效應最清楚
  if (idx === -5) return 26;                       // 彗星: 停在尾長可覽的距離
  return focusEffR(idx) * FOCUS_K;
}
function focusOn(idx){
  if (idx === -3 && !bhOn) { $('focus').value = String(followIdx); return; } // 隱藏的黑洞不可聚焦
  if (idx === -4 && !whOn) { $('focus').value = String(followIdx); return; } // 隱藏的蟲洞不可聚焦
  // 跳系統聚焦: 太陽系天體索引在 TRAPPIST 模式下無效 (反之亦然), 忽略之;
  // 但自由視角 (-1) 兩系統共用, 必須放行。
  if (idx !== -1 && isTrapIdx(idx) !== (SYSTEM === 'trap')) { $('focus').value = String(followIdx); return; }
  followIdx = idx; $('focus').value = String(idx);
  hasTrack = false; // 重設跟隨暫存器, 避免跨目標的大位移
  syncAxisIndicators();   // 軸傾指示器: 只顯示目前聚焦的行星
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
// 小行星帶/古柏帶: 與軌道線同一淡入淡出語彙。淡出完才 visible=false,
// 否則漸變動畫看不見 (與黑洞/蟲洞同理)。
$('tBelt').addEventListener('click', e => {
  beltOn = !beltOn; e.target.classList.toggle('on', beltOn);
  e.target.setAttribute('aria-pressed', String(beltOn));
  const cur = beltMats[0].uniforms.uOpacity.value;
  if (beltOn) beltGroup.visible = true;
  fadeTo('belt', v => { for (const m of beltMats) m.uniforms.uOpacity.value = v; }, cur, beltOn ? 1 : 0, 180,
    () => { if (!beltOn) beltGroup.visible = false; });
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
function renderWhNote(){
  const el = $('whNote');
  if (el) el.innerHTML = whOn ? `<span class="ds-note">${t('ds.note.wh')}</span>` : '';
}
$('tWH').addEventListener('click', e => {
  whOn = !whOn; e.target.classList.toggle('on', whOn);
  e.target.setAttribute('aria-pressed', String(whOn));
  renderWhNote();
  const rimMat = WH.rimMat;
  const whLabelDiv = WH.label.element;
  const cur = rimMat.opacity / 0.5;              // rim 基準不透明度為 0.5
  if (whOn) { WH.group.visible = true; WH.label.visible = true; whLabelDiv.style.display = ''; }
  // 標籤由 CSS2DRenderer 獨立渲染 (不看祖先 visible), 必須與群組一起淡出/隱藏
  fadeTo('wh', v => {
    rimMat.opacity = v * 0.5;
    whLabelDiv.style.opacity = String(v);
  }, cur, whOn ? 1 : 0, 180,
    () => { if (!whOn){
      WH.group.visible = false; WH.label.visible = false; whLabelDiv.style.display = 'none';
      if (followIdx === -4) focusOn(-1); // 停止追擊隱形蟲洞
    } });
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
//  戴森殼 (Dyson shell)
//
//  物理依據 —— 全部經數值驗證, 不是憑印象:
//
//  1. 輻射平衡   T = [ L(1-A) / (4πσR²) ]^(1/4)
//     殼兩面都輻射, 且吸收面積與輻射面積皆正比於覆蓋率 f, 所以
//     **T 與 f 無關**。f 只決定攔截功率與外逸光度。
//
//  2. 殼定理 (Newton shell theorem)
//     均勻殼內部重力場恒為零 → 恆星對殼無淨力。輻射壓同理 (兩者皆 1/r²
//     場, 球面積分同型) ⇒ 淨力也是零。
//     故為**中性平衡 (neutral equilibrium)**: 沒有回復力, 也不是指數發散。
//     擾動後殼以**等速**漂移, 直到內壁撞上恆星。
//     數值驗證: Gauss-Legendre 球面積分, 偏移 0.3R / 0.9R 時 |F| 收斂至 ~1e-12。
//     ⇒ 所以這裡的擾動是線性漂移, **不是**彈簧式回復或指數爆炸。
//     參 arXiv 2409.10602: 相對論彈性膜的軸對稱偶極模式線性不穩定,
//       「徑向穩定」不等於穩定。參 arXiv 2502.12806: 雙星系統中包住
//       較小質量時可穩定 —— 但本場景只有單一恆星, 故不適用。
//
//  3. 光學波段佔比 (Planck 級數積分)
//     R ≥ 0.15 AU 時 380–780nm 僅佔總輻射 ~1e-5 以下 ⇒ **殼在可見光下是黑的**。
//     它唯一的光學效應是「恆星變暗」: 外逸光度降至 (1-f)L, 行星隨之變暗。
//     能量改以 λmax 3–4 µm 的紅外線釋出。實測 IR(2–30µm) 功率約為殘餘恆星的
//     15 倍 ⇒ 這正是 Project Hephaistos / Ĝ 用「紅外超量」而非「光學變暗」
//     搜尋戴森球的原因 (arXiv 2607.09460, 2608.12458)。
//     ⇒ 因此提供兩種視圖: 光學 (誠實: 殼幾乎全黑) 與紅外偽色 (殼的廢熱)。
//       不做「為了好看而讓殼發紅光」的假物理。
//
//  4. 能量守恆   (1-f)L 外逸可見光 + f·L(1-A) 殼的廢熱 + f·L·A 反射回內部 = L
//
//  5. 半徑可用範圍由**本場景的距離壓縮**決定: distScale(a) = a^0.65 × 66,
//     SUN_R = 16 ⇒ 視覺下限約 0.113 AU; 再往外就會包住水星 (35.8) 而遮住它。
//     故取 0.15–0.35 AU, 對應 T ≈ 1000–660 K, 全程光學不可見。
// =============================================================================
const DS_L = 3.828e26, DS_SIGMA = 5.670374419e-8, DS_WIEN = 2.897771955e-3,
      DS_C2 = 0.0143877687, DS_KARD_II = 4e26, DS_AU_M = 1.495978707e11;
const DS_ALBEDO = 0.05;               // 吸光型集能面: 反射極少
const DS_SUN_T = 5772;                // 太陽有效溫度
const DS_MIN_AU = 0.15, DS_MAX_AU = 0.35, DS_DEF_AU = 0.25;
const DS_IR_RATIO = 15;               // 實測: 殼 IR 功率 / 殘餘恆星 IR 功率

// Planck 分佈在 0→λ 的累積佔比 (級數展開)。已與直接數值積分比對:
// 1229/1738/2244/3000/5772/6504 K 六點的相對誤差均 < 1e-5。
function planckFracBelow(waveM, T){
  const u = DS_C2 / (waveM * T);
  let s = 0;
  for (let n = 1; n <= 60; n++){
    s += Math.exp(-n * u) * (u*u*u/n + 3*u*u/(n*n) + 6*u/(n*n*n) + 6/(n*n*n*n));
  }
  return s * 15 / (Math.PI ** 4);
}
const dsOpticalFrac = T => Math.max(0, planckFracBelow(780e-9, T) - planckFracBelow(380e-9, T));
const dsShellTemp = R_au => Math.pow(DS_L * (1 - DS_ALBEDO) / (4 * Math.PI * DS_SIGMA * Math.pow(R_au * DS_AU_M, 2)), 0.25);
// 殼的光學輻射 / 恆星光學輻射 (依 σT⁴ × 各自波段佔比)
const dsOpticalRatio = T => (Math.pow(T, 4) * dsOpticalFrac(T)) / (Math.pow(DS_SUN_T, 4) * dsOpticalFrac(DS_SUN_T));

// 黑體色溫 → sRGB (Tanner Helland 擬合)。已以四個參考值錨定驗證:
// 6500K→(255,254,250) D65 白點 · 5772K→(255,242,230) 太陽 ·
// 2700K→(255,167,87) 白熾燈 · 1700K→(255,121,0) 燭焰
function blackbodyRGB(T){
  const k = T / 100;
  let r, g, b;
  if (k <= 66) r = 255; else r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
  if (k <= 66) g = 99.4708025861 * Math.log(k) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
  if (k >= 66) b = 255; else if (k <= 19) b = 0;
  else b = 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  const cl = v => Math.max(0, Math.min(255, Math.round(v)));
  return [cl(r), cl(g), cl(b)];
}

const dsUniforms = {
  uColor:   { value: new THREE.Color(1, 0.5, 0.1) },
  uGlow:    { value: 0 },      // 熱輻射強度: 光學模式幾乎為 0, 紅外模式才明顯
  uOpacity: { value: 0 },      // = 實際遮蔽比例
  uTime:    { value: 0 },      // 結構照明動畫 (人造光源, 非熱輻射)
  uLights:  { value: 1 },      // 人造照明強度 (科幻結構層)
};
const dsMat = new THREE.ShaderMaterial({
  uniforms: dsUniforms,
  transparent: true,
  side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; varying vec3 vN;
    void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    varying vec2 vUv; varying vec3 vN;
    uniform vec3 uColor; uniform float uGlow; uniform float uOpacity;
    uniform float uTime; uniform float uLights;
    void main(){
      // 集能板陣列: 六角錯排的接縫, 比方正網格更像人造巨構
      vec2 cell = vUv * vec2(96.0, 48.0);
      cell.x += step(0.5, fract(cell.y * 0.5)) * 0.5;   // 錯排
      vec2 g = abs(fract(cell) - 0.5);
      float seam = smoothstep(0.44, 0.5, max(g.x, g.y));
      // 能量導管: 沿緯度移動的脈衝 (結構自身的輸能照明)
      float flow = fract(vUv.y * 6.0 - uTime * 0.06);
      float pulse = smoothstep(0.0, 0.06, flow) * smoothstep(0.16, 0.06, flow);
      // 掠射角增亮, 讓殼的輪廓在近乎全黑的表面上仍可辨識
      float rim = pow(1.0 - abs(vN.z), 3.0);
      vec3 steel = vec3(0.012, 0.014, 0.02);
      vec3 lamp  = vec3(0.35, 0.62, 0.95);          // 人造照明的冷色
      vec3 base = steel + seam * lamp * 0.10 * uLights
                        + pulse * lamp * 0.16 * uLights
                        + rim * vec3(0.05, 0.07, 0.1);
      // 虹膜艙門 (Star Trek TNG 〈Relics〉的視覺母題): 赤道帶 6 個圓形開口,
      // 內有輻射狀閘葉。開口是【真實的洞】—— alpha 在此降低, 且其面積已從
      // 有效覆蓋率扣除 (DS_IRIS_FRAC), 所以恆星變暗程度與讀數一致。
      float iris = 0.0, irisRim = 0.0, blades = 0.0;
      for (int i = 0; i < 6; i++){
        vec2 c = vec2((float(i) + 0.5) / 6.0, 0.5);
        vec2 d = (vUv - c) * vec2(1.0, 2.2);        // v 方向拉伸以補球面壓縮
        float dd = length(d);
        const float rA = 0.032;
        float m = smoothstep(rA, rA * 0.86, dd);    // 1 = 開口內
        iris = max(iris, m);
        irisRim = max(irisRim, smoothstep(rA * 1.3, rA, dd) * smoothstep(rA * 0.75, rA, dd));
        float ang = atan(d.y, d.x);
        blades = max(blades, m * (0.5 + 0.5 * sin(ang * 9.0 + uTime * 0.35)));
      }
      vec3 col = base + uColor * uGlow;             // uGlow = 熱輻射 (僅紅外模式)
      col = mix(col, steel * 0.3 + blades * lamp * 0.22 * uLights, iris);  // 開口內: 閘葉
      col += irisRim * lamp * 0.6 * uLights;        // 艙門發光邊緣
      float alpha = uOpacity * (1.0 - iris * 0.9);  // 開口幾乎透明
      gl_FragColor = vec4(col, alpha);
    }`,
});
const dsGroup = new THREE.Group();
dsGroup.visible = false;
ecliptic.add(dsGroup);
let dsMesh = null, dsR = distScale(DS_DEF_AU);

// -----------------------------------------------------------------------------
//  戴森環 (軌道收集器環)
//
//  與殼的關鍵物理差異:
//  1. 溫度: 環是平板收集器, 兩面都向太空輻射且無自身再吸收,
//     S(1-A) = 2σT⁴ ⇒ T環 = T殼 / 2^(1/4) ≈ T殼 / 1.189。
//  2. 遮光/攔截與半徑無關: 帶高 h∝R 使 r 相消, cover=1 時僅擋 h/2 = 4% 星光。
//  3. 動態穩定: 每個收集器獨立走克卜勒軌道 (ω = 2π/a^1.5), 不是剛體。
//     剛性環對單星是指數不穩定 (Maxwell 1856; arXiv 2502.12806 的穩定解需雙星),
//     但獨立軌道環沒有這個問題。
//  4. 擾動響應相反: 殼是中性平衡 (等速漂走); 環在開普勒勢中徑向擾動會以
//     週轉頻率 κ=Ω 做【有界】振盪 —— 同一個按鈕, 兩種截然不同的穩定性示範。
// -----------------------------------------------------------------------------
const DR_H = 0.08;                 // 環帶高 / 半徑 (決定遮光率 h/2)
const DR_N = 120;                  // 收集器數量
const drUniforms = {
  uColor:  { value: new THREE.Color(1, 0.5, 0.1) },
  uGlow:   { value: 0 },
  uOpacity:{ value: 0 },
  uTime:   { value: 0 },
  uLights: { value: 1 },
};
const drMat = new THREE.ShaderMaterial({
  uniforms: drUniforms,
  transparent: true,
  side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; varying vec3 vN;
    void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    varying vec2 vUv; varying vec3 vN;
    uniform vec3 uColor; uniform float uGlow; uniform float uOpacity;
    uniform float uTime; uniform float uLights;
    void main(){
      // 沿環向的結構分段 + 移動的能量脈衝 (輸能照明, 人造光源)
      float seg = abs(fract(vUv.x * 160.0) - 0.5);
      float seam = smoothstep(0.42, 0.5, seg);
      float flow = fract(vUv.x * 8.0 - uTime * 0.10);
      float pulse = smoothstep(0.0, 0.05, flow) * smoothstep(0.14, 0.05, flow);
      // 帶的上下邊緣增亮, 給出輪廓
      float edge = smoothstep(0.5, 0.02, abs(vUv.y - 0.5));
      // 結構脊: 沿帶中線的桁架亮線, 巨構的辨識特徵
      float spine = smoothstep(0.06, 0.0, abs(vUv.y - 0.5));
      vec3 steel = vec3(0.012, 0.014, 0.02);
      vec3 lamp  = vec3(0.35, 0.62, 0.95);
      vec3 base = steel * (0.4 + 0.6 * edge)
                + seam * lamp * 0.55 * uLights
                + pulse * lamp * 0.95 * uLights
                + spine * lamp * 0.60 * uLights
                + edge * vec3(0.07, 0.10, 0.15);
      vec3 col = base + uColor * uGlow;
      gl_FragColor = vec4(col, uOpacity);
    }`,
});
// 收集器專用材質: 向陽面是吸光的深色集能板, 背陽與側面是人造照明的冷色桁架。
// BoxGeometry 的 local -Z 指向恆星 (basis 的第三軸是徑向外), 故以 vN.z 判別向陽面。
const DR_COL_FRAG = `
    varying vec2 vUv; varying vec3 vN;
    uniform vec3 uColor; uniform float uGlow; uniform float uOpacity;
    uniform float uTime; uniform float uLights;
    void main(){
      float sunward = smoothstep(0.2, -0.2, vN.z);      // local -Z = 向陽
      vec3 absorber = vec3(0.02, 0.022, 0.03);           // 集能板: 吸光, 幾乎不反射
      vec3 lamp = vec3(0.35, 0.62, 0.95);
      // 側面桁架照明 + 沿板長的脈衝
      float flow = fract(vUv.x * 2.0 - uTime * 0.12);
      float pulse = smoothstep(0.0, 0.08, flow) * smoothstep(0.2, 0.08, flow);
      // 板緣輪廓光: 讓方塊在恆星輝光前仍能讀出形狀 (裝飾層, 非熱輻射)
      vec2 eg = abs(vUv - 0.5);
      float edge = smoothstep(0.42, 0.5, max(eg.x, eg.y));
      vec3 col = mix(lamp * (0.55 + 0.9 * pulse) * uLights + edge * lamp * 0.8 * uLights,
                     absorber + edge * lamp * 0.5 * uLights, sunward * 0.85);
      col += uColor * uGlow * (0.3 + 0.7 * sunward);     // 紅外偽色時向陽面更亮
      gl_FragColor = vec4(col, uOpacity);
    }`;
const DR_COL_VERT = `varying vec2 vUv; varying vec3 vN;
    void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const drColMat = new THREE.ShaderMaterial({
  uniforms: drUniforms, transparent: true, side: THREE.DoubleSide,
  vertexShader: DR_COL_VERT, fragmentShader: DR_COL_FRAG,
});
// 內軌 swarm 用同一個著色器但【獨立的不透明度】: swarm 填補外環的縫隙,
// 所以 f 越低它越明顯 —— 與外環帶的 cover·v 正好相反。若共用 uOpacity,
// f=0 時 swarm 會變成隱形, 與物理意義 (s = F·(1-f)) 完全顛倒。
const drSwarmUniforms = {
  uColor: drUniforms.uColor, uGlow: drUniforms.uGlow,
  uTime: drUniforms.uTime, uLights: drUniforms.uLights,
  uOpacity: { value: 0 },
};
const drSwarmMat = new THREE.ShaderMaterial({
  uniforms: drSwarmUniforms, transparent: true, side: THREE.DoubleSide,
  vertexShader: DR_COL_VERT, fragmentShader: DR_COL_FRAG,
});
// 能量導管: 沿環中線的附加混合亮環, 輸能的視覺隱喻 (純裝飾, 不參與物理)
const drConduitMat = new THREE.MeshBasicMaterial({
  color: 0x59a8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide,
});
let drConduit = null;
const drGroup = new THREE.Group();
drGroup.visible = false;
ecliptic.add(drGroup);
let drBand = null, drCollectors = null;
// 內軌 swarm 必須是【獨立群組】: 較小半徑 → 較快克卜勒角速度,
// 若掛在 drGroup 下會被迫與外環同速旋轉, 那就違反開普勒第三定律。
const drSwarmGroup = new THREE.Group();
drSwarmGroup.visible = false;
ecliptic.add(drSwarmGroup);
let drSwarm = null;
const dr = { angle: 0, omega: 0, omegaInner: 0, periodYr: 1, amp: 0, phase: 0, t: 0 };
const _drM = new THREE.Matrix4(), _drQ = new THREE.Quaternion(),
      _drP = new THREE.Vector3(), _drS = new THREE.Vector3(), _drZ = new THREE.Vector3(0,0,1);

const ds = { on: false, ir: false, cover: 0.5, radiusAU: DS_DEF_AU, mode: 'shell',
             offset: new THREE.Vector3(), vel: new THREE.Vector3(), collided: false };
const DS_BASE_LIGHT = sunLight.intensity;   // 未遮蔽時的恆星強度

// 遮蔽比例 (幾何遮光率, 決定恆星變暗與外逸光度):
//   殼 = f·(1-IRIS): 赤道 6 座虹膜艙門常開, 開口不集能, 面積從有效覆蓋扣除
//   環 = (h/2)·[f + F·(1-f)²]:
//     外環帶擋 f。內軌 swarm 覆蓋 s = F·(1-f) (填補外環縫隙), 但它在
//     較小半徑 → 較快角速度, 與外環的相位關係持續漂移, 所以它的陰影
//     只有 (1-f) 的時間落在外環縫隙上 (時間平均) → 新增遮光 s·(1-f)。
//     合計 f + F(1-f)²。f=1 時無縫可填 → 退回 h/2。
const DS_IRIS_FRAC = 0.02;         // 虹膜艙門佔球面積比例 (TNG〈Relics〉母題)
const DR_SWARM_FILL = 0.5;         // 內軌 swarm 填補外環縫隙的比例
const DR_NSQ = 24;                 // 內軌收集器 (陰影方塊) 數量
const DR_SWARM_R = 0.86;           // 內軌半徑 / 外環半徑。
// 取 0.86 而非更貼外環的 0.94: 0.94 時內軌與外環帶在畫面上幾乎重合,
// 被太陽輝光吞沒。0.86 在最小半徑 0.15 AU 時仍位於太陽視覺半徑之外
// (distScale(0.15)×0.86 = 16.54 > SUN_R = 16), 且能讓陰影方塊剪影在
// 恆星盤面上 —— Ringworld 的經典畫面。
const dsBlockFrac = () => ds.mode === 'shell'
  ? ds.cover * (1 - DS_IRIS_FRAC)
  : (DR_H / 2) * (ds.cover + DR_SWARM_FILL * Math.pow(1 - ds.cover, 2));
// 環溫度 = 殼溫度 / 2^(1/4): 平板兩面輻射, 無自身再吸收
const drShellTemp = R_au => dsShellTemp(R_au) / Math.pow(2, 0.25);

// 以單一 v ∈ [0,1] 同步驅動「結構不透明度」與「恆星遮蔽」。
// 必須同源: 若兩者不同步, 漸變過程中會瞬間違反能量守恆
// (例如殼已消失但恆星還暗著)。關閉時 v=0 ⇒ 恆星必定恢復全亮。
// 這是先前 bug 的根源: dsApply() 不看 ds.on, 導致 f=100% 時關閉殼,
// 恆星亮度停在 0 而永久全黑。
// 遮蔽比例依模式: 殼 = f; 環 = f·h/2 (緯度帶只擋 ±h/2)。
function dsSetFade(v){
  const blk = dsBlockFrac() * v;
  dsUniforms.uOpacity.value = ds.mode === 'shell' ? ds.cover * v : 0;
  drUniforms.uOpacity.value = ds.mode === 'ring'  ? ds.cover * v : 0;
  // swarm 填縫: f 越低越明顯 (s = F·(1-f)), 與外環帶相反。
  // 不透明度取 min(1, s·2.2) 而非 s 本身: 集能板是暗色, 若直接用 s=0.35
  // 在黑色太空背景上幾乎隱形。放大後仍單調、且 f=1 時 s=0 → 隱形 (正確:
  // 外環帶已完整, 沒有縫隙需要填補)。物理遮光率仍用解析的 s, 不受此影響。
  drSwarmUniforms.uOpacity.value = ds.mode === 'ring' ? Math.min(1, DR_SWARM_FILL * (1 - ds.cover) * 2.2) * v : 0;
  drConduitMat.opacity = ds.mode === 'ring' ? ds.cover * v * 0.45 : 0;   // 導管亮度隨覆蓋率
  sunLight.intensity = DS_BASE_LIGHT * (1 - blk);
  sunUniforms.uVis.value = 1 - blk;
  glow.material.opacity = 1 - blk;
  glow.visible = blk < 0.999;
}

// 環的幾何: 一條開放緯度帶 + DR_N 個獨立收集器。
// 收集器不連成剛體 —— 每個都走自己的圓軌道, 整環同角速度旋轉只是
// 「同半徑圓軌道」的等價描述, 所以 drGroup 整體旋轉在物理上是精確的。
function drLayout(){
  if (!drCollectors) return;
  const r = distScale(ds.radiusAU);
  const w = (TWO_PI * r / DR_N) * 0.92 * Math.max(ds.cover, 0.02);
  const t = new THREE.Vector3(), out = new THREE.Vector3(0, 0, 1), rad = new THREE.Vector3();
  for (let i = 0; i < DR_N; i++){
    const th = i / DR_N * TWO_PI;
    rad.set(Math.cos(th), Math.sin(th), 0);
    t.set(-Math.sin(th), Math.cos(th), 0);
    _drM.makeBasis(t, out, rad);
    _drQ.setFromRotationMatrix(_drM);
    _drP.copy(rad).multiplyScalar(r);
    _drM.compose(_drP, _drQ, _drS.set(w / ((TWO_PI * r / DR_N) * 0.92), 1, 1));
    drCollectors.setMatrixAt(i, _drM);
  }
  drCollectors.instanceMatrix.needsUpdate = true;
}
function drSwarmLayout(r){
  if (!drSwarm) return;
  const ri = r * DR_SWARM_R;
  const w = (TWO_PI * ri / DR_NSQ) * 0.85;
  const hgt = r * DR_H * 0.9, dep = Math.max(r * 0.024, 0.6);
  const out = new THREE.Vector3(0, 0, 1), rad = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < DR_NSQ; i++){
    const th = i / DR_NSQ * TWO_PI;
    rad.set(Math.cos(th), Math.sin(th), 0);
    t.set(-Math.sin(th), Math.cos(th), 0);
    _drM.makeBasis(t, out, rad);
    _drQ.setFromRotationMatrix(_drM);
    _drP.copy(rad).multiplyScalar(ri);
    _drM.compose(_drP, _drQ, _drS.set(w, hgt, dep));
    drSwarm.setMatrixAt(i, _drM);
  }
  drSwarm.instanceMatrix.needsUpdate = true;
}
function buildRing(r){
  if (drBand){ drGroup.remove(drBand); drBand.geometry.dispose(); drBand = null; }
  if (drCollectors){ drGroup.remove(drCollectors); drCollectors.geometry.dispose(); drCollectors = null; }
  if (drConduit){ drGroup.remove(drConduit); drConduit.geometry.dispose(); drConduit = null; }
  if (drSwarm){ drSwarmGroup.remove(drSwarm); drSwarm.geometry.dispose(); drSwarm = null; }
  const h = r * DR_H;
  drBand = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 128, 1, true), drMat);
  drBand.rotation.x = Math.PI / 2;          // 圓柱預設軸為 Y, 轉到黃道面的法線 (區域 Z)
  drGroup.add(drBand);
  const dep = Math.max(r * 0.016, 0.45), hgt = h * 0.86;
  drCollectors = new THREE.InstancedMesh(new THREE.BoxGeometry(1, hgt, dep), drColMat, DR_N);
  drGroup.add(drCollectors);
  // 導管略大於環半徑, 避免與帶共面閃爍
  drConduit = new THREE.Mesh(new THREE.TorusGeometry(r * 1.004, Math.max(r * 0.004, 0.12), 8, 256), drConduitMat);
  drGroup.add(drConduit);
  // 內軌 swarm (陰影方塊鏈, Ringworld 母題): 獨立群組、獨立角速度、獨立不透明度
  drSwarm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), drSwarmMat, DR_NSQ);
  drSwarmGroup.add(drSwarm);
  drSwarmLayout(r);
  drLayout();
  dr.omega = TWO_PI / Math.pow(ds.radiusAU, 1.5);            // 外環: ω = 2π/a^1.5
  dr.omegaInner = TWO_PI / Math.pow(ds.radiusAU * DR_SWARM_R, 1.5);  // 內軌較快
}

function dsApply(){
  const isShell = ds.mode === 'shell';
  const T = isShell ? dsShellTemp(ds.radiusAU) : drShellTemp(ds.radiusAU);
  const r = distScale(ds.radiusAU);
  if (dsMesh){ dsGroup.remove(dsMesh); dsMesh.geometry.dispose(); dsMesh = null; }
  if (isShell){
    dsMesh = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64), dsMat);
    dsGroup.add(dsMesh);
  }
  buildRing(r);                              // 兩種模式都建, 顯示哪個由 visible 決定
  dsR = r;
  const [cr, cg, cb] = blackbodyRGB(T);
  dsUniforms.uColor.value.setRGB(cr / 255, cg / 255, cb / 255);
  drUniforms.uColor.value.setRGB(cr / 255, cg / 255, cb / 255);
  // 光學模式: 熱輻射強度依實際光學佔比 → 幾乎為 0 (誠實)
  // 紅外偽色模式: 顯示廢熱, 色相取自 blackbodyRGB(T)。
  // 增益壓在 0.25 (線性值 <1): ACES 會對超過線性 1.0 的亮色去飽和,
  // 把 ~700 K 的深紅沖淡成讀作 ~3500 K 的琥珀色。
  // 實測增益→色相誤差 (0.15/0.25/0.35 AU): 0.90→18.8/17.0/13.2°,
  // 0.35→9.4/6.2/3.0°, 0.25→6.0/4.0/1.0°。取 0.25 平衡忠實與可見。
  const g = ds.ir ? 0.25 : 0.0;
  dsUniforms.uGlow.value = g;
  drUniforms.uGlow.value = g;
  dsGroup.visible = ds.on && isShell;
  drGroup.visible = ds.on && !isShell;
  drSwarmGroup.visible = ds.on && !isShell;
  dsSetFade(ds.on ? 1 : 0);
}

function dsPerturb(mag){
  if (ds.mode === 'shell'){
    // 殼定理保證之後**不再受力**, 所以是等速漂移
    const th = Math.random() * Math.PI, ph = Math.random() * Math.PI * 2;
    ds.vel.set(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)).multiplyScalar(mag);
  } else {
    // 環: 開普勒勢中徑向擾動以週轉頻率 κ=Ω 做【有界】振盪 (epicyclic 模式)。
    // 與殼的中性平衡 (漂走) 截然不同 —— 同一個按鈕, 兩種穩定性示範。
    dr.amp = 0.06;
    dr.phase = Math.random() * TWO_PI;
    dr.t = 0;
  }
  ds.collided = false;
}

// 每幀推進。殼: 中性平衡 → 等速漂移, 內壁撞恆星即停。環: 克卜勒軌道旋轉
// + 擾動後的有界徑向振盪 (以整環同相的 coherent mode 呈現)。
function dsStep(simDt){
  if (!ds.on) return;
  if (ds.mode === 'shell'){
    if (ds.collided) return;
    const k = simDt * simSpeed * 6;   // 6 = 場景單位/年的漂移速率尺度, 讓擾動肉眼可見
    ds.offset.addScaledVector(ds.vel, k);
    const maxOff = Math.max(dsR - SUN_R, 0);
    if (ds.offset.length() > maxOff){
      ds.offset.setLength(maxOff);
      ds.vel.set(0, 0, 0);
      ds.collided = true;             // 內壁已撞上恆星: 殼會被摧毀 (此處僅停止並告警)
      renderDysonStats();
    }
    dsGroup.position.copy(ds.offset);
  } else {
    dr.angle += simDt * simSpeed * dr.omega;
    dr.t += simDt * simSpeed;
    drGroup.rotation.z = dr.angle;
    // 內軌 swarm 以自己的克卜勒角速度旋轉 (較快), 與外環相位持續漂移 ——
    // 這正是遮光公式取時間平均 (1-f) 的原因。擾動只作用於外環:
    // 對內軌施加擾動是另一回事, 此處不假裝它們會同步振盪。
    drSwarmGroup.rotation.z += simDt * simSpeed * dr.omegaInner;
    // κ = Ω: 振盪與軌道同頻, 有界且不衰減 (無耗散)
    drGroup.scale.setScalar(dr.amp > 0 ? 1 + dr.amp * Math.cos(dr.omega * dr.t + dr.phase) : 1);
  }
}

function dsStatsHTML(){
  const isShell = ds.mode === 'shell';
  const T = isShell ? dsShellTemp(ds.radiusAU) : drShellTemp(ds.radiusAU);
  const f = ds.cover;
  const blk = dsBlockFrac();
  const P = blk * DS_L * (1 - DS_ALBEDO);   // 殼=f·L; 環=f·(h/2)·L
  const optPct = dsOpticalFrac(T) * 100, leak = 1 - blk;
  const rows = t('ds.stats', {
    T: T.toFixed(0), lmax: (DS_WIEN / T * 1e6).toFixed(2),
    pW: P.toExponential(2), kard: (P / DS_KARD_II).toFixed(2),
    opt: optPct < 0.01 ? optPct.toFixed(4) : optPct.toFixed(2), leak: leak.toFixed(2),
  });
  // t() 的 \t 只是分隔符: 拆成 grid 的兩欄才能對齊 (pre-line 會把 \t 壓成單空格)
  const parts = rows.split('\n').map(ln => {
    const seg = ln.split('\t');
    return seg.length > 1
      ? `<span class="ds-l">${seg[0]}</span><span class="ds-v">${seg.slice(1).join(' ')}</span>`
      : `<span class="ds-full">${seg[0]}</span>`;
  });
  const ratioTxt = dsOpticalRatio(T).toExponential(1);
  if (isShell){
    if (ds.collided) parts.push(`<span class="ds-warn">${t('ds.warn.crash')}</span>`);
    else parts.push(`<span class="ds-warn">${t('ds.warn.instab')}</span>`);
  } else {
    parts.push(`<span class="ds-note">${t('ds.note.ring')}</span>`);
  }
  if (T > 2000) parts.push(`<span class="ds-warn">${t('ds.warn.material')}</span>`);
  parts.push(`<span class="ds-note">${ds.ir
    ? t('ds.note.ir',  { lmax: (DS_WIEN / T * 1e6).toFixed(2), ratio: DS_IR_RATIO })
    : t('ds.note.opt', { ratio: ratioTxt, leak: leak.toFixed(2) })}</span>`);
  // 光學模式下補上「能量去哪了」: 這是理解戴森球為何要用紅外搜尋的關鍵,
  // 光說「殼是黑的」會讓人以為能量消失了 (違反能量守恆)
  if (!ds.ir) parts.push(`<span class="ds-note">${t('ds.note.dark', { opt: optPct < 0.01 ? optPct.toFixed(4) : optPct.toFixed(2) })}</span>`);
  if (isShell && f > 0.999) parts.push(`<span class="ds-note">${t('ds.note.leak', { lmax: (DS_WIEN / T * 1e6).toFixed(2) })}</span>`);
  return parts.join('');
}
function renderDysonStats(){
  const el = $('dsStats');
  if (el) el.innerHTML = ds.on ? dsStatsHTML() : '';
}
function dsSetEnabled(){
  $('tDyson').setAttribute('aria-pressed', String(ds.on));
  $('tDyson').classList.toggle('on', ds.on);
  $('dsIR').setAttribute('aria-pressed', String(ds.ir));
  $('dsIR').classList.toggle('on', ds.ir);
  document.querySelectorAll('.ds-ctl, #dsPerturb, #dsIR').forEach(el => el.classList.toggle('ds-off', !ds.on));
  $('dsStats').style.display = ds.on ? '' : 'none';
  dsSyncLabels();
  renderDysonStats();
}
// 半徑標籤依模式換詞 (殼半徑 / 環半徑)。不用全域 applyStatic():
// 它會重套所有 [data-i18n], 在載入早期可能蓋掉進度文字。
function dsSyncLabels(){
  const lbl = $('dsRadLabel');
  if (lbl) lbl.textContent = t(ds.mode === 'shell' ? 'dyson.radius' : 'dyson.radiusRing');
}

$('dsMode').addEventListener('change', e => {
  ds.mode = e.target.value;
  // 切換型態 = 重建結構並重置擾動狀態 (殼的漂移與環的振盪互不適用)
  ds.offset.set(0,0,0); ds.vel.set(0,0,0); ds.collided = false;
  dr.amp = 0; dr.t = 0;
  if (ds.on) dsApply();
  dsSetEnabled();
  armUiIdle();
});

$('tDyson').addEventListener('click', () => {
  const wasShell = ds.mode === 'shell';
  ds.on = !ds.on;
  if (!ds.on){ ds.offset.set(0,0,0); ds.vel.set(0,0,0); ds.collided = false; dr.amp = 0; }
  dsApply();                                    // 先重建幾何/顏色 (遮蔽會被設成目標值)
  // 關閉時必須讓「原本可見的那個群組」留在畫面上跑完淡出,
  // 否則 dsApply 已把它隱藏, fadeTo 的透明度動畫就沒人看得到
  if (!ds.on){ dsGroup.visible = wasShell; drGroup.visible = !wasShell; drSwarmGroup.visible = !wasShell; }
  const from = ds.on ? 0 : 1, to = ds.on ? 1 : 0;
  dsSetFade(from);                              // 再覆寫回起點: 否則關閉時恆星會瞬間跳回全亮, 漸變失去意義
  fadeTo('dyson', v => dsSetFade(v), from, to, 220,
    () => { if (!ds.on){ dsGroup.visible = false; drGroup.visible = false; drSwarmGroup.visible = false; dsSetFade(0); } });
  dsSetEnabled();
  armUiIdle();
});
$('dsIR').addEventListener('click', () => {
  if (!ds.on) return;
  ds.ir = !ds.ir;
  dsApply(); dsSetEnabled();
  armUiIdle();
});
$('dsPerturb').addEventListener('click', () => {
  if (!ds.on) return;
  dsPerturb(0.9);
  dsSetEnabled();
  armUiIdle();
});
$('dsCover').addEventListener('input', e => {
  ds.cover = parseFloat(e.target.value);
  $('dsCoverVal').textContent = Math.round(ds.cover * 100) + '%';
  if (ds.on) dsApply();
  renderDysonStats();
  armUiIdle();
});
$('dsRadius').addEventListener('input', e => {
  ds.radiusAU = parseFloat(e.target.value);
  $('dsRadVal').textContent = ds.radiusAU.toFixed(2) + ' AU';
  if (ds.on){ dsApply(); dsGroup.position.copy(ds.offset); ds.collided = false; ds.vel.set(0,0,0); ds.offset.set(0,0,0); dr.amp = 0; }
  renderDysonStats();
  armUiIdle();
});
dsSetEnabled();   // 初始: 按鈕關閉, 滑桿與讀數停用

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
  if (p._rsU){                                   // 解析式環影: 每幀更新太陽的物件空間位置
    p._rsU.sun.value.copy(v).negate().applyQuaternion(p._rsQinv);
    const tex = (o.ring && o.ring.userData.ringTex) || null;
    const on = tex ? 1 : 0;
    if (p._rsU.on.value !== on){ p._rsU.on.value = on; p._rsU.tex.value = tex; }
  }
  // 自轉: 真實週期比, 但視覺上限速。0.2 年/秒 × 365 轉/年 = 73 轉/秒,
  // 遠超畫面更新率 -> 紋理閃爍。以 dt 積分並鉗制在 0.8 轉/秒以內 (保留逆行符號)。
  const spinYr = p.spinHr / (24 * 365.25);
  const MAX_SPD = 0.8 * TWO_PI;                      // rad/s
  let w = TWO_PI * simSpeed / spinYr;
  if (w > MAX_SPD) w = MAX_SPD; else if (w < -MAX_SPD) w = -MAX_SPD;
  p._spin = (p._spin || 0) + dt * w;
  o.mesh.rotation.y = p._spin;
  // 木星差速自轉: 剪切量與自轉同源 (用 p._spin, 不用 simTime) —— 兩者同比例,
  // 暫停時同時凍結, 高速時同時受 MAX_SPD 限速 => 不會與地表剛體自轉脫拍。
  if (jupiterDiffShader && p.name === '木星'){
    jupiterDiffShader.uniforms.uDiffTime.value = p._spin;
    // 差速偏移會使取樣 u 越出 [0,1] => 必須 RepeatWrapping, 否則條紋在接縫處被
    // clamp 拉成直紋。放在每幀 (而非只在載入時) 是因為 reloadTextures/程序化降級
    // 會重新指派 map; needsUpdate 只在 wrap 真的改變時設一次, 不觸發重上傳。
    const mp = o.mesh.material.map;
    if (mp && mp.wrapS !== THREE.RepeatWrapping){ mp.wrapS = THREE.RepeatWrapping; mp.needsUpdate = true; }
  }
  // 冥王星–凱龍雙體: 潮汐互鎖 ⇒ 兩者自轉週期 = 公轉週期 = 6.387 天。
  // 實作: 旋轉 pivot (公轉) 即可, 兩球在 pivot 內【不自轉】 ⇒ 同一面永遠朝向對方。
  // 故冥王星本體不能再套用 o.mesh.rotation.y = p._spin (那會破壞互鎖) — 回退之。
  // 角速度同以 MAX_SPD 限速 (與行星自轉、月球軌道一致, 避免高速下紋理閃爍)。
  if (o.bin){
    let wb = TWO_PI * simSpeed / o.bin.periodYr;
    if (wb > MAX_SPD) wb = MAX_SPD; else if (wb < -MAX_SPD) wb = -MAX_SPD;
    o.bin.angle += dt * wb;
    o.bin.pivot.rotation.y = o.bin.angle;
    o.mesh.rotation.y = 0;                    // 潮汐互鎖: 相對於 pivot 不自轉
  }
  if (p._clouds) p._clouds.rotation.y = p._spin * 1.5;       // 雲層略快於地表
  if (p._moonPivot){                                          // 月球軌道同限速: 0.0748 年週期@0.2 = 2.7 轉/秒
    let wm = TWO_PI * simSpeed / 0.0748;
    if (wm > MAX_SPD) wm = MAX_SPD;
    p._moonPhase = (p._moonPhase || 0) + dt * wm;
    p._moonPivot.rotation.y = p._moonPhase;
  }
  // 伽利略/土星衛星: 真實週期比 ⇒ 拉普拉斯共振 (4:2:1) 自動成立。
  // 衛星在 pivot 框架內不自轉 ⇒ 潮汐鎖定 (同一面永遠朝向宿主)。
  if (o.moons) for (const mo of o.moons){
    mo.pivot.rotation.y = mo.M0 + TWO_PI * simTime / mo.periodYr;
    if (mo.plumeMat) mo.plumeMat.uniforms.uTime.value = simTime;   // 噴羽動畫走 simTime
  }
}

let lensSmooth = 2.5;          // 透鏡強度包絡 (L12: 開關時淡入淡出而非瞬變)
const _desired = new THREE.Vector3();

// 分頁隱藏時停掉 rAF: 這個場景每幀都在跑 bloom + 12 顆行星 + 標籤, 背景全速執行
// 只會白燒電池與 CPU, 使用者卻完全看不到。恢復時不補幀 —— dt 本來就夾在 0.05,
// 不會因為中斷而讓時間跳一大段。
let rafId = 0;
function startLoop(){ if (!rafId && !document.hidden) rafId = requestAnimationFrame(animate); }
function stopLoop(){ if (rafId){ cancelAnimationFrame(rafId); rafId = 0; } }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop(); else { clock.getDelta(); startLoop(); } // 丟棄隱藏期間累積的時間
});
function animate(){
  rafId = requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) simTime += dt * simSpeed;
  const simDt = paused ? 0 : dt;

  // 兩套系統互斥: 只推進當前系統的時間/位置, 另一套凍結 (不可見也不耗 CPU)。
  if (SYSTEM === 'trap'){
    stepFades();
    if (!paused) trapStep(dt);
    starMat.uniforms.uTime.value = simTime;   // 星空背景兩系統共用 (恆在場)
    trapAnimateTail(dt);
    return;
  }

  // 行星 (暫停時不積分自轉)
  for (const o of planetObjs) updatePlanet(o, simDt);
  stepFades();
  dsStep(simDt);
  cometStep();
  beltStep();

  // 太陽 / 星空 / 吸積盤 動畫
  sunUniforms.uTime.value = simTime;
  dsUniforms.uTime.value = simTime;   // 結構照明動畫 (人造光源, 與 simTime 同步)
  drUniforms.uTime.value = simTime;
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
  // 蟲洞軌道 (與黑洞反向傾斜, 避免兩者在畫面上長期重疊)
  if (whOn) {
    WH.angle += dt * simSpeed * (TWO_PI / WH.periodYr);
    WH.pos.set(
      WH.R * Math.cos(WH.angle),
      WH.R * Math.sin(WH.angle) * Math.sin(WH.incl),
      WH.R * Math.sin(WH.angle) * Math.cos(WH.incl)
    );
    WH.group.position.copy(WH.pos);
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

  // 土星環視角相關亮度 (僅太陽系模式): 相位角 = 環處 (太陽↔環↔相機) 的夾角。
  // 相機已在本幀定格 (controls.update 在上方), 故此時算相位角與畫面一致。
  // 衝日 (α→0) 與背光 (α→180°) 兩個增亮峰; 拖動視角時環的亮度會平滑變化。
  for (const o of planetObjs){
    if (!o.data._ringBrightU) continue;
    o.obj.getWorldPosition(_sv);                     // 復用 _sv 暫存 (下方未再用它)
    const ph = ringPhaseAngle(_sv, camera.position);
    o.data._ringBrightU.value = ringBrightness(ph);
  }

  // 地球夜面閃電 (僅太陽系模式): 需把「地球→太陽」的世界方向換算進雲層【區域】
  // 框架 (sprite 位置在雲層區域座標), 才能判定哪些點在夜面。雲層隨自轉,
  // 故區域太陽方向每幀變 —— 這正是「夜面隨自轉移動」的物理。
  if (earthLightning && planetObjs[2].data._clouds){
    const clouds = planetObjs[2].data._clouds;
    clouds.getWorldPosition(_sv);                    // 雲層世界座標 (= 地球位置)
    _sv.negate().normalize();                        // 地球 -> 太陽 (太陽在世界原點)
    clouds.getWorldQuaternion(_lgQ);
    _sv.applyQuaternion(_lgQ.invert());              // 世界方向 -> 雲層區域方向
    earthLightning.sunDirLocal.copy(_sv);
    lightningUpdate(earthLightning, simDt);
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

  // 蟲洞透鏡: 同樣投影到螢幕空間, 強度平滑。與黑洞 pass 獨立, 兩者不共用 uniform。
  const wantWh = (lensOn && whOn) ? 2.2 : 0;
  whSmooth += (wantWh - whSmooth) * damp(12.0, dt);
  if (whSmooth < 0.001) whSmooth = 0;
  let whProjected = false;
  if (whSmooth > 0.001 && whOn) {
    const view = _tmpV.copy(WH.pos).applyMatrix4(camera.matrixWorldInverse);
    if (view.z < 0) {
      const ndc = _tmpV.copy(WH.pos).project(camera);
      whLensingPass.uniforms.whUV.value.set(ndc.x*0.5+0.5, ndc.y*0.5+0.5);
      const dist = camera.position.distanceTo(WH.pos);
      const fov = camera.fov * DEG;
      whLensingPass.uniforms.whRadius.value = (WH.throatR / dist) / (2 * Math.tan(fov/2));
      whProjected = true;
    }
  }
  whLensingPass.uniforms.strength.value = whProjected ? whSmooth : 0;

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
  whLensingPass.uniforms.aspect.value = innerWidth / innerHeight;
  starMat.uniforms.uPixel.value = renderer.getPixelRatio();
  for (const m of beltMats) m.uniforms.uPixel.value = renderer.getPixelRatio();
});

// =============================================================================
//  換語言: 重繪所有「由 main.js 寫入」的動態文字
//  (index.html 的 data-i18n 靜態部分由 applyStatic() 負責, 這裡只補它看不到的)
// =============================================================================
function renderDynamicUI(){
  // 1. 3D 標籤 (行星顯示名 + 黑洞)
  for (const o of planetObjs) if (o.labelEl) o.labelEl.textContent = pname(o.data.name);
  if (BH.label && BH.label.element) BH.label.element.textContent = t('label.bh');
  if (WH.label && WH.label.element) WH.label.element.textContent = t('label.wh');
  if (COMET.label && COMET.label.element) COMET.label.element.textContent = t('label.comet');
  // 2. 鏡頭追蹤選單: 只改 text, value (索引) 不動 → 選中項不會被刷掉
  //    (focusOptions 只含太陽系行星; TRAPPIST 選項為拉丁字母名稱, 與語言無關)
  for (const f of focusOptions) f.opt.textContent = pname(f.name);
  // 3. 目前狀態相關的即時文字
  updateSpeedLabel();   // 依系統顯示「年/秒」或「天/秒」
  const pb = $('pause');
  pb.textContent = paused ? t('btn.play') : t('btn.pause');
  // 4. 載入進度 (若已淡出, renderLoaderTex 自行 return)
  renderLoaderTex();
  renderDysonStats();   // 換語言時物理讀數也要重新取詞
  renderWhNote();       // 蟲洞說明同樣要重新取詞
  renderTrapNote();     // TRAPPIST 說明同樣要重新取詞
  dsSyncLabels();       // 殼/環的半徑標籤也要跟著換語言
}
window.addEventListener('langchange', renderDynamicUI);
renderDynamicUI(); // 初始同步: index.html 的預置文字一律是中文, 語言為 en 時靠這裡轉正
// 系統切換的初始化: 建焦點尾端 (太陽系行星) + 同步標籤可見性 (SYSTEM='solar' 預設)。
// 必須在 renderDynamicUI() 之後: 兩者都操作 focusSelect, 順序一致才不會互蓋。
rebuildFocusTail();
syncSystemLabels();

// 啟動: 等初始貼圖批次載入完成再淡出載入覆蓋層 (M4)
window.__universeReady = true;
const loaderEl = document.getElementById('loader');
async function hideLoader(){
  const jobs = [];
  for (const p of PLANETS){
    if (p._upg) jobs.push(p._upg);
    if (p._upgC) jobs.push(p._upgC);      // 冥王星–凱龍雙體伴星
    if (p._ringUpg) jobs.push(p._ringUpg);
    if (p._moonUpg) jobs.push(p._moonUpg);
    if (p._moons) for (const mo of p._moons) jobs.push(mo.upg);
  }
  try { await Promise.all(jobs); } catch (e){ /* 單檔失敗已在 loadTex 內處理 */ }
  if (window.__universeError) return; // 錯誤覆蓋層優先, 不得被淡出蓋掉
  loaderEl.classList.add('done');
  armUiIdle();  // 載入結束才開始算「閒置」: 載入期間計時沒有意義, 只會讓面板一出現就消失
  if (!legendDismissed) armLegendIdle();  // 圖例同理, 載入完才開始倒數
  loaderEl.addEventListener('transitionend', () => { loaderEl.style.display = 'none'; }, { once: true });
  setTimeout(() => { loaderEl.style.display = 'none'; }, 400); // 保底: transitionend 未觸發時也會移除
}
startLoop();
hideLoader();
