# 001 — Cancel camera flight on user input

- **Status**: DONE
- **Commit**: n/a (directory is not a git repository)
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file, ~2 lines changed + 1 line added

## Problem

Clicking a planet/sun/black hole starts an automatic camera flight (`flyTo.active = true`). While the flight is running, dragging or zooming on the canvas does NOT cancel it — the flight keeps lerping `camera.position` and `controls.target` every frame, fighting OrbitControls for the camera until arrival. Motion the user is actively trying to override must be interruptible.

The flight is started/refreshed here — `main.js:778-786` (current):

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
  }
```

The canvas input handlers never touch `flyTo.active` — `main.js:695` (current):

```js
renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
```

There is no `wheel` listener at all. The only existing cancellations are the reset button (`main.js:686`), `focusOn(idx < 0)` (`main.js:717`), and arrival (`main.js:786`).

## Target

Any direct camera input (pointer down or wheel on the canvas) immediately cancels an in-progress flight. The persistent follow mode (`followIdx`, "持續追蹤") is a deliberate feature and must NOT be cancelled — only the transient flight.

```js
/* main.js:695 — target */
renderer.domElement.addEventListener('pointerdown', e => { flyTo.active = false; downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('wheel', () => { flyTo.active = false; }, { passive: true });
```

## Repo conventions to follow

- All event listeners are registered with plain `addEventListener` on `renderer.domElement` in the "UI 控制" section of `main.js` (exemplar: the `pointerdown`/`pointerup` pair at `main.js:695-706`). Add the `wheel` listener directly beneath them.
- `flyTo` is declared at `main.js:708` (`const flyTo = { active: false, index: -1, dist: 200 };`), AFTER the `pointerdown` registration at line 695. This is fine — the handler body only runs on user events, long after module evaluation — but do not "fix" the ordering; it is not a TDZ bug.

## Steps

1. In `main.js`, replace line 695:

   ```js
   renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
   ```

   with:

   ```js
   renderer.domElement.addEventListener('pointerdown', e => { flyTo.active = false; downXY = [e.clientX, e.clientY]; });
   renderer.domElement.addEventListener('wheel', () => { flyTo.active = false; }, { passive: true });
   ```

2. Nothing else changes. Click-to-focus still works: `pointerdown` fires before `pointerup`, and `focusOn()` (called from the `pointerup` handler at `main.js:705`) sets `flyTo.active = true` again, so cancelling on `pointerdown` cannot break click-to-fly.

## Boundaries

- Do NOT touch `followIdx` logic, `focusOn()`, `getFocusPos()`, or the follow branch (`main.js:787-790`) — persistent tracking after arrival is by design.
- Do NOT touch OrbitControls configuration (`main.js:72-76`).
- Do NOT change the lerp factors in the flight block — that is plan 002.
- Motion/input properties only; no markup changes, no new dependencies.
- If the cited lines don't match what you find (code drift), STOP and report instead of improvising.

## Verification

- **Mechanical**: serve the folder (`python3 -m http.server` in the project root) and open `http://localhost:8000`. Open DevTools Console — no errors on load, no errors after performing the interactions below.
- **Feel check**:
  - Click a planet (e.g. 木星). Mid-flight, drag to rotate: the camera must respond to the drag immediately, with no continued pull toward the planet.
  - Click a planet again. Mid-flight, scroll the wheel: zoom must apply instantly; the flight must not resume afterwards.
  - Click a planet and let the flight finish WITHOUT touching anything: it must still glide in and stop at the usual distance, then keep tracking the planet (follow mode intact).
  - Click empty space, then drag: normal orbit behavior, no regression.
- **Done when**: dragging or scrolling during any click-to-fly flight instantly hands control to the user, and an untouched flight still completes exactly as before.
