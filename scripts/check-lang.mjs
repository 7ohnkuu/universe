#!/usr/bin/env node
// ============================================================================
//  簡體字稽核 —— 注釋、文案與文件必須是繁體中文 (zh-TW)。
//
//  為什麼不寫死一份字表: 人工清單永遠會漏。本專案前後踩過好幾次,
//  漏網的都是同類 —— 註釋裡一個手慣的簡體字:
//    U+7EBF / U+9690 / U+9009  (各自對應的正字見 simp-chars.txt 的產生器)
//  每次補幾個, 下波照漏 —— 直到把規則寫成程式。改由
//  scripts/gen-simp-chars.mjs 從 Unicode Unihan ∩ Big5 推導出
//  scripts/simp-chars.txt, 提交進倉庫, 所以這裡不需要網路。
//
//  本檔案刻意不寫任何簡體字面字 —— 它會被自己檢查 (見 SCAN)。
//  需要引用具體字例時, 一律寫碼位註解。
//
//  注意: 「繁簡同形」的正規繁體字 (U+7CFB 系統、U+81F4 一致、U+4E7e 乾坤、
//  U+6597 北斗、U+56de 回頭) 已被推導規則豁免, 不會在這裡被誤判。
// ============================================================================
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = path.join(ROOT, 'scripts', 'simp-chars.txt');

// 稽核範圍: 所有含中文的原始檔與文件。
//  只排除 simp-chars.txt —— 它是資料檔, 內容必然全是簡體字。
//  其餘腳本 (含產生器與本檔) 舉例時一律寫碼位, 因此能被自己稽核。
//  不在清單: vendor/ 與 textures/ —— 第三方程式與二進位貼圖。
const SCAN = [
  'index.html', 'main.js', 'i18n.js', 'README.md', 'LICENSE',
  'vercel.json', '.vercelignore', '.gitignore',
  '.github/workflows/ci.yml',
  'scripts/check-i18n.mjs', 'scripts/check-assets.mjs', 'scripts/check-lang.mjs',
  'scripts/gen-simp-chars.mjs', 'scripts/fetch-textures.sh',
];
const SELF_EXCLUDE = new Set(['scripts/simp-chars.txt']);

if (!existsSync(LIST)) {
  console.error('FAIL: 缺少 scripts/simp-chars.txt —— 執行 node scripts/gen-simp-chars.mjs 產生');
  process.exit(1);
}
const raw = await readFile(LIST, 'utf8');
const chars = raw.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
// 檔案採一行一字; 若有人把它壓成整串, 也要能展開
const set = new Set(chars.flatMap(s => Array.from(s)));
if (set.size < 1000) {
  console.error(`FAIL: simp-chars.txt 僅收錄 ${set.size} 字, 疑似被截斷或清空`);
  process.exit(1);
}

// plans/ 是設計備忘, 同樣以繁體書寫, 一併檢查
let planFiles = [];
try {
  planFiles = (await readdir(path.join(ROOT, 'plans')))
    .filter(f => f.endsWith('.md'))
    .map(f => 'plans/' + f);
} catch { /* 目錄不存在就跳過 */ }

const files = [...SCAN, ...planFiles].filter(f => !SELF_EXCLUDE.has(f));

function hex(ch) { return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'); }

let bad = 0, scanned = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    // 清單裡的檔案遺失 = 稽核範圍本身壞了, 不能默默放過
    console.error(`FAIL: 預設要檢查的檔案不存在: ${rel}`);
    bad++;
    continue;
  }
  scanned++;
  const text = await readFile(abs, 'utf8');
  const hits = new Map();
  text.split('\n').forEach((line, i) => {
    for (const ch of line) if (set.has(ch)) {
      if (!hits.has(ch)) hits.set(ch, []);
      hits.get(ch).push(i + 1);
    }
  });
  for (const [ch, rows] of hits) {
    console.error(`FAIL ${rel}:${rows[0]} — 簡體字「${ch}」(${hex(ch)}), 共 ${rows.length} 處: 第 ${rows.slice(0, 8).join(', ')} 行`);
    bad++;
  }
}

if (bad) {
  console.error(`\n✗ 簡體字稽核未通過: ${bad} 項 (字庫 ${set.size} 字)`);
  process.exit(1);
}
console.log(`OK: ${scanned} 檔未發現簡體字 (字庫 ${set.size} 字, 來源 Unihan∩Big5 推導)`);
