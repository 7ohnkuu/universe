// =============================================================================
//  check-assets.mjs — 驗證各解析度會引用到的貼圖檔案確實存在
//
//  為什麼需要: main.js 用字串組貼圖路徑 (prefix() + 名稱), 打錯一個字在執行期
//  只表現為「那顆行星變成程序化貼圖」+ 一行 console.warn —— 很容易長期沒發現。
//  本腳本把同樣的組路徑規則跑一遍, 直接檢查檔案。
//
//  ⚠ 下面的路徑規則必須與 main.js 的 planetDay() / earthTex() / ringTex() /
//    moonTex() 保持一致。改了那邊的命名, 這裡要同步 (兩邊都有註解提醒)。
//
//  8k 為选用 (未提交, 見 scripts/fetch-textures.sh) -> 缺檔只警告, 不讓 CI 紅。
//  2k / 4k 是倉庫自帶的, 缺任何一個就是錯。
// =============================================================================
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = rel => readFileSync(new URL(rel, root), 'utf8');

// --- 從 main.js 實際解析, 不複製資料表 (資料表改了這裡自動跟著變) ---------
const main = read('main.js');

const planetNames = [...main.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
if (planetNames.length !== 8) {
  console.error(`FAIL: 從 main.js 解析到 ${planetNames.length} 顆行星, 預期 8 — 請同步更新本腳本`);
  process.exit(1);
}

// planetDay() 裡的 base 對照表
const baseMapBlock = main.match(/const base = \{([^}]*)\}\[p\.name\];/);
if (!baseMapBlock) { console.error('FAIL: 找不到 planetDay() 的 base 對照表'); process.exit(1); }
const baseMap = Object.fromEntries(
  [...baseMapBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map(m => [m[1], m[2]]));

// 只有 2k 的行星 (main.js: 僅 2k)
const only2k = [...main.matchAll(/if \(p\.name === '([^']+)'\) return TEX_BASE \+ '([^']+)'; \/\/ 僅 2k/g)]
  .map(m => [m[1], m[2]]);

// 假 8k (木星/土星): main.js 以 fake8k 別名回 4k_
const fake8k = [...main.matchAll(/const fake8k = \(base === '(\w+)' \|\| base === '(\w+)'\)/g)]
  .flatMap(m => [m[1], m[2]]);

const earthOnly2k = ['earth_normal.jpg', 'earth_specular.jpg'];  // main.js: 僅 2k

// --- 依解析度組出會被引用的檔案 -------------------------------------------
const prefix = q => q === '8k' ? '8k_' : q === '4k' ? '4k_' : '';
const wanted = { '2k': new Set(), '4k': new Set(), '8k': new Set() };

for (const q of Object.keys(wanted)) {
  const pre = prefix(q);
  for (const name of planetNames) {
    const fixed = Object.fromEntries(only2k)[name];
    if (fixed) { wanted[q].add(fixed); continue; }              // 天王星/海王星: 永遠 2k
    const base = baseMap[name];
    if (!base) continue;                                        // 地球另有 earthTex()
    const isFake = fake8k.includes(base) && q === '8k';
    wanted[q].add(`${isFake ? '4k_' : pre}${base}.jpg`);
  }
  // 地球
  wanted[q].add(`${pre}earth_daymap.jpg`);
  wanted[q].add(`${pre}earth_clouds.jpg`);
  for (const f of earthOnly2k) wanted[q].add(f);
  // 環 / 衛星
  wanted[q].add(`${pre}saturn_ring_alpha.png`);
  wanted[q].add(`${pre}moon.jpg`);
}

let bad = 0;
for (const [q, files] of Object.entries(wanted)) {
  const missing = [...files].filter(f => !existsSync(new URL(`textures/${f}`, root)));
  const label = `${q.padStart(2)}: ${files.size} 檔`;
  if (!missing.length) { console.log(`OK   ${label}`); continue; }
  if (q === '8k') {
    console.log(`WARN ${label} — 缺 ${missing.length} 檔 (選用, 未提交; 跑 scripts/fetch-textures.sh 取得)`);
    continue;
  }
  bad = 1;
  console.error(`FAIL ${label} — 缺 ${missing.join(', ')}`);
}

if (bad) { console.error('\n倉庫自帶的 2k / 4k 貼圖不完整。'); process.exit(1); }
console.log('\nOK: 2k / 4k 全數就緒 (預設 4k 可直接執行)');
