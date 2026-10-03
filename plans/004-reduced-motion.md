# 004 — Honor prefers-reduced-motion for camera flights

- **Status**: DONE
- **Commit**: n/a (directory is not a git repository)
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, ~10 lines changed
- **Depends on**: plan 002 (this plan edits the flight block in its post-002 form)

## Problem

Neither `index.html` nor `main.js` contains any `prefers-reduced-motion` handling (no media query, no `matchMedia`). The page is motion-heavy — a continuous 3D simulation plus large click-triggered camera flights — and motion-sensitive users get no mitigation. Reduced motion means fewer and gentler animations, not zero: keep opacity/color feedback and the simulation itself (its motion is the content), but replace the large camera sweep with an instant cut.

The flight block (post-plan-002 form) — `main.js:778-790`:

```js
  if (flyTo.active) {
    getFocusPos(flyTo.index, _wp);
    _cam.copy(camera.position).sub(_wp);
    if (_cam.lengthSq() < 1e-6) _cam.set(0, 0.4, 1);
    _cam.normalize();
    const desired = _wp.clone().add(_cam.multiplyScalar(flyTo.dist));
    controls.target.lerp(_wp, damp(9.0, dt));
    camera.position.lerp(desired, damp(6.3, dt));
    if (camera.position.distanceTo(desired) < flyTo.dist * 0.05 + 1.5) flyTo.active = false;
  }
```

## Target

Read the preference once at startup; when set, the flight resolves in a single frame (same final camera state, no sweep).

Add near the other UI state — after `main.js:669` (`let followIdx = -1;`):

```js
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
```

Flight block (target):

```js
  if (flyTo.active) {
    getFocusPos(flyTo.index, _wp);
    _cam.copy(camera.position).sub(_wp);
    if (_cam.lengthSq() < 1e-6) _cam.set(0, 0.4, 1);
    _cam.normalize();
    const desired = _wp.clone().add(_cam.multiplyScalar(flyTo.dist));
    if (reduceMotion) {
      controls.target.copy(_wp);
      camera.position.copy(desired);
      flyTo.active = false;
    } else {
      controls.target.lerp(_wp, damp(9.0, dt));
      camera.position.lerp(desired, damp(6.3, dt));
      if (camera.position.distanceTo(desired) < flyTo.dist * 0.05 + 1.5) flyTo.active = false;
    }
  }
```

Deliberately NOT changed (documented so the executor doesn't "help"):

- **Orbit/planet/star/shader motion** — it is the simulation content, not UI chrome.
- **Follow-mode tracking** (`main.js:787-790`) — it is continuous target correction, not a sweep.
- **Button hover/press and loader fade** — color/opacity only; the one movement-based rule (button `:active` scale) is handled in plan 005, which owns the button CSS block.

## Repo conventions to follow

- UI state lives as module-level `let`/`const` near `main.js:666-669` (exemplar: `let paused = false;` at `main.js:667`). Add `reduceMotion` there.
- This plan assumes plan 002 has been applied (the `damp()` helper exists and the lerp calls read `damp(9.0, dt)` / `damp(6.3, dt)`). If plan 002 has NOT been applied, the else-branch lines will instead read `controls.target.lerp(_wp, 0.14);` and `camera.position.lerp(desired, 0.1);` — in that case, keep those lines as-is inside the `else` branch and add only the `if (reduceMotion)` branch. Everything else in this plan is identical either way.

## Steps

1. In `main.js`, after line 669 (`let followIdx = -1;`), add:

   ```js
   const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
   ```

2. In the `if (flyTo.active)` block, wrap the two lerp calls and the arrival check in an `else`, and add the `if (reduceMotion)` snap branch shown in Target above.
3. Nothing else changes.

## Boundaries

- Do NOT gate or alter the render loop, simulation speed, shader uniforms, or OrbitControls damping.
- Do NOT add a CSS `@media (prefers-reduced-motion: reduce)` block to `index.html` — plan 005 owns the button rules including its reduced-motion exception; adding a second one here invites drift.
- Do NOT make the preference reactive to runtime changes (a one-time read at load is acceptable and matches the scope; live-updating would require restructuring `focusOn`).
- No new dependencies.
- If the cited lines don't match what you find (beyond the documented plan-002 variance), STOP and report instead of improvising.

## Verification

- **Mechanical**: serve the folder (`python3 -m http.server`), open the page, no Console errors with the OS/browser reduced-motion setting both off and on.
- **Feel check**:
  - DevTools → Rendering → emulate `prefers-reduced-motion: reduce`. Click 木星: the camera cuts instantly to the arrival framing (no sweep) and then tracks the planet normally.
  - Disable the emulation. Click 木星 again: the normal eased flight returns.
  - Under reduced motion, confirm button hovers, the loader fade, and toggle fades still give visual feedback (opacity/color feedback must remain).
- **Done when**: with reduced motion on, click-to-fly is an instant cut to the exact same arrival state; with it off, behavior is byte-for-byte the current feel.
