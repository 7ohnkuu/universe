#!/usr/bin/env node
// 離線修復 4k_saturn.jpg / 8k_saturn.jpg / saturn.jpg 的北極偽影帶。
//
// 背景: 來源貼圖 (solarsystemscope) 北極區 (約緯度 77°N 以北) 是一塊灰綠斑駁的
//       偽影帶 —— 不是土星北極真實樣貌 (真實北極是金黃色六角風暴)。土星軸傾
//       26.73° 使北極常年朝向觀者, 偽影帶於是在盤面顯現為灰斑。
//
// 修復: 偵測偽影帶下邊界 B (列平均色調由灰綠 R−G<0 轉為黃褐 R−G>0 之處),
//       再以 B 以下的乾淨列「拉伸取樣」覆蓋 [0, B] (y=B 處連續, 無接縫),
//       最後對覆蓋區做垂直方向輕微平滑, 消除列複製產生的橫紋。
//
// 此腳本冪等: 已修復的貼圖偵測不到偽影帶 (B<=0) 即不動作。
// 執行: node scripts/fix-saturn-pole.mjs
//       需可解析 puppet-core 瀏覽器驅動 (puppeteer-core 或 playwright-core);
//       本 repo 無 node_modules, 於含驅動的環境以 symlink 或 bundler 執行即可。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGETS = ['textures/4k_saturn.jpg', 'textures/saturn.jpg']; // 8k 為 4k 的逐字副本

async function launch() {
  for (const mod of ['puppeteer-core', 'playwright-core']) {
    try {
      const m = await import(mod);
      const lib = m.default ?? m;
      const browser = lib.chromium
        ? await lib.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
        : await lib.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
      return browser;
    } catch { /* 試下一個驅動 */ }
  }
  console.error('  ✗ 找不到 puppeteer-core / playwright-core, 無法執行離線修復');
  process.exit(1);
}

const browser = await launch();
const page = await browser.newPage();
await page.goto('about:blank');

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  const b64in = fs.readFileSync(file).toString('base64');
  const out = await page.evaluate(async (b64in) => {
    const img = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64in)).blob());
    const w = img.width, h = img.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    // 列平均色調: 灰綠 (R−G<0) = 偽影; 黃褐 (R−G>0) = 乾淨
    const tone = y => {
      const d = g.getImageData(0, y, w, 1).data;
      let r = 0, gg = 0, n = 0;
      for (let x = 0; x < w; x += 4) { r += d[x * 4]; gg += d[x * 4 + 1]; n++; }
      return r / n - gg / n;
    };
    let clean = -1;
    const lim = Math.round(h * 0.25);
    for (let y = 0; y < lim; y++) { if (tone(y) > 2) { clean = y; break; } }
    const B = clean - 1;
    if (B <= 0) return { w, h, B, out: null };
    // 以 B 以下乾淨列拉伸覆蓋 [0, B]
    const srcH = Math.min(h, B + Math.round(B * 0.75) + 2);
    const src = g.getImageData(0, 0, w, srcH);
    const dst = g.getImageData(0, 0, w, B + 1);
    for (let y = 0; y <= B; y++) {
      let sy = B + Math.round((B - y) * 0.75);
      if (sy >= srcH) sy = srcH - 1;
      dst.data.set(src.data.subarray(sy * w * 4, (sy + 1) * w * 4), y * w * 4);
    }
    // 垂直平滑 (半徑 3, 僅 y 方向) 消除列複製橫紋
    const sm = g.createImageData(w, B + 1);
    for (let y = 0; y <= B; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, gg = 0, bb = 0, n = 0;
        for (let k = -3; k <= 3; k++) {
          const sy = Math.min(B, Math.max(0, y + k));
          const i = (sy * w + x) * 4;
          r += dst.data[i]; gg += dst.data[i + 1]; bb += dst.data[i + 2]; n++;
        }
        const o = (y * w + x) * 4;
        sm.data[o] = r / n; sm.data[o + 1] = gg / n; sm.data[o + 2] = bb / n; sm.data[o + 3] = 255;
      }
    }
    g.putImageData(sm, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
    const u = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    return { w, h, B, out: btoa(s) };
  }, b64in);
  if (!out.out) { console.log(`  ${rel}: 未偵測到偽影帶, 不動作`); continue; }
  const buf = Buffer.from(out.out, 'base64');
  fs.writeFileSync(file, buf);
  if (rel.endsWith('4k_saturn.jpg')) fs.writeFileSync(path.join(ROOT, 'textures/8k_saturn.jpg'), buf); // 8k 為 4k 副本
  console.log(`  ${rel}: ${out.w}x${out.h}  偽影帶 y∈[0,${out.B}] 已覆蓋 → ${buf.length} bytes`);
}
await browser.close();
