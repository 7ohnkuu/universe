# 005 — Button motion polish (explicit transition, press feedback, hover gating)

- **Status**: DONE
- **Commit**: n/a (directory is not a git repository)
- **Severity**: LOW (merges three findings: transition-all LOW, press-feedback MEDIUM, ungated-hover LOW)
- **Category**: Performance / Physicality / Accessibility
- **Estimated scope**: 1 file, 1 CSS rule rewritten + 2 small rules added

## Problem

Three findings share the same CSS rule block, so they ship as one plan:

1. **transition-all** — `index.html:36` (current): the bare shorthand `transition:.15s` equals `transition: all .15s ease`, animating every animatable property. Always a finding; only the intended properties should transition.

   ```css
   .btns button { flex:1 1 auto; cursor:pointer; transition:.15s; }
   ```

2. **No press feedback** — buttons have `:hover` and `.on` states but no `:active` rule anywhere in `index.html`. Pressable elements should compress subtly on press: `transform: scale(0.97)` with `transition: transform 160ms ease-out`.
3. **Ungated hover** — `index.html:37` (current) fires on touch taps too, leaving a stuck hover tint until the next tap:

   ```css
   .btns button:hover { background:rgba(124,196,255,.18); }
   ```

## Target

`index.html:36-38` becomes:

```css
  .btns button { flex:1 1 auto; cursor:pointer;
    transition: background-color 150ms ease, border-color 150ms ease, transform 160ms ease-out; }
  .btns button:active { transform: scale(0.97); }
  @media (hover: hover) and (pointer: fine) {
    .btns button:hover { background:rgba(124,196,255,.18); }
  }
  @media (prefers-reduced-motion: reduce) {
    .btns button:active { transform: none; }
  }
  .btns button.on { background:rgba(124,196,255,.28); border-color:var(--accent); }
```

Value rationale (do not substitute):

- Color/hover changes use `ease` at 150ms — the current `.15s` duration is already in budget, kept.
- Press feedback: `scale(0.97)` on `:active`, `transform 160ms ease-out` — the standard press-feedback spec (subtle range is 0.95–0.98).
- Hover tint moves inside `@media (hover: hover) and (pointer: fine)` so touch devices never see a stuck hover state; the `.on` toggle state still communicates selection on touch.
- Under reduced motion, the color transitions stay (opacity/color feedback is kept) but the `:active` scale movement is dropped.

## Repo conventions to follow

- All styles live in the single `<style>` block in `index.html`; component rules are grouped together — keep the new rules adjacent to the existing `.btns` block.
- Existing color tokens are used via `var(--accent)` etc. — the rewrite introduces no new tokens and no new colors.

## Steps

1. In `index.html`, replace lines 36-38 (the three rules `.btns button`, `.btns button:hover`, `.btns button.on`) with the target block shown above, keeping the same 2-space indentation used throughout the `<style>` tag.
2. Nothing else changes — no markup, no JS. The `.on` class toggling in `main.js` (`main.js:683`, `722-728`) is unaffected.

## Boundaries

- Do NOT touch `#ui`, `.legend`, `#loader`, or `.label` rules — other plans own those (`#loader` is plan 003; the `#labels` container is plan 006).
- Do NOT add transitions to `select` or `input[type=range]` elements — out of scope.
- Motion properties only; no new dependencies, no markup changes.
- If the cited lines don't match what you find (code drift), STOP and report instead of improvising.

## Verification

- **Mechanical**: serve the folder (`python3 -m http.server`), open the page, no Console errors. In Elements panel, select a `.btns button` and confirm the computed `transition` lists exactly `background-color`, `border-color`, `transform` — not `all`.
- **Feel check**:
  - Hover 暫停: same tint fade as before (no perceptible change on desktop).
  - Press and hold any button: it compresses to 97% in ~160ms and springs back on release. In DevTools → Animations at 10% speed, confirm the scale animates around the button's own center and nothing else moves.
  - Emulate a touch device (DevTools device toolbar): tapping a button shows NO lingering hover tint; the `.on` highlight still appears for toggles.
  - Emulate `prefers-reduced-motion: reduce` (Rendering panel): press a button — no scale, but hover/toggle color feedback still works.
  - Spam-click a toggle button: the press animation retargets smoothly from its current scale (CSS transitions are interruptible by construction — confirm no restart-from-zero flicker).
- **Done when**: computed transition is explicit (no `all`), press gives a subtle 160ms scale, touch has no stuck hover, and reduced motion drops only the movement.
