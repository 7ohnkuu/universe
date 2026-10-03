# Solar System · Black Hole Gravitational Lensing

**太陽系 · 黑洞引力透鏡** — a real-time, browser-based solar system built on
[three.js](https://threejs.org): eight planets on **true Keplerian orbits**
(Kepler's equation solved every frame), plus an external black hole whose
screen-space **gravitational-lensing shader** bends the starfield and the
accretion disk behind it.

No build step, no framework, no bundler — three source files, served as static
assets.

<p align="center">
  <img src="docs/screenshots/overview.jpg" alt="Full system: eight Keplerian orbits around a bloomed Sun, with the black hole at right" width="900">
</p>

Live features: HDR bloom · point-light shadow casting · Earth's cloud layer,
ocean specular and night-side city lights · Saturn's rings · the Moon ·
click-to-fly-and-track · zh-TW / English UI.

| Saturn, seen near pole-on: ring system and polar region | Mars, terminator crossing the disc |
|---|---|
| <img src="docs/screenshots/saturn.jpg" alt="Saturn seen from near its pole, ring system forming concentric circles around the disc" width="420"> | <img src="docs/screenshots/mars.jpg" alt="Mars, lit crescent falling off into night side" width="420"> |

---

## Table of contents

- [Quick start](#quick-start)
- [Why it looks the way it does](#why-it-looks-the-way-it-does)
  - [True orbital mechanics, compressed distances](#true-orbital-mechanics-compressed-distances)
  - [The black hole](#the-black-hole)
  - [The soft terminator (and a bloom bug it caused)](#the-soft-terminator-and-a-bloom-bug-it-caused)
- [Controls](#controls)
- [Project layout](#project-layout)
- [Textures](#textures)
- [Internationalization](#internationalization)
- [Auto-hiding UI](#auto-hiding-ui)
- [Performance notes](#performance-notes)
- [Browser support](#browser-support)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Quick start

The page uses ES modules and an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes#use_of_an_import_map),
so it **must be served over HTTP** — opening `index.html` with `file://` will
fail on CORS. Any static server works:

```bash
git clone https://github.com/7ohnkuu/universe.git
cd universe

python3 -m http.server 8000
# then open http://localhost:8000/
```

Other one-liners:

```bash
npx serve .                 # Node
php -S localhost:8000       # PHP
```

**Optional — 8k textures.** The repo ships 2k and 4k maps (4k is the default,
so nothing is missing to run). The 68 MB of 8k maps are not committed; fetch
and checksum them with:

```bash
./scripts/fetch-textures.sh
```

Requires macOS/Linux with `curl` and `sha256sum` or `shasum`. Re-running it is
free — existing files are verified and skipped. If an 8k file is missing, the
page still works: `loadTex()` handles per-file failure and degrades to the
procedural textures with a `console.warn`, so quality drops but nothing breaks.

---

## Why it looks the way it does

### True orbital mechanics, compressed distances

Every planet is propagated by solving **Kepler's equation** rather than being
slid around a circle:

```js
// M = E - e·sin(E)   → Newton–Raphson, 8 iterations
function solveKepler(M, e){
  M = M % TWO_PI; if (M < 0) M += TWO_PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 8; i++) E -= (E - e*Math.sin(E) - M) / (1 - e*Math.cos(E));
  return E;
}
```

The orbital elements are the real values — semi-major axis, eccentricity,
period, inclination, longitude of ascending node, argument of perihelion, axial
tilt and sidereal rotation period (Venus and Uranus rotate retrograde, hence the
negative `spinHr`). So Mercury really does lap the Sun 4.15 times per Earth
year, Mercury's orbit is visibly non-circular because its real eccentricity is
0.206, and Uranus really does roll on its side at 97.8°.

Two things *are* compressed, and the panel says so rather than letting you
quietly absorb a lie:

> Orbital distances are compressed for viewing, but relative periods,
> eccentricities and inclinations use real data.

**Distance.** Raw AU values would put Neptune 77× farther out than Mercury,
which is unwatchable. Orbital radii are scaled as:

```js
const distScale = a => Math.pow(a, 0.65) * DIST_K;   // a^0.65, not linear
```

A sub-linear power keeps the ordering and the *shape* of the spacing while
pulling the outer planets into frame.

**The Sun's size.** Planet radii are genuinely proportional to each other —
`rDisp = (radiusKm / 69911) * 8`, so Earth is 0.73× Jupiter and Mercury is
0.28×, exactly right. The Sun is not: at that scale it should be ~80 units
against Jupiter's 8, and it is set to 16. A true-scale Sun would fill the frame
and swallow the inner planets, so it is deliberately shrunk about 5×.
Planet-to-planet sizes are honest; Sun-to-planet size is a trade you should know
about.

### The black hole

The black hole is not a mesh effect — it is a **full-screen post-processing
pass** inserted between the render and the bloom:

```
RenderPass → LensingPass (screen-space deflection) → UnrealBloomPass → OutputPass
```

The shader displaces screen-space UVs as a function of the impact parameter
relative to the black hole's projected position, which produces the three
signatures you actually expect:

- **the shadow** — a true dead zone where nothing is sampled;
- **the photon ring** — a narrow, bright Gaussian ring at ≈1.06× the apparent
  horizon radius, from light that skimmed the photon sphere;
- **the lensed far side of the disk** — the back of the accretion disk is
  bent up and over the shadow, which is why the silhouette reads as an arc
  *above* the hole rather than a flat ellipse.

Because it is screen-space, it correctly lenses the **starfield and the planets**
that happen to fall behind it, not just the disk.

The black hole's screen position and apparent radius are re-derived each frame
by projecting its world position, and the strength uniform is forced to zero
unless the projection **succeeded this frame**. That guard is not pedantry: the
center of a black hole is, by definition, a region that produces no sample, so
reusing last frame's `bhUV` when the current projection fails (behind the
camera, or off-screen) leaves a photon ring floating over empty space. That
regression was reproduced and confirmed before the guard went in — hence the
explicit "only if projected this frame" condition rather than a plain smooth
ramp.

<p align="center">
  <img src="docs/screenshots/lensing.jpg" alt="Approaching the black hole: the shadow, the photon ring, and the accretion disk lensed over the top" width="900">
</p>

The composer renders into its own `WebGLRenderTarget` with `samples: 4`,
because MSAA on the default framebuffer is bypassed once you render to a target:

```js
const composerRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight,
  { type: THREE.HalfFloatType, samples: 4 });
```

`HalfFloatType` is what keeps bloom in HDR — the Sun and the disk are the two
things deliberately pushed above the 2.0 bloom threshold, and an 8-bit target
would clip them flat at 1.0 before the threshold ever saw them.

### The soft terminator (and a bloom bug it caused)

Planets lit by a single point light have a hard, cartoonish day/night boundary.
The fix is *wrap lighting*: widen the diffuse falloff across the terminator.

The naive implementation rewrites `dotNL`. **That is a trap.** In three.js's
`RE_Direct_Physical`, the same `dotNL` feeds both diffuse and specular:

```glsl
vec3 irradiance = dotNL * directLight.color;
reflectedLight.directSpecular += irradiance * BRDF_GGX(...);
```

Wrap-lighting `dotNL` injects light into the night side, where
`V_GGX_SmithCorrelated = 0.5 / max(gv + gl, EPSILON)` degenerates toward
`0.5 / EPSILON` (≈5×10⁵). Combined with a mis-sampled texel from the
`normalBias`-offset shadow map, this burns **single-pixel HDR values of
luminance 20–500** onto the terminator — far above the bloom threshold of 2.
`UnrealBloomPass`'s mip chain then smears each one into a square white blob
beside the planet. That was the reported "planets flicker" bug.

Stock `saturate()` is what masks the singularity, so the correct fix is not to
clamp harder but to **leave `dotNL` completely alone** and define a separate
term used *only* for diffuse:

```js
const WRAP_DECL = 'float dotNLwrap = pow( saturate( ( dot( geometryNormal,' +
  ' directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) ), 1.0 + uWrap );';
// injected in place of the diffuse line only:
reflectedLight.directDiffuse += dotNLwrap * directLight.color * BRDF_Lambert( material.diffuseColor );
```

`dotNL`, `irradiance` and `directSpecular` stay byte-identical to three.js
stock. Wrap width is tuned per surface type: 0.08 rock, 0.12 Earth, 0.20
gas/ice giants.

One more r160-specific gotcha: at `onBeforeCompile` time the shader source is
still the **unexpanded** `ShaderLib` string — `#include` markers are not yet
resolved. So patches must replace the include marker itself, not the code it
expands to. See `applyWrapLighting()` in `main.js`.

<details>
<summary><b>Other shader work worth reading</b></summary>

- **The Sun** is a GLSL fbm turbulence sphere with HDR self-emission — no
  texture, no geometry animation, entirely procedural in the fragment shader.
- **The starfield** is 9000 `THREE.Points` on a uniform spherical shell with a
  per-star phase attribute for twinkle. Two non-obvious decisions:
  `gl_PointSize` deliberately drops the `1/-mv.z` distance term (on a fixed
  shell radius it collapses every star to sub-pixel), and the output luminance
  is held far below the bloom threshold, or stars get rendered as squares by
  the bloom chain.
- **Earth's night side** city lights are injected into the `emissivemap`
  fragment so they only appear where `dotNL` says it is dark.
- **Procedural fallback**: if a texture fails to load, planets fall back to
  value-noise fbm maps painted onto a `<canvas>` at load time (512×256 equirect,
  then uploaded as a `CanvasTexture`), so the scene degrades to a plausible-looking
  planet instead of a magenta sphere. Color, normal and roughness are generated
  as three correlated maps from the same noise field, and data maps are tagged
  `NoColorSpace` so the GPU does not linearize them and skew the shading.

</details>

---

## Controls

| Input | Action |
|---|---|
| Drag | Orbit |
| Scroll / pinch | Zoom |
| Right-drag / two-finger drag | Pan |
| **Click a planet, the Sun or the black hole** | Fly to it and track it |
| Pause button | Freeze the simulation clock |
| Camera follow select | Free camera, any planet, or the black hole |
| Orbits / Labels / Lensing / Black hole | Toggle each layer |
| Texture resolution | 2k / 4k / 8k, reloaded live |
| 中 / EN | Switch UI language |

Touch is first-class: single finger orbits, pinch zooms, and the control panel
and legend retract on touch devices too.

There are **no keyboard shortcuts** for the simulation. Every control is
reachable by pointer and is a real `<button>` / `<select>`, so keyboard and
screen-reader users navigate the standard focus order (the panel is `aria`
labeled and its collapse/expand state is exposed via `aria-expanded` /
`aria-pressed`). Adding hotkeys is a reasonable first contribution — see
[Contributing](#contributing).

Clicking a body triggers an animated fly-in that is interruptible — grabbing the
camera mid-flight cancels the approach instead of fighting you for control.

---

## Project layout

```
.
├── index.html                 markup + all CSS + boot/error watchdog (inline)
├── main.js                    the entire scene, ~1.4k lines, one ES module
├── i18n.js                    zh-TW / English dictionary (classic script, see below)
├── scripts/
│   ├── fetch-textures.sh      downloads + SHA-256-verifies the 8k maps
│   ├── check-i18n.mjs         CI: dictionary keys must match across languages
│   └── check-assets.mjs       CI: referenced textures must exist
├── textures/                  2k (committed) · 4k (committed) · 8k (fetched)
├── vendor/                    three.js r160 + the 12 addons actually used
├── docs/screenshots/          the images in this README
├── plans/                     numbered motion-audit notes (001–006, all shipped)
├── .github/workflows/ci.yml   the three checks below, on every push/PR
├── LICENSE                    MIT, with third-party asset terms listed
└── README.md
```

`vendor/` exists so the demo has **zero network dependencies at runtime** and
so the import map resolves locally:

```html
<script type="importmap">
{ "imports": {
    "three": "./vendor/three.module.js",
    "three/addons/": "./vendor/addons/"
} }
</script>
```

Only 12 addon files are vendored (OrbitControls, the composer passes, and their
shader dependencies) rather than the whole `examples/` tree.

`main.js` is deliberately a single file. It is a demo, not a library; the
section banners are the module boundaries:

```
Planetary data · Scene/camera/renderer · Lights
Starfield (GPU points + twinkle) · Sun (GLSL fbm)
Procedural fallback textures · NASA texture loading
Building planets · Kepler solver
Black hole (horizon + disk + lensing) · Post-processing pipeline
UI wiring · Panel auto-retract · Legend auto-hide
Animation loop · Resize · Language re-render
```

---

## Textures

Three resolution tiers, switchable at runtime from the UI:

| Tier | Files | Size | Provenance |
|---|---|---|---|
| 2k | 13 | 5.7 MB | committed (no prefix) — 9 byte-identical to upstream 2k, 4 from three.js |
| 4k | 9 | 19.6 MB | committed (`4k_*`) — byte-identical to `sips -Z 4096` of the 8k files |
| 8k | 7 | 68 MB | `./scripts/fetch-textures.sh` (`8k_*`) — byte-identical to upstream |

Source: the [Solar System Scope texture pack](https://www.solarsystemscope.com/textures/),
CC BY 4.0, public-domain-derived NASA imagery. Every claim in that table was
checked by SHA-256 against the live upstream. Four Earth maps instead come from
the three.js examples (MIT): `earth_daymap.jpg`, `earth_normal.jpg`,
`earth_specular.jpg` and `earth_clouds.jpg` (the last is PNG data under a `.jpg`
name, inherited from the original three.js filename). See [LICENSE](LICENSE) for
the exact provenance of each, which matters if you redistribute this repo.

**The 4k tier is derived, not downloaded.** Solar System Scope publishes only 2k
and 8k; the committed `4k_*` files are downscales of the 8k originals, and they
reproduce byte-for-byte with:

```bash
for f in textures/8k_*; do sips -Z 4096 "$f" --out "${f/8k_/4k_}"; done
```

That is why 4k is committed and 8k is not: 4k is cheap to ship and is the
default, while 8k is 68 MB of raw upstream bytes you can fetch yourself in about
a minute. File sizes behave as they should — each 4k is ≈¼ of its 8k parent, as
expected for ¼ the pixels.

(That byte-for-byte reproduction is specific to `sips` and its JPEG encoder. A
downscale via ImageMagick or a browser canvas will look identical but hash
differently, so don't "regenerate" the 4k set on Linux expecting the hashes to
match.)

Two upstream quirks the code encodes deliberately. Uranus and Neptune exist only
at 2k, so they resolve to the same file at every tier. And **Jupiter and Saturn
have no real 8k** — upstream's `8k_jupiter.jpg` and `8k_saturn.jpg` are 4096 px
wide, i.e. the 4k images under an 8k filename. So 8k aliases to 4k for those two
rather than pretending to sharpen. Verified by hash: `8k_jupiter.jpg`,
`4k_jupiter.jpg` and upstream's 8k are all the same bytes. The code comments
record this so nobody "fixes" it later.

Decoding happens off the main thread via `ImageBitmapLoader` (browser thread
pool for JPEG decode), falling back to `TextureLoader` where unsupported.
Switching tiers bumps a **generation counter**; in-flight loads from a
superseded generation are discarded and disposed, which is what prevents 8k and
2k requests racing each other into the wrong material.

---

## Internationalization

The UI is bilingual Traditional Chinese / English, auto-detected and switchable
at runtime with no reload and no flash of the wrong language.

`i18n.js` is loaded as a **classic script before `main.js`**, and that ordering
is load-bearing: `<script type="module">` is always deferred, so if the
dictionary were a module the page would paint Chinese and then jump to English.
A blocking classic script localizes the static markup *before first paint*.

Detection priority is `?lang=` → `localStorage` → `navigator.languages`
(`/^zh/` → `zh-TW`, anything else → `en`). Manually switching rewrites the `?lang=`
query via `history.replaceState`, otherwise a deep link would outrank the
user's explicit choice forever and snap them back on reload.

Three design decisions worth stealing:

**Planet names are logic keys, not display strings.** `p.name === '地球'` gates
the night-lights patch, `'土星'` gates the ring, and the texture path map is
keyed the same way. Translating those would break the scene. So a display
layer (`pname()`) localizes only what is *shown*, never what is *compared*.

**`main.js` keeps its own Chinese fallback table.** If `i18n.js` fails to load,
a naive `t(k) => k` would overwrite correct Chinese markup with raw keys like
`unit.yrPerSec`. Returning the raw key is *worse* than a hardcoded fallback, so
`main.js` carries a small `ZH` table and degrades to a fully Chinese UI. This
is tested by blocking `i18n.js` at the network layer.

**The inline boot/error script does not import anything.** It must be able to
report an error even when `main.js` *or* three.js failed to load, so it uses a
guarded `window.__i18n` lookup with Chinese literals, and resolves already-shown
messages lazily through `dataset.msg` so an error banner re-translates when you
switch language.

Some elements must opt **out** of re-translation: `#loader` drops its
`data-i18n` key when the texture phase begins (otherwise every language switch
resets the progress bar to "Initializing…"), and so does `#pause` once its
label reflects the running state.

---

## Auto-hiding UI

Neither overlay is allowed to permanently occupy screen.

**Control panel** (top-left) retracts after **6 s** of inactivity, sliding out
with `translateX(calc(-100% - 20px))`; a compact "Controls" pill remains to
recall it. A 📌 pin button disables auto-retract and persists the choice to
`localStorage`; a ✕ hides it immediately.

The details that took the most debugging:

- **Operating the canvas counts as activity.** Dragging to orbit or scrolling to
  zoom resets the idle timer, or the panel vanishes while you are looking at the
  result of using it.
- **The timer starts when loading finishes, not at module eval.** `#loader`
  covers the screen for several seconds; counting that idle time produced
  "the panel disappears the instant the scene appears."
- **A hovering cursor counts as activity** — the idle tick checks
  `:hover`, but only on devices reporting `(hover: hover)`, because touch
  devices leave sticky `:hover` states that would pin the panel open forever.
- **`visibility` is transitioned with a delay on the `.collapsed` rule only.**
  On the base rule it also delays *expansion* by 240 ms, which reads as broken.
- **`transform` + `opacity`, never `width` or `display`** — those force layout,
  and the CSS2D label layer reflows behind them.
- Focus is moved to the recall button on collapse when focus was inside the
  panel, so keyboard users are not left pointing at nothing.

**Legend** (bottom-right) hides after **12 s**, or immediately via a ✕ that only
appears on hover. Once dismissed by hand it stays dismissed for the session —
auto-returning after an explicit "no thanks" is worse than not offering it. A
lightweight "Legend" pill recalls it and restarts the countdown.

Its container is `pointer-events: none` with `auto` only on the button: it is
informational text that was silently eating orbit drags in that corner.

Both honor `prefers-reduced-motion` (no slide, instant visibility flip). On
narrow viewports the legend is `display:none` outright — it never shows, so the
recall pill must not either (verified) — and the panel slides *upward* instead
of sideways, since it is full-width across the top there.

---

## Performance notes

- **Default is 4k, not 8k.** 8k costs ~68 MB of downloads and a large VRAM
  footprint for a difference you cannot see at the default camera distance.
- **Bloom threshold 2.0 with `smoothWidth` 0.3.** The `UnrealBloomPass` default
  high-pass band (0.01) is so tight that specular highlights pop in and out
  frame to frame; widening the band made the glow stable. This is a real fix for
  a real flicker, distinct from the terminator bug above.
- **Shadow map is 1024² with `far: 700`,** not the defaults. It is a *cube*
  shadow map (6 faces), and per the code comment its only job is the Moon and
  eclipse rendering — so resolution is deliberately modest. `far` was cut from
  4000 to 700 to just cover Neptune's compressed orbit (~600 units), which buys
  back depth precision.
- **Light intensity is set by a bloom budget, not by taste.** `decay: 0` with
  `intensity: 6.0` pushed every planet's dayside to linear luminance 2–3, i.e.
  entirely above the bloom threshold of 2.0 — the whole sphere glowed and the
  mip chain smeared it into squares (visible in a Venus screenshot). At 1.3 the
  peak is `albedo(0.9) × 1.3 ≈ 1.17`; plus additively-blended stars (≤0.5) it
  still stays under the threshold, so **only** the Sun (×3.0) and the disk
  (col×2.0) are allowed to bloom. When you raise a light or a material's
  emissive, you are spending from this budget.
- **The starfield is one draw call** (9000 points, `frustumCulled = false`
  because it is a shell that always surrounds the camera).
- **Per-frame allocation is small but not zero.** Orbital state uses reused
  scratch vectors (`_wp`, `_cam`, `_tmpV`, `_sv`) and exponential damping
  (`1 - exp(-λ·dt)`, frame-rate independent by construction). One `Vector3` is
  still allocated per planet per frame in `updatePlanet()` (8/frame ≈ 480/s at
  60 fps) — not a bottleneck, but it is the obvious thing to hoist if you want
  to claim zero. Please do not "optimize" the scratch vectors on the assumption
  they were missed.
- **Turning the black hole off zeroes the lensing strength rather than removing
  the pass**, so the full-screen shader still runs every frame. Setting
  `lensingPass.enabled = false` would be a genuine win on weak GPUs — the
  current form exists because a strength ramp is what makes the fade
  interruptible.

---

## Browser support

Three things are required: **WebGL 2**, **ES modules**, and **import maps**.
Import maps are the binding constraint, so the practical floor is:

| | Minimum version |
|---|---|
| Chrome / Edge | 89 |
| Safari (incl. iOS) | 16.4 |
| Firefox | 108 |

Nothing newer is used: no `??=`, no class private fields, no `color-mix()`, no
`OffscreenCanvas`, no `structuredClone`. Modern-but-optional APIs degrade —
`ImageBitmapLoader` falls back to `TextureLoader`, and
`createImageBitmap` is feature-detected.

Works on mobile Safari and Chrome Android, including touch gestures. The scene
has also been verified headless under **SwiftShader** (software rendering, no
GPU at all) — it renders correctly, just slowly, which is a useful way to check
that a change is actually correct rather than just fast.

---

## Development

There is no build step, so there is no build to break. The automated gates are
small on purpose — three checks, all runnable locally and all run in CI
(`.github/workflows/ci.yml`):

```bash
node --check main.js && node --check i18n.js   # 1. both files must parse
node scripts/check-i18n.mjs                    # 2. zh-TW / en keys must match exactly
node scripts/check-assets.mjs                  # 3. textures referenced by each tier must exist
```

Check 2 exists because a missing translation key **fails silently** — `t()`
falls back to the Chinese table, so an untranslated English string is invisible
until someone reads the UI. Check 3 exists because texture paths are assembled
from strings, and a typo there just quietly degrades one planet to procedural.
Both scripts parse `main.js` / `i18n.js` rather than duplicating their tables,
so they stay honest when the data changes.

Serve the directory and edit; reload picks everything up.

A good regression check is the browser console: **the page loads with zero
errors or warnings**, including the favicon (inlined as a data-URI SVG so it
cannot 404). If a change introduces a console message, that is a real signal,
not noise to be ignored.

`plans/` contains the numbered motion-audit notes (001–006) that drove the
animation decisions — interruptible fly-in, frame-rate-independent camera,
loader fade-out, reduced-motion support, button and toggle timing. Each is a
problem statement and its resolution, useful if you want to change the motion
language without re-litigating it.

Debugging this project has generally meant measuring, not guessing: screenshot
diffing against a reference build, per-pixel luminance scans to find HDR
outliers, and scripted headless runs for UI timing. If you add something,
the same approach has caught every subtle regression here so far.

---

## Contributing

Small, focused PRs are welcome. A few notes that will save you time:

- **No build step means no build to fix.** There is no bundler, linter or test
  framework; the three CI checks above are the whole gate. Keep it that way
  unless there is a strong reason.
- **`p.name` is a Chinese logic key, not a display string.** Comparisons like
  `p.name === '地球'` gate the night-lights shader, `'土星'` gates the ring, and
  the texture path map is keyed the same way. Do not translate or rename them —
  use `pname()` for anything user-visible.
- **Comments are written in Traditional Chinese** to match the project's
  language, and they record *why* a non-obvious value was chosen (bloom
  `smoothWidth: 0.3`, `MAX_SPD` 0.8 rev/s, shadow `far: 700`). Please keep the
  reasoning, not just the number, when you change one.
- **Do not rewrite `dotNL` in a lighting patch.** See
  [the soft terminator](#the-soft-terminator-and-a-bloom-bug-it-caused) — this
  is the single most expensive mistake available in this codebase.
- **UI strings go through `t()`.** Hardcoding a literal in `main.js` silently
  breaks one of the two languages; the audit for that is mechanical, so CI-style
  grepping for Chinese literals outside the fallback table is a reasonable check.

Good first contributions: keyboard shortcuts for pause/orbits/labels, hoisting
the per-frame `Vector3` in `updatePlanet()`, disabling `lensingPass` outright
when the black hole is off, or a CSS2D label declutter pass (Latin labels are
wider than CJK ones and collide at the default zoom).

---

## License

The code in this repository is released under the **MIT License** — see
[LICENSE](LICENSE).

Third-party assets are **not** MIT and keep their own terms, enumerated in the
LICENSE file:

| Asset | License | Notes |
|---|---|---|
| `vendor/` (three.js r160 + 12 addons) | MIT | © 2010–2023 Three.js Authors |
| `textures/` (Solar System Scope pack) | CC BY 4.0 | attribution required if you redistribute |
| 4 Earth maps in `textures/` | MIT | from three.js examples, not Solar System Scope |

If you fork and redistribute the textures, keep the attribution. The 8k tier is
excluded from this repo for size; `scripts/fetch-textures.sh` retrieves it from
the original CC BY 4.0 source and verifies each file's SHA-256.
