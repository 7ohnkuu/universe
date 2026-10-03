# 006 — Fade orbit lines, labels, and black hole on toggle

- **Status**: DONE
- **Commit**: n/a (directory is not a git repository)
- **Severity**: LOW
- **Category**: Missed opportunities (jarring state change)
- **Estimated scope**: 2 files, ~45 lines changed

## Problem

The 軌道線 / 名稱 / 黑洞 toggle buttons flip visibility in a single frame — orbit lines and labels pop in and out. These are user-facing state changes that deserve a quick 180ms opacity fade (opacity-only fades are cheap and are kept even under reduced motion).

`main.js:722-728` (current):

```js
$('tOrbits').addEventListener('click', e => { showOrbits=!showOrbits; e.target.classList.toggle('on',showOrbits);
  planetObjs.forEach(o=>o.orbitLine.visible=showOrbits); });
$('tLabels').addEventListener('click', e => { showLabels=!showLabels; e.target.classList.toggle('on',showLabels);
  labelLayer.style.display = showLabels ? '' : 'none'; });
$('tLens').addEventListener('click', e => { lensOn=!lensOn; e.target.classList.toggle('on',lensOn); });
$('tBH').addEventListener('click', e => { bhOn=!bhOn; e.target.classList.toggle('on',bhOn);
  BH.group.visible = bhOn; });
```

Fading is cheap here because the orbit line material is already transparent — `main.js:530`:

```js
const orbitLine = new THREE.LineLoop(og, new THREE.LineBasicMaterial({ color:0x4a6a8a, transparent:true, opacity:0.45 }));
```

The black hole needs two small enablers: its horizon material is opaque (`main.js:563`, `new THREE.MeshBasicMaterial({ color: 0x000000 })`), and the accretion disk shader has no opacity uniform (final line `main.js:597`: `gl_FragColor=vec4(col*2.0, alpha);`).

The 引力透鏡 (lensing) toggle is intentionally NOT faded — it is a post-processing strength already set per-frame at `main.js:797-812`; leave it instant.

## Target

A tiny fade helper stepped from the render loop, interruptible by construction (re-toggling mid-fade reads the current opacity as the new start value):

```js
/* 簡易透明度漸變: 180ms ease-out cubic, 可被再次切換中斷 */
const fades = [];
function fadeTo(apply, from, to, ms, done){
  fades.push({ apply, from, to, ms, t0: performance.now(), done });
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
```

Toggle handlers (target):

```js
const ORBIT_OPACITY = 0.45;
$('tOrbits').addEventListener('click', e => {
  showOrbits = !showOrbits; e.target.classList.toggle('on', showOrbits);
  const mats = planetObjs.map(o => o.orbitLine.material);
  const cur = mats[0].opacity;
  if (showOrbits) planetObjs.forEach(o => o.orbitLine.visible = true);
  fadeTo(v => mats.forEach(m => m.opacity = v), cur, showOrbits ? ORBIT_OPACITY : 0, 180,
    () => { if (!showOrbits) planetObjs.forEach(o => o.orbitLine.visible = false); });
});
$('tLabels').addEventListener('click', e => {
  showLabels = !showLabels; e.target.classList.toggle('on', showLabels);
  if (showLabels) { labelLayer.style.display = ''; requestAnimationFrame(() => labelLayer.classList.remove('hidden')); }
  else { labelLayer.classList.add('hidden'); setTimeout(() => { if (!showLabels) labelLayer.style.display = 'none'; }, 200); }
});
$('tLens').addEventListener('click', e => { lensOn=!lensOn; e.target.classList.toggle('on',lensOn); });
$('tBH').addEventListener('click', e => {
  bhOn = !bhOn; e.target.classList.toggle('on', bhOn);
  const horizonMat = BH.group.children[0].material;
  const cur = horizonMat.opacity;
  if (bhOn) BH.group.visible = true;
  fadeTo(v => { horizonMat.opacity = v; BH.diskMat.uniforms.uOpacity.value = v; }, cur, bhOn ? 1 : 0, 180,
    () => { if (!bhOn) BH.group.visible = false; });
});
```

Labels fade via CSS (the label layer is DOM) — `index.html:16` (target):

```css
  #labels { position:fixed; inset:0; pointer-events:none; overflow:hidden;
    transition: opacity 180ms ease-out; }
  #labels.hidden { opacity: 0; }
```

Black hole enablers:

- `main.js:563`: `new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true })` (opacity 1 renders identically to opaque black; `transparent:true` just enables fading).
- `main.js:572` uniforms: `uniforms: { uTime:{value:0}, uOpacity:{value:1}, inner:{value:BH.diskInner}, outer:{value:BH.diskOuter} },`
- `main.js:575` shader declarations: `uniform float uTime; uniform float uOpacity; uniform float inner; uniform float outer;`
- `main.js:597` final line: `gl_FragColor=vec4(col*2.0, alpha*uOpacity);`

## Repo conventions to follow

- Helpers are top-level `const` arrow/function declarations in `main.js` (exemplar: `const $ = id => document.getElementById(id);` at `main.js:671`). Place `fades`/`fadeTo`/`stepFades` in the "UI 控制" section, just before the toggle handlers.
- Constants that mirror a magic number are named in caps near their use site (exemplar: `DIST_K`, `SUN_R` at `main.js:36-38`). `ORBIT_OPACITY` must equal the `0.45` literal at `main.js:530`.
- Element-state classes use `classList` (exemplar: `.on`). `.hidden` follows the same pattern.
- `BH.group.children[0]` is the horizon mesh — it is the first object added in `buildBlackHole()` (`main.js:561-567`). Do not "improve" this into a stored reference in this plan; note it in your report if you find the ordering has changed.

## Steps

1. In `index.html`, extend the `#labels` rule (line 16) with `transition: opacity 180ms ease-out;` and add the `#labels.hidden` rule directly below it.
2. In `main.js`, make the horizon material transparent (line 563): add `transparent: true` to the `MeshBasicMaterial`.
3. In `main.js`, add `uOpacity:{value:1}` to the disk material uniforms (line 572), add `uniform float uOpacity;` to the disk fragment shader declarations (line 575), and change the shader's final line to `gl_FragColor=vec4(col*2.0, alpha*uOpacity);` (line 597).
4. In `main.js`, add the `fades` / `fadeTo` / `stepFades` block (Target above) just before the `$('tOrbits')` handler (line 722).
5. Replace the three toggle handlers (lines 722-728) with the target handlers above. The `$('tLens')` handler is unchanged but is rewritten here only to keep the block contiguous — its body must stay byte-identical.
6. In `animate()` (`main.js:752`), call `stepFades();` once per frame — put it immediately after the planet updates (after line 758, `for (const o of planetObjs) updatePlanet(o, dt);`).

## Boundaries

- Do NOT fade the 引力透鏡 toggle or touch `lensingPass` / `main.js:797-812`.
- Do NOT change `buildBlackHole()` structure beyond steps 2-3, and do NOT restyle the orbit line color/width.
- Do NOT route label visibility through `fadeTo` — the label layer is DOM and uses the CSS transition; mixing the two systems invites double-fades.
- Motion properties only; no new dependencies.
- If the cited lines don't match what you find (code drift), STOP and report instead of improvising.

## Verification

- **Mechanical**: serve the folder (`python3 -m http.server`), open the page, no Console errors. Toggle each of 軌道線 / 名稱 / 黑洞 twice; no errors, and in Elements/Scene inspection the objects end at `visible=false` only AFTER the fade completes.
- **Feel check**:
  - Toggle 軌道線 off: the eight orbit lines dissolve over ~180ms instead of vanishing. Toggle on: they fade back to exactly their previous faintness (0.45 — compare against 土星環 brightness as a reference point; they must not come back brighter or dimmer).
  - Spam the 軌道線 toggle rapidly: each fade retargets from the current opacity — no jump to full or zero, no flicker.
  - Toggle 名稱 off/on: labels fade as a layer; after fading out they no longer intercept layout (display:none).
  - Toggle 黑洞 off: the horizon AND the glowing accretion disk fade together (the disk must not linger as a ghost ring). On again: both return at full intensity.
  - Emulate `prefers-reduced-motion: reduce`: the fades still play — correct, they are opacity-only.
- **Done when**: all three toggles cross-fade in 180ms, are interruptible mid-fade without popping, and final visibility/opacity states exactly match the pre-change behavior.
