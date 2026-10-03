# Animation Improvement Plans

Source: `improve-animations` audit of the three.js solar system + black hole lensing demo (`index.html`, `main.js`). All 8 vetted findings, merged into 6 self-contained plans (findings 5–7 shared one CSS block and ship as plan 005). Directory is not a git repository, so commit stamps are n/a.

| # | Title | Severity | Status |
| --- | --- | --- | --- |
| 001 | Cancel camera flight on user input | MEDIUM | DONE |
| 002 | Frame-rate-independent camera damping | MEDIUM | DONE |
| 003 | Fade out the loading overlay | MEDIUM | DONE |
| 004 | Honor prefers-reduced-motion for camera flights | MEDIUM | DONE |
| 005 | Button motion polish (explicit transition, press feedback, hover gating) | LOW | DONE |
| 006 | Fade orbit lines, labels, and black hole on toggle | LOW | DONE |

## Recommended execution order

1. **001** → 2. **002** — both edit the camera/input code in `main.js`; do them back-to-back in this order (002 rewrites the lerp lines that 001 leaves untouched, so applying 001 first avoids conflicts).
3. **003** — independent (`#loader` CSS + startup lines).
4. **005** — independent (button CSS block only).
5. **006** — independent (toggle handlers + disk shader + `#labels` CSS).
6. **004** — last. It edits the flight block in its post-002 form; its steps document the pre-002 variant just in case, but executing after 002 keeps it unambiguous.

## Dependencies

- **004 depends on 002** (uses the `damp()` helper introduced by 002).
- 001 and 002 touch adjacent lines in the same `if (flyTo.active)` block — execute sequentially, not in parallel.
- 003, 005, 006 are mutually independent and independent of 001/002/004.

Each plan is fully self-contained: an executor with zero context can implement any single plan from its file alone.
