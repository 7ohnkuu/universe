#!/usr/bin/env node
// 離線產製 textures/pluto.jpg 與 textures/charon.jpg。
//
// 來源 (皆 NASA New Horizons, 公有領域, 經 Wikimedia Commons):
//   Pluto  : File:Pluto color mapmosaic.jpg   (5926x2963, 真等距圓柱全球彩色鑲嵌)
//   Charon : File:Charon map iau1803c.jpg     (6000x3000, 真等距圓柱全球鑲嵌, 無標註版)
// 兩圖南極皆為飛掠未拍攝的缺資料黑區 —— 本腳本以「每行最後資料列拉伸 +
// 區域平滑」補齊 (與 fix-saturn-pole.mjs 同一哲學), 避免球面出現黑洞。
//
// 輸入檔請先置於 /tmp (或環境變數 PLUTO_SRC / CHARON_SRC 指定路徑)。
// 執行: node scripts/gen-pluto-textures.mjs
//       需可解析 puppeteer-core / playwright-core (本 repo 無 node_modules)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 2048, H = 1024;                       // 輸出解析度 (與倉庫其他單解析度衛星貼圖同級)
const JOBS = [
  { src: process.env.PLUTO_SRC  || '/tmp/pluto_map.jpg',  out: 'textures/pluto.jpg'  },
  { src: process.env.CHARON_SRC || '/tmp/charon_map.jpg', out: 'textures/charon.jpg' },
];

async function launch() {
  for (const mod of ['puppeteer-core', 'playwright-core']) {
    try {
      const m = await import(mod);
      const lib = m.default ?? m;
      return lib.chromium
        ? await lib.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
        : await lib.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    } catch { /* 試下一個驅動 */ }
  }
  console.error('  ✗ 找不到 puppeteer-core / playwright-core');
  process.exit(1);
}

const browser = await launch();
const page = await browser.newPage();
await page.goto('about:blank');

for (const job of JOBS) {
  const b64in = fs.readFileSync(job.src).toString('base64');
  const out = await page.evaluate(async (b64in, W, H) => {
    const img = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64in)).blob());
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const im = g.getImageData(0, 0, W, H), d = im.data;
    const lum = i => (d[i] + d[i + 1] + d[i + 2]) / 3;
    // 1) 每行找最下方的資料列 (亮度>20), 其下缺資料區以該列色拉伸補齊
    let filled = 0;
    const bound = new Int32Array(W).fill(H);   // 每行資料/補齊分界 (補齊區起點)
    for (let x = 0; x < W; x++) {
      let yb = -1;
      for (let y = H - 1; y >= 0; y--) { if (lum((y * W + x) * 4) > 20) { yb = y; break; } }
      if (yb < 0 || yb >= H - 1) continue;
      bound[x] = yb + 1;
      // 取色: 從 yb 往上找第一個夠亮的列 (避開鑲嵌黑縫), 再平均 3 列降雜訊
      let ys = yb;
      while (ys > 0 && lum((ys * W + x) * 4) < 40) ys--;
      const acc = [0, 0, 0]; let n = 0;
      for (let y = Math.max(0, ys - 2); y <= ys; y++) { const i = (y * W + x) * 4; acc[0] += d[i]; acc[1] += d[i + 1]; acc[2] += d[i + 2]; n++; }
      for (let y = yb + 1; y < H; y++) {
        const i = (y * W + x) * 4;
        d[i] = acc[0] / n; d[i + 1] = acc[1] / n; d[i + 2] = acc[2] / n;
        filled++;
      }
    }
    // 2) 補齊區改以【梯度插值】著色: 邊界色 (橫向平滑後) 隨深度漸變到
    //    極區平均色 —— 無列條紋; 真實資料區 (撞擊坑) 不動
    const RX = 48;
    const src = new Uint8ClampedArray(d);
    // 2a) 邊界色橫向平滑 (環狀捲繞)
    const bc = new Float32Array(W * 3);
    for (let x = 0; x < W; x++) {
      let r = 0, gg = 0, bb = 0, n = 0;
      for (let dx = -RX; dx <= RX; dx += 2) {
        const sx = (x + dx + W) % W;
        const sy = Math.max(0, bound[sx] - 1);
        const i = (sy * W + sx) * 4;
        r += src[i]; gg += src[i + 1]; bb += src[i + 2]; n++;
      }
      bc[x * 3] = r / n; bc[x * 3 + 1] = gg / n; bc[x * 3 + 2] = bb / n;
    }
    // 2b) 極區平均色 (邊界色的環狀平均)
    let gr = 0, ggg = 0, gb = 0;
    for (let x = 0; x < W; x++) { gr += bc[x * 3]; ggg += bc[x * 3 + 1]; gb += bc[x * 3 + 2]; }
    gr /= W; ggg /= W; gb /= W;
    // 2c) 補齊區: mix(邊界色, 極區平均, 0.75*t)
    for (let x = 0; x < W; x++) {
      const depth = H - bound[x];
      if (depth <= 0) continue;
      for (let y = bound[x]; y < H; y++) {
        const t = (y - bound[x]) / depth;
        const k = 0.75 * t;
        const i = (y * W + x) * 4;
        d[i]     = bc[x * 3]     * (1 - k) + gr  * k;
        d[i + 1] = bc[x * 3 + 1] * (1 - k) + ggg * k;
        d[i + 2] = bc[x * 3 + 2] * (1 - k) + gb  * k;
      }
    }
    // 2d) 邊界接縫上下 3 列輕微 box 平滑 (半徑 3), 消除硬邊
    const src2 = new Uint8ClampedArray(d);
    for (let x = 0; x < W; x++) {
      const ya = Math.max(0, bound[x] - 3), yb2 = Math.min(H - 1, bound[x] + 3);
      for (let y = ya; y <= yb2; y++) {
        let r = 0, gg = 0, bb = 0, n = 0;
        for (let dy = -3; dy <= 3; dy++) {
          const sy = Math.min(H - 1, Math.max(0, y + dy));
          for (let dx = -3; dx <= 3; dx++) {
            const sx = (x + dx + W) % W;
            const i = (sy * W + sx) * 4;
            r += src2[i]; gg += src2[i + 1]; bb += src2[i + 2]; n++;
          }
        }
        const i = (y * W + x) * 4;
        d[i] = r / n; d[i + 1] = gg / n; d[i + 2] = bb / n;
      }
    }
    g.putImageData(im, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
    const u = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    return { filled, out: btoa(s) };
  }, b64in, W, H);
  const buf = Buffer.from(out.out, 'base64');
  fs.writeFileSync(path.join(ROOT, job.out), buf);
  console.log(`  ${job.out}: ${W}x${H}  補齊 ${out.filled} px  → ${buf.length} bytes`);
}
await browser.close();
