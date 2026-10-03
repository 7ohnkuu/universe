#!/usr/bin/env node
// ============================================================================
//  產生 scripts/simp-chars.txt —— 給 check-lang.mjs 使用的簡體字庫。
//
//  只在維護端執行 (需網路, 抓 Unicode 官方 Unihan)。產物提交進倉庫,
//  於是 CI 端完全離線, 而稽核腳本本身不必含任何簡體字面字。
//
//  推導分兩層:
//
//  第一層 · 自動 (Unihan ∩ Big5)
//    1. kTraditionalVariant 標記「此字是某繁體字的簡化形」
//    2. 若此字也出現在自己的傳統清單內 → 繁簡共用同一字形, 豁免。
//       例: U+7CFB 同時是「關係/系統」的正字; U+81F4 是「一致」的正字。
//       少了這條規則, 注釋裡的「系統」「一致」會被大量誤判。
//    3. 再用 Big5/CP950 過濾: 台灣標準編碼容得下的字一律豁免 (寧漏不誤)
//
//  第二層 · 人工疊加 OVERLAY
//    第一層的規則 2 會放走一批「Unihan 自指、但現代繁體實務上視同簡體」的字,
//    如 U+5B9E (正字 實)、U+9009 (正字 選)、U+9690 (正字 隱)。
//    一律以「碼位 → 正字碼位」書寫, 不寫字面字, 好讓本檔案不被自己攔下。
//
//  兩層跑完後做反向驗證: 正規繁體字若被誤收, 立刻失敗。
// ============================================================================
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'scripts', 'simp-chars.txt');
const SRC = 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip';

const U = c => String.fromCodePoint(c);
const hex = c => 'U+' + c.toString(16).toUpperCase().padStart(4, '0');

// zip 內只有一檔要讀, 手解中央目錄即可, 不拉第三方依賴
async function unzipEntry(buf, want) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是有效 zip');
  let p = buf.readUInt32LE(eocd + 16);
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === want) {
      const method = buf.readUInt16LE(lho + 8);
      const csize = buf.readUInt32LE(lho + 20);
      const ln = buf.readUInt16LE(lho + 26), le = buf.readUInt16LE(lho + 28);
      const data = buf.slice(lho + 30 + ln + le, lho + 30 + ln + le + csize);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error('zip 內找不到 ' + want);
}

function codePoints(s) {
  return s.replace(/\|/g, ' ').split(/\s+/)
    .filter(t => /^U\+[0-9A-Fa-f]{4,6}$/.test(t))
    .map(t => String.fromCodePoint(parseInt(t.slice(2), 16)));
}

// 台灣編碼可容納的字元集合。
// 陷阱: 不可用 TextEncoder —— Node 只實作 UTF-8, 傳入 'cp950' 會被無聲忽略,
// 於是每個字都「可編碼」, 推導出空字庫, 檢查就放過一切。
// TextDecoder('big5') 走 WHATWG Encoding Standard 的 Big5 索引, 才是權威依據,
// 所以反向枚舉所有雙位元組組合來建立集合。
function big5CodePoints() {
  const d = new TextDecoder('big5', { fatal: false });
  const one = (bytes) => {
    const s = d.decode(Buffer.from(bytes));
    return s && s.length === 1 && s.codePointAt(0) !== 0xfffd ? s.codePointAt(0) : null;
  };
  const set = new Set();
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo >= 0x7f && lo <= 0xa0) continue;      // Big5 跳開 0x7F–0xA0
      const cp = one([hi, lo]);
      if (cp !== null) set.add(cp);
    }
  }
  return set;
}

// [簡體碼位, 正字碼位] —— 規則 2 的自指豁免所漏掉者
const OVERLAY = [
  [0x5b9e, 0x5be6], [0x786e, 0x78ba], [0x6ca1, 0x6c92], [0x7740, 0x8457],
  [0x8fd9, 0x9019], [0x4e0e, 0x8207], [0x5220, 0x522a], [0x590d, 0x5fa9],
  [0x51cf, 0x6e1b], [0x52a8, 0x52d5], [0x5355, 0x55ae], [0x4e49, 0x7fa9],
  [0x51e4, 0x9cf3], [0x5218, 0x5289], [0x9690, 0x96b1], [0x9009, 0x9078],
  [0x65f6, 0x6642], [0x5c5e, 0x5c6c], [0x533a, 0x5340], [0x5185, 0x5167],
];

// 必須「不」在清單內的正規繁體字 / 繁簡共字。收錯了就代表檢查會大面積誤判。
const MUST_NOT = [
  0x7dda, 0x7cfb, 0x81f4, 0x4e7e, 0x4e8e, 0x7684, 0x7528, 0x7403, // 線 系 致 乾 于 的 用 球
  0x81fa, 0x88cf, 0x6597, 0x56de, 0x523b, 0x57df, 0x8c61, 0x5cf0, // 臺 裏 斗 回 刻 域 象 峰
  0x6e1b, 0x9078, 0x96b1, 0x6642, 0x55ae, 0x5167,                 // 減 選 隱 時 單 內 (正字本身)
];

const res = await fetch(SRC);
if (!res.ok) throw new Error('下載失敗 HTTP ' + res.status);
const text = await unzipEntry(Buffer.from(await res.arrayBuffer()), 'Unihan_Variants.txt');
const BIG5 = big5CodePoints();
if (BIG5.size < 10000) throw new Error(`Big5 枚舉僅 ${BIG5.size} 字, 環境可能不支援 TextDecoder("big5")`);

const set = new Set();
let exemptSame = 0, exemptBig5 = 0;
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#') || !line.includes('\tkTraditionalVariant\t')) continue;
  const [cpRaw, , val] = line.split('\t');
  const cp = parseInt(cpRaw.slice(2), 16);
  if (cp < 0x4e00 || cp > 0x9fff) continue;
  const trads = codePoints(val);
  if (!trads.length) continue;
  if (trads.includes(U(cp))) { exemptSame++; continue; }   // 繁簡同形
  if (BIG5.has(cp)) { exemptBig5++; continue; }            // 台灣編碼容納
  set.add(cp);
}
let added = 0;
for (const [simplified, traditional] of OVERLAY) {
  if (!set.has(simplified)) { set.add(simplified); added++; }
}

// ---- 自我驗證 ----
for (const [simplified] of OVERLAY) {
  if (!set.has(simplified)) fail(`疊加項 ${hex(simplified)} 未進入清單`);
}
for (const cp of MUST_NOT) {
  if (set.has(cp)) fail(`正規繁體字 ${U(cp)} ${hex(cp)} 被誤歸為簡體 —— 檢查會大量誤判`);
}
if (set.size < 1500) fail(`推導結果僅 ${set.size} 字, 疑似資料異常`);

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

const sorted = [...set].sort((a, b) => a - b);
const header = [
  '# 簡體專屬字庫 —— 由 scripts/gen-simp-chars.mjs 自 Unicode Unihan + Big5 推導。',
  '# 請勿手改; 重新產生: node scripts/gen-simp-chars.mjs (需網路)',
  '# 用途: scripts/check-lang.mjs 讀它稽核專案中的中文是否為繁體 (zh-TW)。',
  '# 一行一字。# 開頭為註解。空行忽略。',
].join('\n');
await writeFile(OUT, header + '\n' + sorted.map(c => U(c)).join('\n') + '\n', 'utf8');

console.log(`寫入 ${path.relative(ROOT, OUT)}: ${sorted.length} 字`);
console.log(`  豁免 繁簡同形 ${exemptSame} / Big5 可編 ${exemptBig5}; 人工疊加補回 ${added}`);
