// =============================================================================
//  i18n — 單一文字來源 (zh-TW / en)
//
//  為什麼是「傳統 script」而不是 ES module:
//   - index.html 在 </body> 前同步載入本檔, 因此靜態文字在「首次繪製前」就套好
//     語言, 不會先閃中文再跳英文 (module script 一律 defer, 做不到這件事)。
//   - 傳統 script 在 file:// 下也能跑, 與本專案「離線可用」的取向一致。
//   - main.js 是 module (defer), 必定在本檔之後執行, 可直接用 window.__i18n。
//
//  設計要點:
//   1. 行星的「邏輯鍵」維持中文 —— main.js 以 p.name 分支貼圖路徑/材質/地形,
//      換語言只動「顯示名」, 不影響任何渲染邏輯。
//   2. 語言優先序: ?lang= > localStorage > 瀏覽器語系 (zh* → zh-TW, 其餘 → en)。
//   3. 找不到 key 時回傳 key 本身 (不會崩潰, 且問題一眼可見)。
// =============================================================================
(function () {
  'use strict';

  var LANGS = ['zh-TW', 'en'];
  var STORAGE_KEY = 'universe.lang';

  var DICT = {
    'zh-TW': {
      'doc.title': '太陽系 · 黑洞引力透鏡模擬 (three.js)',
      'ui.h1': '太陽系 · 黑洞引力透鏡',
      'ui.sub': '真實克卜勒軌道 · 即時渲染',

      'grp.sim': '模擬',
      'grp.view': '視角',
      'grp.display': '顯示',

      'sim.speed': '時間流速',
      'unit.yrPerSec': '{v} 年/秒',
      'btn.pause': '⏸ 暫停',
      'btn.play': '▶ 播放',

      'view.follow': '鏡頭追蹤',
      'view.free': '自由視角',
      'btn.reset': '↺ 重置視角',

      'disp.quality': '貼圖解析度',
      'q.8k': '8k (極高畫質, 大量顯存)',
      'q.4k': '4k (推薦)',
      'q.2k': '2k (省顯存)',

      'btn.orbits': '軌道線',
      'btn.labels': '名稱',
      'btn.lens': '引力透鏡',
      'btn.bh': '黑洞',

      'ui.hint': '拖曳旋轉 · 滾輪縮放 · 右鍵平移 (觸控: 單指旋轉 · 雙指縮放/平移)。<br/>' +
                 '<b>點擊行星 / 太陽 / 黑洞</b>可自動飛行靠近並持續追蹤。<br/>' +
                 '軌道距離已壓縮以便觀察，但行星相對週期、偏心率、軌道傾角均依真實數據。',
      'ui.legend': '外部黑洞運用螢幕空間引力透鏡著色器，彎曲背後星空與吸積盤光線，' +
                   '並模擬事件視界與光子環。太陽與吸積盤以 HDR Bloom 產生真實輝光。',

      'loader.init': '載入中 · 初始化星系…',
      'loader.tex': '載入中 · 貼圖 {done}/{total}',
      'loader.texBytes': '載入中 · 貼圖 {done}/{total} · {mb}/{mbTotal} MB · {pct}%',
      'loader.bar': '載入進度',
      'ui.keys': '鍵盤：空白 暫停 · [ ] 調速 · 1–8 行星 · 0 太陽 · 9 黑洞 · R 重置 · L 名稱 · O 軌道 · B 黑洞 · G 透鏡',

      'label.bh': '黑洞 (引力透鏡)',
      'opt.bh': '黑洞',
      'aria.lang': '介面語言',
      'aria.collapse': '收起面板',
      'aria.pin': '釘選面板 (不自動收回)',
      'aria.legendHide': '隱藏說明',
      'ui.legendShow': '圖例',
      'ui.expand': '控制面板',

      'err.close': '關閉',
      'err.runtime': '執行期錯誤：{msg}（Console 有詳情）',
      'err.initFail': '初始化失敗：{msg}（請開啟開發者工具 Console 查看詳情）',
      'err.noModule': 'three.js 模組載入失敗 (請確認 vendor/ 目錄; file:// 開啟會被 CORS 擋, 請用 python3 -m http.server)',
      'err.noBoot': 'three.js 模組未載入 (請確認 vendor/three.module.js 存在; 離線開啟請用 python3 -m http.server)',
      'err.noReady': '初始化未完成, 請查看 Console',
      'err.texFail': '貼圖載入失敗 (將使用程序化/純色降級):',
      'err.patchInclude': '晨昏線 patch: 找不到 lights_physical_pars_fragment include, 維持原始著色',
      'err.patchDiffuse': '晨昏線 patch: 找不到 directDiffuse 注入點, 維持原始著色',

      'planet.水星': '水星', 'planet.金星': '金星', 'planet.地球': '地球', 'planet.火星': '火星',
      'planet.木星': '木星', 'planet.土星': '土星', 'planet.天王星': '天王星', 'planet.海王星': '海王星',
      'planet.太陽': '太陽',
    },

    'en': {
      'doc.title': 'Solar System · Black Hole Gravitational Lens (three.js)',
      'ui.h1': 'Solar System · Black Hole Lens',
      'ui.sub': 'Real Keplerian orbits · rendered live',

      'grp.sim': 'SIMULATION',
      'grp.view': 'CAMERA',
      'grp.display': 'DISPLAY',

      'sim.speed': 'Time speed',
      'unit.yrPerSec': '{v} yr/s',
      'btn.pause': '⏸ Pause',
      'btn.play': '▶ Play',

      'view.follow': 'Camera follow',
      'view.free': 'Free camera',
      'btn.reset': '↺ Reset view',

      'disp.quality': 'Texture resolution',
      'q.8k': '8k (best quality, heavy VRAM)',
      'q.4k': '4k (recommended)',
      'q.2k': '2k (low VRAM)',

      'btn.orbits': 'Orbits',
      'btn.labels': 'Labels',
      'btn.lens': 'Lensing',
      'btn.bh': 'Black hole',

      'ui.hint': 'Drag to orbit · scroll to zoom · right-drag to pan (touch: one finger to orbit · pinch to zoom or pan).<br/>' +
                 '<b>Click a planet, the Sun or the black hole</b> to fly in and keep tracking it.<br/>' +
                 'Orbital distances are compressed for viewing, but relative periods, eccentricities and inclinations use real data.',
      'ui.legend': 'The external black hole uses a screen-space gravitational-lensing shader that bends the starfield and ' +
                   'accretion-disk light behind it, modelling the event horizon and the photon ring. The Sun and the disk ' +
                   'glow through HDR bloom.',

      'loader.init': 'Loading · building the system…',
      'loader.tex': 'Loading · textures {done}/{total}',
      'loader.texBytes': 'Loading · textures {done}/{total} · {mb}/{mbTotal} MB · {pct}%',
      'loader.bar': 'Loading progress',
      'ui.keys': 'Keys: Space pause · [ ] speed · 1–8 planets · 0 Sun · 9 black hole · R reset · L labels · O orbits · B black hole · G lensing',

      'label.bh': 'Black hole (lensing)',
      'opt.bh': 'Black hole',
      'aria.lang': 'Interface language',
      'aria.collapse': 'Hide panel',
      'aria.pin': 'Pin panel (disable auto-hide)',
      'aria.legendHide': 'Hide legend',
      'ui.legendShow': 'Legend',
      'ui.expand': 'Controls',

      'err.close': 'Close',
      'err.runtime': 'Runtime error: {msg} (see Console)',
      'err.initFail': 'Initialisation failed: {msg} (open DevTools Console for details)',
      'err.noModule': 'Failed to load the three.js module (check the vendor/ directory; opening via file:// is blocked by CORS — serve the folder with python3 -m http.server)',
      'err.noBoot': 'The three.js module never loaded (make sure vendor/three.module.js exists; when running offline, serve the folder with python3 -m http.server)',
      'err.noReady': 'Initialisation did not finish — check the Console',
      'err.texFail': 'Texture failed to load (falling back to procedural / solid colour):',
      'err.patchInclude': 'Terminator patch: lights_physical_pars_fragment include not found, keeping stock shading',
      'err.patchDiffuse': 'Terminator patch: directDiffuse injection point not found, keeping stock shading',

      'planet.水星': 'Mercury', 'planet.金星': 'Venus', 'planet.地球': 'Earth', 'planet.火星': 'Mars',
      'planet.木星': 'Jupiter', 'planet.土星': 'Saturn', 'planet.天王星': 'Uranus', 'planet.海王星': 'Neptune',
      'planet.太陽': 'Sun',
    },
  };

  function readStored(){
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function writeStored(code){
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* file:// 或隱私模式: 忽略 */ }
  }

  function detect(){
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q && DICT[q]) return q;
    } catch (e) { /* 忽略 */ }
    var saved = readStored();
    if (saved && DICT[saved]) return saved;
    var wanted = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < wanted.length; i++) if (/^zh/i.test(wanted[i])) return 'zh-TW';
    return 'en';
  }

  var current = detect();

  function t(key, params){
    var table = DICT[current] || DICT['zh-TW'];
    var s = (table[key] !== undefined) ? table[key] : DICT['zh-TW'][key];
    if (s === undefined) return key;
    if (params) for (var k in params) s = s.split('{' + k + '}').join(String(params[k]));
    return s;
  }

  // 行星顯示名: 傳入 main.js 的中文邏輯鍵
  function pname(zhKey){ return t('planet.' + zhKey); }

  /* 套用到 index.html 的靜態節點:
       data-i18n="key"   → textContent
       data-i18n-html    → innerHTML (含 <b>/<br/> 的說明文字)
       data-i18n-attr="aria-label:key,..." → 屬性
     另加 .i18n-hidden 類: 只屬於另一種語言的節點 (如標題旁的中文括號), 由 CSS 依
     body[data-lang] 隱藏, 不必為它增加 key。 */
  function applyStatic(){
    document.documentElement.lang = current;
    document.title = t('doc.title');
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    els = document.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < els.length; i++) els[i].innerHTML = t(els[i].getAttribute('data-i18n-html'));
    els = document.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < els.length; i++) {
      var pairs = els[i].getAttribute('data-i18n-attr').split(',');
      for (var j = 0; j < pairs.length; j++) {
        var pair = pairs[j]; var c = pair.indexOf(':');
        if (c < 0) continue;
        els[i].setAttribute(pair.slice(0, c).trim(), t(pair.slice(c + 1).trim()));
      }
    }
    document.body.dataset.lang = current;
    syncToggle();
  }

  function syncToggle(){
    var btns = document.querySelectorAll('.lang-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-lang-code') === current;
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-pressed', String(on));
    }
  }

  function setLang(code){
    if (!DICT[code] || code === current) return false;
    current = code;
    writeStored(code);
    syncUrl(code);   // 否則 URL 上的 ?lang= 永遠壓過剛點的按鈕, 重新整理就被打回去
    applyStatic();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: code } }));
    return true;
  }

  // 手動選語言 = 最高意圖: 同步寫回 localStorage 與 URL (?lang=), 三者不再互相矛盾。
  // 用 replaceState: 不污染後退歷史, 也保留分享連結的能力。
  function syncUrl(code){
    try {
      var u = new URL(location.href);
      if (u.searchParams.get('lang') !== code) {
        u.searchParams.set('lang', code);
        history.replaceState(history.state, '', u);
      }
    } catch (e) { /* file:// 或部分環境下 replaceState 會拋錯: 不影響語言本身 */ }
  }

  function init(){
    applyStatic();
    var btns = document.querySelectorAll('.lang-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) {
        setLang(e.currentTarget.getAttribute('data-lang-code'));
      });
    }
  }

  window.__i18n = {
    t: t, pname: pname, getLang: function(){ return current; },
    setLang: setLang, applyStatic: applyStatic, LANGS: LANGS,
  };

  // 本檔在 </body> 前同步載入 → body 已存在, 直接套用 (首次繪製前完成, 無語言閃爍)
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
