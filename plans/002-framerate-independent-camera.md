# 002 — Frame-rate-independent camera damping

- **Status**: DONE
- **Commit**: n/a (directory is not a git repository)
- **Severity**: MEDIUM
- **Category**: Easing & duration
- **Estimated scope**: 1 file, ~5 lines changed

## Problem

The click-to-fly camera and the follow-mode target tracking use fixed per-frame lerp factors inside `animate()`. The animation converges exponentially **per frame, not per second**, so it runs ~2x faster on a 120Hz display than on a 60Hz one — the same interaction feels snappy on one machine and sluggish on another.

`main.js:778-790` (current):

```js
  if (flyTo.active) {
    getFocusPos(flyTo.index, _wp);
    _cam.copy(camera.position).sub(_wp);
    if (_cam.lengthSq() < 1e-6) _cam.set(0, 0.4, 1);
    _cam.normalize();
    const desired = _wp.clone().add(_cam.multiplyScalar(flyTo.dist));
    controls.target.lerp(_wp, 0.14);
    camera.position.lerp(desired, 0.1);
    if (camera.position.distanceTo(desired) < flyTo.dist * 0.05 + 1.5) flyTo.active = false;
  } else if (followIdx >= 0) {
    getFocusPos(followIdx, _wp);
    controls.target.lerp(_wp, 0.12);
  }
```

`dt` is already computed and available in the same function — `main.js:754`:

```js
  const dt = Math.min(clock.getDelta(), 0.05);
```

It is used for simulation time but never for the camera lerps. (OrbitControls' own damping at `main.js:73-74` is internal to user input and does not normalize these hand-rolled lerps.)

## Target

Convert all three lerp calls to delta-time-normalized exponential damping:

```js
const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);
```

With `damp(λ, dt)` as the lerp alpha, convergence speed is refresh-rate independent. To preserve the exact current 60fps feel, choose λ from `f = 1 - exp(-λ/60)`, i.e. `λ = -60 · ln(1 - f)`:

| Current per-frame factor | λ (exact) |
| --- | --- |
| 0.14 (flight target) | 9.0 |
| 0.10 (flight camera) | 6.3 |
| 0.12 (follow target) | 7.7 |

Resulting code — `main.js:778-790` (target):

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
  } else if (followIdx >= 0) {
    getFocusPos(followIdx, _wp);
    controls.target.lerp(_wp, damp(7.7, dt));
  }
```

## Repo conventions to follow

- Small helpers are declared as top-level `const` arrow functions in `main.js` (exemplar: `const lerp = (a,b,t) => a + (b - a) * t;` at `main.js:234`, `const distScale = a => ...` at `main.js:37`). Declare `damp` the same way, near the other math helpers or just above `animate()`.

## Steps

1. In `main.js`, add the helper just above the `function animate(){` line (after line 735, the `_wp`/`_cam` declarations):

   ```js
   const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);
   ```

2. In the flight block, replace `controls.target.lerp(_wp, 0.14);` with `controls.target.lerp(_wp, damp(9.0, dt));`
3. Replace `camera.position.lerp(desired, 0.1);` with `camera.position.lerp(desired, damp(6.3, dt));`
4. In the follow branch, replace `controls.target.lerp(_wp, 0.12);` with `controls.target.lerp(_wp, damp(7.7, dt));`
5. Do not change the arrival threshold (`flyTo.dist * 0.05 + 1.5`) or anything else in the block.

## Boundaries

- Do NOT touch OrbitControls' `dampingFactor` (`main.js:74`) — that is library-internal.
- Do NOT change `simSpeed`, `simTime`, or any shader `uTime` updates — they already use `dt` correctly.
- Do NOT add input cancellation — that is plan 001.
- No new dependencies, no markup changes.
- If the cited lines don't match what you find (code drift), STOP and report instead of improvising.

## Verification

- **Mechanical**: serve the folder (`python3 -m http.server`) and open the page; Console shows no errors.
- **Feel check**:
  - Click 土星 and time the flight with a stopwatch (or `console.time` around it): on a 60Hz display it should take the same wall-clock time as before the change (the λ values reproduce the old 60fps curve).
  - In Chrome DevTools → Rendering, no direct frame-rate cap exists, so compare across two machines/displays (60Hz vs 120Hz+) if available: flight duration and follow-tracking tightness should now feel identical.
  - Follow mode (after arrival) must still track the planet smoothly with no visible lag or jitter.
- **Done when**: camera flight and follow tracking take the same wall-clock time regardless of display refresh rate, and the 60Hz feel is unchanged from before the edit.
