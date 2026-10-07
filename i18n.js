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

      'grp.system': '系統',
      'sys.select': '星際系統',
      'sys.solar': '太陽系',
      'sys.trap': 'TRAPPIST-1 (系外共振鏈)',
      'trap.star': 'TRAPPIST-1 (紅矮星)',
      'trap.note': '★ 7 顆地球大小行星繞一顆 M8V 紅矮星 (Teff 2566 K, 半徑僅比木星大 19%)。相鄰週期比構成完整共振鏈 8:5·5:3·3:2·3:2·4:3·3:2 (Agol 2021, 偏差 <1.3%), 時間拉長即可見共振。行星全部潮汐鎖定 (一面永書、一面永夜); JWST 對 b 星未發現實質大氣, 故以裸岩世界呈現。恆星有 M 矮星典型的偶發耀斑。',

      'sim.speed': '時間流速',
      'unit.yrPerSec': '{v} 年/秒',
      'unit.dayPerSec': '{v} 天/秒',
      'btn.pause': '⏸ 暫停',
      'btn.play': '▶ 播放',

      'view.follow': '鏡頭追蹤',
      'view.free': '自由視角',
      'btn.reset': '↺ 重置視角',

      'disp.quality': '貼圖解析度',
      'q.8k': '8k (極高畫質, 大量顯存)',
      'q.4k': '4k (推薦)',
      'q.2k': '2k (省顯存)',
      'q.degraded': '⚠ {missing} 個 8k 檔缺失, 已降級至 4k/程序化貼圖 (跑 scripts/fetch-textures.sh 可下載)',
      'q.degradedTitle': '所選 8k 貼圖有 {missing} 個檔案不在本地, 實際已降級顯示 (見 .gitignore: 8k 未隨倉庫發布)',

      'btn.orbits': '軌道線',
      'btn.labels': '名稱',
      'btn.belt': '小行星帶',
      'btn.axis': '軸傾指示',
      'btn.lens': '引力透鏡',
      'btn.bh': '黑洞',
      'btn.wh': '蟲洞',
      'opt.wh': '蟲洞',
      'opt.comet': '彗星',
      'label.comet': '彗星 (雙尾)',
      'label.wh': '蟲洞 (Ellis–Bronnikov)',
      'ds.note.wh': '★ 蟲洞無事件視界、無光子球、無陰影: b≤a 的光線穿喉而過, 喉是一個透視窗。偏折 α=(π/4)(a/b)² 無 1/b 項 ⇒ 零 ADM 質量; 愛因斯坦環 θ³=常數, 與黑洞的 θ² 不同 (arXiv 2607.02889)。撐開喉需要負能量 (違反零能量條件), 目前僅為理論構想。',

      'grp.dyson': '戴森結構',
      'btn.dyson': '啟用結構',
      'dyson.mode': '結構型態',
      'dymode.shell': '戴森殼 (閉合球殼)',
      'dymode.ring': '戴森環 (軌道收集器環)',
      'dyson.radiusRing': '環半徑',
      'ds.note.ring': '★ 環由獨立軌道收集器組成, 各走克卜勒軌道 (ω=2π/a^1.5), 非剛體 ⇒ 動態穩定, 不犯 Maxwell (1856) 對剛性環的指數不穩定結論。擾動後以週轉頻率 κ=Ω 做有界振盪, 不會漂走。',
      'btn.dsPerturb': '施加擾動',
      'btn.dsIR': '紅外偽色',
      'ds.warn.crash': '✖ 殼已漂移至內壁撞上恆星 —— 中性平衡沒有回復力, 這就是剛性戴森球不可行的原因。重新開啟或改變半徑可重置。',
      'ds.note.ir': '★ 這是【紅外偽色】視圖, 不是肉眼所見: 顯示殼以 λmax {lmax} µm 釋出的廢熱。紅外功率是殘餘恆星的約 {ratio} 倍 —— 這就是戴森球在紅外波段極易偵測、在光學波段幾乎隱形的原因。',
      'ds.note.opt': '★ 這是【光學】視圖, 即肉眼所見: 殼的光學輻射僅為恆星的 {ratio}, 所以殼看起來是黑的。唯一可觀測效應是恆星變暗至 {leak} L☉, 行星同步變暗。',
      'dyson.cover': '覆蓋率',
      'dyson.radius': '殼半徑',
      'ds.stats': '殼溫 T\t<b>{T} K</b>\n峰值波長 λmax\t<b>{lmax} µm</b>\n攔截功率 P\t<b>{pW} W</b>\n相當 Kardashev II\t<b>×{kard}</b>\n光學波段佔比\t<b>{opt}%</b>\n外逸光度\t<b>{leak} L☉</b>',
      'ds.warn.instab': '⚠ 殼定理: 均勻剛性殼在恆星重力與輻射下淨力為零 → 中性平衡, 無回復力。任何擾動會持續漂移直至撞上恆星 (已實測收斂至 1e-12)。\n參: arXiv 2409.10602 —— 偶極模式線性不穩定, 「徑向穩定」不等於穩定。',
      'ds.warn.material': '⚠ 此半徑下殼溫超過材料昇華點, 需主動冷卻; 實際可建範圍受限於難熔材料。',
      'ds.note.dark': '★ 光學波段僅 {opt}%: 在可見光下殼是黑的, 能量全部移到紅外線。這正是 Project Hephaistos / Ĝ 搜尋用「紅外超量」而非「光學變暗」的原因 (arXiv 2607.09460, 2608.12458)。',
      'ds.note.leak': '★ f=100% 時恆星對外完全不可見, 只剩 λmax {lmax} µm 的廢熱輻射。',

      'ui.hint': '拖曳旋轉 · 滾輪縮放 · 右鍵平移 (觸控: 單指旋轉 · 雙指縮放/平移)。<br/>' +
                 '<b>點擊行星 / 太陽 / 黑洞</b>可自動飛行靠近並持續追蹤。<br/>' +
                 '軌道距離已壓縮以便觀察，但行星相對週期、偏心率、軌道傾角均依真實數據。',
      'ui.legend': '外部黑洞運用螢幕空間引力透鏡著色器，彎曲背後星空與吸積盤光線，' +
                   '並模擬事件視界與光子環。太陽與吸積盤以 HDR Bloom 產生真實輝光。',

      'loader.init': '載入中 · 初始化星系…',
      'loader.tex': '載入中 · 貼圖 {done}/{total}',
      'loader.texBytes': '載入中 · 貼圖 {done}/{total} · {mb}/{mbTotal} MB · {pct}%',
      'loader.bar': '載入進度',
      'ui.keys': '鍵盤：空白 暫停 · [ ] 調速 · 1–8 行星 · P 冥王星 · 0 太陽 · 9 黑洞 · R 重置 · L 名稱 · O 軌道 · B 黑洞 · G 透鏡 · D 戴森殼 · W 蟲洞 · C 彗星 · A 小行星帶 · X 軸傾指示 · S 切換系統',

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
      'planet.冥王星': '冥王星',
      'planet.太陽': '太陽',
    },

    'en': {
      'doc.title': 'Solar System · Black Hole Gravitational Lens (three.js)',
      'ui.h1': 'Solar System · Black Hole Lens',
      'ui.sub': 'Real Keplerian orbits · rendered live',

      'grp.sim': 'SIMULATION',
      'grp.view': 'CAMERA',
      'grp.display': 'DISPLAY',

      'grp.system': 'SYSTEM',
      'sys.select': 'Star system',
      'sys.solar': 'Solar System',
      'sys.trap': 'TRAPPIST-1 (exoplanet resonance chain)',
      'trap.star': 'TRAPPIST-1 (red dwarf)',
      'trap.note': '★ Seven Earth-sized planets orbit an M8V red dwarf (Teff 2566 K, radius barely 19% larger than Jupiter). The consecutive period ratios form a complete resonance chain 8:5·5:3·3:2·3:2·4:3·3:2 (Agol 2021, deviation <1.3%) — run time long enough and the commensurability appears. All planets are tidally locked (one side in perpetual day, one in night); JWST found no substantial atmosphere on b, so they are shown as bare rock. The star shows the flares typical of M dwarfs.',

      'sim.speed': 'Time speed',
      'unit.yrPerSec': '{v} yr/s',
      'unit.dayPerSec': '{v} day/s',
      'btn.pause': '⏸ Pause',
      'btn.play': '▶ Play',

      'view.follow': 'Camera follow',
      'view.free': 'Free camera',
      'btn.reset': '↺ Reset view',

      'disp.quality': 'Texture resolution',
      'q.8k': '8k (best quality, heavy VRAM)',
      'q.4k': '4k (recommended)',
      'q.2k': '2k (low VRAM)',
      'q.degraded': '⚠ {missing} 8k files missing — fell back to 4k/procedural (run scripts/fetch-textures.sh to download)',
      'q.degradedTitle': '{missing} of the selected 8k textures are not present locally; the view has silently degraded (see .gitignore: 8k is not shipped with the repo)',

      'btn.orbits': 'Orbits',
      'btn.labels': 'Labels',
      'btn.belt': 'Asteroid belt',
      'btn.axis': 'Axis tilt',
      'btn.lens': 'Lensing',
      'btn.bh': 'Black hole',
      'btn.wh': 'Wormhole',
      'opt.wh': 'Wormhole',
      'opt.comet': 'Comet',
      'label.comet': 'Comet (two tails)',
      'label.wh': 'Wormhole (Ellis–Bronnikov)',
      'ds.note.wh': '★ No event horizon, no photon sphere, no shadow: rays with b≤a pass through the throat, so the throat is a window, not a black disc. Deflection α=(π/4)(a/b)² has no 1/b term ⇒ zero ADM mass; the Einstein ring scales as θ³=const, unlike the black hole’s θ² (arXiv 2607.02889). Keeping the throat open needs negative energy (violates the null energy condition) — a theoretical construct only.',

      'grp.dyson': 'DYSON STRUCTURE',
      'btn.dyson': 'Enable structure',
      'dyson.mode': 'Structure type',
      'dymode.shell': 'Dyson shell (closed sphere)',
      'dymode.ring': 'Dyson ring (orbital collector ring)',
      'dyson.radiusRing': 'Ring radius',
      'ds.note.ring': '★ The ring is a swarm of independent collectors, each on its own Keplerian orbit (ω=2π/a^1.5) — not a rigid body, so Maxwell’s (1856) exponential instability of rigid rings does not apply. After a perturbation it oscillates radially at the epicyclic frequency κ=Ω, bounded; it does not drift away.',
      'btn.dsPerturb': 'Apply perturbation',
      'btn.dsIR': 'IR false colour',
      'ds.warn.crash': '✖ The shell has drifted until its inner wall hit the star — neutral equilibrium has no restoring force, which is exactly why a rigid Dyson sphere is not feasible. Re-enable it or change the radius to reset.',
      'ds.note.ir': '★ This is an INFRARED FALSE-COLOUR view, not what an eye would see: it shows the waste heat the shell reradiates at λmax {lmax} µm. Its infrared power is about {ratio}× the surviving star — which is why a Dyson sphere is easy to spot in the infrared and nearly invisible optically.',
      'ds.note.opt': '★ This is the OPTICAL view, i.e. what an eye sees: the shell’s optical emission is only {ratio} of the star’s, so the shell looks black. The one observable effect is the star dimming to {leak} L☉, and the planets dimming with it.',
      'dyson.cover': 'Coverage',
      'dyson.radius': 'Shell radius',
      'ds.stats': 'Shell temp T\t<b>{T} K</b>\nPeak λmax\t<b>{lmax} µm</b>\nIntercepted power P\t<b>{pW} W</b>\nvs Kardashev II\t<b>×{kard}</b>\nOptical-band fraction\t<b>{opt}%</b>\nEscaping luminosity\t<b>{leak} L☉</b>',
      'ds.warn.instab': '⚠ Shell theorem: a uniform rigid shell feels zero net force from the star’s gravity and radiation → neutral equilibrium, no restoring force. Any perturbation drifts until it hits the star (verified numerically to 1e-12).\nSee arXiv 2409.10602 — the dipole mode is linearly unstable; radial stability is not stability.',
      'ds.warn.material': '⚠ At this radius the shell exceeds the sublimation point of the material; active cooling required. The buildable range is limited by refractory materials.',
      'ds.note.dark': '★ Only {opt}% in the optical band: the shell is black to the eye; all the energy moves to infrared. That is why Project Hephaistos / Ĝ search for an infrared excess rather than optical dimming (arXiv 2607.09460, 2608.12458).',
      'ds.note.leak': '★ At f=100% the star is entirely invisible from outside; only waste heat at λmax {lmax} µm escapes.',

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
      'ui.keys': 'Keys: Space pause · [ ] speed · 1–8 planets · P Pluto · 0 Sun · 9 black hole · R reset · L labels · O orbits · B black hole · G lensing · D Dyson shell · W wormhole · C comet · A asteroid belt · X axis tilt · S switch system',

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
      'planet.冥王星': 'Pluto',
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
