# 003 — Fade out the loading overlay

- **Status**: DONE
- **Commit**: n/a (directory is not a git repository)
- **Severity**: MEDIUM
- **Category**: Missed opportunities (jarring state change)
- **Estimated scope**: 2 files, ~6 lines changed

## Problem

On every page load, the fullscreen black loading overlay is removed in a single frame — a hard cut from "載入中" to the live scene. A 250ms opacity fade turns the same state change into a reveal.

`main.js:831-833` (current):

```js
// 啟動
document.getElementById('loader').style.display = 'none';
animate();
```

`index.html:43-44` (current) — no transition defined:

```css
  #loader { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:#000; z-index:50; font-size:13px; letter-spacing:1px; opacity:.9; }
```

## Target

Fade `opacity` only (transform/opacity are the GPU-cheap properties; a fade is also safe under `prefers-reduced-motion`, which keeps opacity/color transitions and drops movement). 250ms `ease-out`, then remove from layout.

`index.html:43-44` (target):

```css
  #loader { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:#000; z-index:50; font-size:13px; letter-spacing:1px; opacity:.9;
    transition: opacity 250ms ease-out; }
  #loader.done { opacity:0; pointer-events:none; }
```

`main.js:831-833` (target):

```js
// 啟動
const loaderEl = document.getElementById('loader');
loaderEl.classList.add('done');
loaderEl.addEventListener('transitionend', () => { loaderEl.style.display = 'none'; }, { once: true });
setTimeout(() => { loaderEl.style.display = 'none'; }, 400); // 保底: transitionend 未觸發時也會移除
animate();
```

The `setTimeout` fallback matters: if the tab is backgrounded during load, `transitionend` may never fire.

Error-path compatibility: the inline error handler in `index.html:115-119` (`showErr`) sets `el.style.opacity = '1'` — an inline style beats the `.done` class, so an init failure still makes the loader reappear with the error message. No change needed there.

## Repo conventions to follow

- Element-state classes are toggled with `classList` and named after state (exemplar: `.on` for toggle buttons, `index.html:38` / `main.js:683`). `.done` follows the same pattern.
- Durations on this page are plain ms values in CSS (exemplar: `transition:.15s` at `index.html:36`); there is no duration-token system to extend — use the literal `250ms ease-out`.

## Steps

1. In `index.html`, extend the `#loader` rule (line 43-44) with `transition: opacity 250ms ease-out;` and add a new rule directly below it:

   ```css
   #loader.done { opacity:0; pointer-events:none; }
   ```

2. In `main.js`, replace lines 831-833 (`// 啟動` … `animate();`) with the target JS block shown above.
3. Nothing else changes — the scene still starts rendering immediately via `animate()`; the overlay simply cross-fades on top of it.

## Boundaries

- Do NOT animate `transform`, `filter`, or layout properties on `#loader` — opacity only.
- Do NOT delay the `animate()` call or gate it on the fade completing.
- Do NOT modify the `showErr` error handler in `index.html`.
- No new dependencies.
- If the cited lines don't match what you find (code drift), STOP and report instead of improvising.

## Verification

- **Mechanical**: serve the folder (`python3 -m http.server`), hard-reload the page. Console shows no errors; after ~0.5s the loader is `display:none` (check in Elements panel).
- **Feel check**:
  - Reload several times: the loader melts into the scene instead of blinking out. In DevTools → Animations panel, set playback to 10% and reload: confirm a smooth opacity ramp with no layout shift (the overlay is `position:fixed`, so nothing else may move).
  - Throttle the CPU 4x (Performance panel) and reload: the fade still completes and the loader still ends up `display:none` (fallback timer works).
  - Toggle `prefers-reduced-motion: reduce` (Rendering panel) and reload: the fade remains — this is correct, opacity transitions are kept under reduced motion.
- **Done when**: every load shows a 250ms opacity fade-out, the overlay always ends at `display:none`, and the error path still displays init failures.
