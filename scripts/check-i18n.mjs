// =============================================================================
//  check-i18n.mjs — 驗證 zh-TW 與 en 兩本字典的 key 完全一致
//
//  為什麼需要: 字典缺 key 時 t() 會退回中文表 (不會崩潰), 所以「英文介面漏翻
//  一句」在執行期是**無聲的**。這是唯一能在 CI 抓到它的方法。
//
//  i18n.js 是給瀏覽器跑的 IIFE (碰 window / document / localStorage),
//  這裡用 vm + 最小 stub 把它跑起來, 再從 DICT 取 key。
//  不複製字典內容: 這樣字典改了, 這個檢查自動跟著變。
// =============================================================================
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');

// 最小 DOM stub: 只求 i18n.js 的頂層 IIFE 能跑完, 不模擬任何行為
const el = () => ({
  dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  setAttribute(){}, getAttribute(){ return null; }, appendChild(){},
  addEventListener(){}, querySelectorAll(){ return []; }, textContent: '', innerHTML: '',
});
const store = new Map();

const document = {
  documentElement: { lang: '', setAttribute(){} },
  title: '', readyState: 'complete',
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: el, addEventListener(){},
  body: el(),
};
const window = {
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                  setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) },
  navigator: { languages: ['en-US'], language: 'en-US' },
  location: { search: '', href: 'http://localhost/' },
  history: { replaceState(){} },
  matchMedia: () => ({ matches: false, addEventListener(){} }),
  addEventListener(){}, dispatchEvent(){}, CustomEvent: function(){},
  document,
};
document.defaultView = window;

// i18n.js 可能直接用全域 localStorage / document, 兩邊都給
const sandbox = {
  window, document,
  localStorage: window.localStorage,
  navigator: window.navigator,
  location: window.location,
  history: window.history,
  matchMedia: window.matchMedia,
  setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;

// 把 DICT 暴露出來: 在 IIFE 結束前插入一行掛到 window.__DICT_FOR_TEST
const patched = src.replace(/\n\}\)\(\);\s*$/, '\n  window.__DICT_FOR_TEST = DICT;\n})();\n');
if (patched === src) {
  console.error('FAIL: 無法在 i18n.js 找到 IIFE 結尾 (})();) — 請同步更新本腳本');
  process.exit(1);
}

vm.runInNewContext(patched, sandbox, { filename: 'i18n.js' });
const DICT = sandbox.window.__DICT_FOR_TEST;
if (!DICT) { console.error('FAIL: 未取得 DICT'); process.exit(1); }

const langs = Object.keys(DICT);
if (langs.length !== 2) { console.error(`FAIL: 預期 2 本字典, 實際 ${langs.join(', ')}`); process.exit(1); }

const sets = Object.fromEntries(langs.map(l => [l, Object.keys(DICT[l]).sort()]));
const base = sets['zh-TW'];
let bad = 0;

for (const l of langs) {
  const missing = base.filter(k => !sets[l].includes(k));
  const extra = sets[l].filter(k => !base.includes(k));
  if (missing.length || extra.length) {
    bad = 1;
    console.error(`FAIL [${l}] 與 zh-TW 不一致:`);
    if (missing.length) console.error(`   缺 ${missing.length} 個 key: ${missing.join(', ')}`);
    if (extra.length)   console.error(`   多 ${extra.length} 個 key: ${extra.join(', ')}`);
  }
}

// 空字串 / 只有空白 的翻譯在介面上會渲染成「什麼都沒有」, 也算錯
for (const l of langs) for (const k of sets[l]) {
  const v = DICT[l][k];
  if (typeof v === 'string' && v.trim() === '') { console.error(`FAIL [${l}] ${k} 是空字串`); bad = 1; }
}

if (bad) process.exit(1);
console.log(`OK: ${langs.join(' / ')} 字典 key 一致, 共 ${base.length} 個`);
