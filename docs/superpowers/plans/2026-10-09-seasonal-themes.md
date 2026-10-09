# Seasonal Themes (Bloom, Solstice, Harvest, Frost) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four new built-in theme packages (Bloom/spring, Solstice/summer, Harvest/fall, Frost/winter), each with a light and dark palette and weather-reactive ambience, plus a new "Automatic (by season)" option that switches between them by calendar date.

**Architecture:** Every theme is pure data — a `theme.json` manifest plus fonts and a handful of small SVG assets — discovered automatically by the existing `import.meta.glob`-based theme registry (`client/src/utils/themes.js`). Weather reactivity uses the engine's existing, already-implemented `weather.scenes` feature (`client/src/utils/weatherScenes.js`, `useWeatherCondition.js`, `app.jsx`) — no new engine code. The only new *code* in this plan is a small pure function that maps a date (and hemisphere) to a season, a one-value addition to the `theme` field's accepted values, and the plumbing in `app.jsx` and the appearance UI that makes that value mean something.

**Tech Stack:** React 19, Vite (`import.meta.glob` theme discovery), Vitest, the existing theme/ambience engine in `client/src/themes/engine/`.

**Spec:** `docs/superpowers/specs/2026-10-09-seasonal-themes-design.md`

## Global Constraints

- No theme may set spacing, font-size, or line-height — only colors, fonts (family), frame/button tokens, and ambience (spec Non-goals; enforced structurally: these aren't even accepted token types).
- Every ambience layer must respect the engine's universal rules unchanged: only `transform`/`opacity` animate, nothing renders under `prefers-reduced-motion`, nothing renders while inactive — these are enforced by the engine itself, not by manifest content, so no task needs to implement them.
- No `ambience` list may exceed `MAX_LAYERS` (12) — `engine/schemas.js`.
- A weather scene's own `ambience`, where present, **replaces** the theme's base ambience outright (does not merge) — `withWeatherScene` in `utils/themes.js`. Every scene below that should keep a baseline layer repeats it explicitly.
- Reuse the fallback chains already built into `WEATHER_SCENE_FALLBACKS` (`weatherScenes.js`) rather than defining every condition explicitly: `pouring`→`rainy`, `lightning`→`rainy`, `lightning-rainy`→`lightning`→`rainy`, `snowy-rainy`→`snowy`, `hail`→`snowy-rainy`→`snowy`, `windy-variant`→`windy`. Defining `rainy`, `lightning`, `snowy` (Frost only), and `windy` (Harvest only) covers all thirteen conditions with identical visible behavior to defining every one, and matches the engine's own documented "a theme can be made a few scenes at a time" design.
- `'clear-night'` is aliased to `'sunny'` by the engine (`ALIASES` in `weatherScenes.js`) — a theme's night-time clear-sky touch belongs in its `sunny` scene's `ambience`, scoped `modes: ["dark"]`, not in a separate scene.
- This app has no component-rendering test framework — all new automated tests are pure-function Vitest tests, consistent with the constraint carried over from the drag-resize plan. Verification of visual/ambience correctness is manual, via the admin panel's existing scene-preview feature.
- Do not touch `classic.css`, `gridLayout.js`, `gridPlacement.js`, or `layoutSync.js`.

## Review Focus

- A theme with no base `ambience` (Frost, Solstice) must not break `withWeatherScene`'s fallback to `theme.ambience` when a scene is undefined — covered by Task 6's existing-loop test over `BUILT_IN_THEMES` plus Task 10's manual scene-preview check.
- `'auto-season'` stored as a device's theme and then that theme folder structure changing (e.g. a future removal) must not crash `app.jsx` — covered by Task 8's `themeKnown`-treats-it-as-known decision, explicit in that task's code.
- A display with no configured location (`autoDark.lat` undefined) selecting "Automatic (by season)" must still show a reasonable season, not crash or show nothing — covered by Task 7's no-`lat`-defaults-to-Northern test.
- The exact month a season changes (e.g. Feb 28/Mar 1, Aug 31/Sep 1) is where an off-by-one in month-range logic would silently ship wrong — covered explicitly by Task 7's boundary tests.
- Adding four theme folders changes what `BUILT_IN_THEMES` contains, which an existing test (`themes.test.js`) currently pins to exactly `['classic']` — covered by Task 6, which updates that assertion; left unfixed, this would be a pre-existing-test failure masking a real regression in the discovery mechanism.

---

## Task 1: Source Inter font files and the four seasonal SVG assets

**Files:**
- Create: `client/src/themes/_staging/inter/Inter-Regular.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`, `Inter-OFL.txt`
- Create: `client/src/themes/_staging/assets/petal.svg`, `leaf.svg`, `bird.svg`, `bee.svg`

**Interfaces:**
- Produces: a staging folder of font files (copied into each of the four theme folders in Tasks 2–5) and four SVG asset files (copied into Harvest's and Bloom's `assets/` folders in Tasks 4–5). `_staging/` is scratch — delete it in Task 10 once every theme folder has its own copies.

No tests — this is asset sourcing, not code. Verification is that the files exist and are non-empty/valid.

- [ ] **Step 1: Create the staging directories**

```bash
mkdir -p client/src/themes/_staging/inter client/src/themes/_staging/assets
```

- [ ] **Step 2: Download Inter's three weights via Google Fonts' CSS2 API**

Google Fonts serves Inter's actual `.woff2` files (Google-hosted, OFL-licensed, identical glyphs to Inter's own distribution). A modern `Accept` header is required or the API serves an older format.

```bash
cd client/src/themes/_staging/inter
for WEIGHT in 400 600 700; do
  CSS=$(curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
    "https://fonts.googleapis.com/css2?family=Inter:wght@${WEIGHT}&display=swap")
  URL=$(echo "$CSS" | grep -o "https://fonts.gstatic.com/[^)]*\.woff2" | head -1)
  curl -s -o "weight-${WEIGHT}.woff2" "$URL"
done
mv weight-400.woff2 Inter-Regular.woff2
mv weight-600.woff2 Inter-SemiBold.woff2
mv weight-700.woff2 Inter-Bold.woff2
ls -la
```

Expected: three `.woff2` files, each at least a few KB (not a 0-byte or HTML-error file — if `curl` got rate-limited or the markup changed, the file will be tiny; check with `file Inter-Regular.woff2`, expecting `Web Open Font Format`).

- [ ] **Step 3: Download Inter's OFL license**

```bash
curl -s -o Inter-OFL.txt "https://raw.githubusercontent.com/rsms/inter/main/LICENSE.txt"
head -5 Inter-OFL.txt
```

Expected: starts with `Copyright 2016 The Inter Project Authors`.

- [ ] **Step 4: Create the four SVG assets**

`client/src/themes/_staging/assets/petal.svg` (soft pink, used by Bloom only — fixed color is fine since it's never mode-tinted):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C7 7 4 12 4 16a8 8 0 0 0 16 0c0-4-3-9-8-14z" fill="#F2A6C6"/></svg>
```

`client/src/themes/_staging/assets/leaf.svg` (warm pumpkin orange, used by Harvest only):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2c4 2 8 6 8 11a8 8 0 0 1-16 0c0-5 4-9 8-11z" fill="#D9772E"/><path d="M12 4v17" stroke="#B5582199" stroke-width="1" fill="none"/></svg>
```

`client/src/themes/_staging/assets/bird.svg` (a simple double-wing silhouette, light mode only, used by Bloom's `sunny` scene):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16"><path d="M0 8c4-6 10-7 14-2 2-3 8-5 14-2-4 1-8 3-10 5 2 2 6 4 10 5-6 3-12 2-14-1-4 3-10 2-14-5z" fill="#4A3F45"/></svg>
```

`client/src/themes/_staging/assets/bee.svg` (used by Bloom's `sunny` scene, light mode only):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 16"><ellipse cx="7" cy="5" rx="3" ry="2.2" fill="#F5C51899"/><ellipse cx="12" cy="5" rx="3" ry="2.2" fill="#F5C51866"/><rect x="8" y="7" width="6" height="7" rx="3" fill="#2B2A28"/><rect x="8" y="9" width="6" height="1.6" fill="#F5C518"/><rect x="8" y="12" width="6" height="1.6" fill="#F5C518"/></svg>
```

- [ ] **Step 5: Verify every file**

```bash
file client/src/themes/_staging/inter/*.woff2
cat client/src/themes/_staging/inter/Inter-OFL.txt | head -1
for f in petal leaf bird bee; do xmllint --noout "client/src/themes/_staging/assets/$f.svg" && echo "$f.svg OK"; done
```

Expected: each `.woff2` reports `Web Open Font Format`; the OFL file's first line is the copyright line from Step 3; each SVG parses with no `xmllint` error and prints `OK`. (`xmllint` ships with Git Bash/most Linux boxes; if unavailable, open each file and confirm it's well-formed XML by eye instead.)

- [ ] **Step 6: Commit**

```bash
git add client/src/themes/_staging
git commit -m "chore(themes): stage Inter fonts and seasonal ambience assets"
```

---

## Task 2: Frost (winter) theme folder

**Files:**
- Create: `client/src/themes/frost/theme.json`
- Create: `client/src/themes/frost/fonts/Inter-Regular.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`, `OFL.txt`

**Interfaces:**
- Produces: a discoverable theme folder with `id: "frost"`. Consumed by the existing `BUILT_IN_THEMES` discovery glob (`utils/themes.js`) — no code changes needed for it to appear, per the architecture's "adding a theme means adding a folder."

- [ ] **Step 1: Copy the staged fonts**

```bash
mkdir -p client/src/themes/frost/fonts
cp client/src/themes/_staging/inter/Inter-Regular.woff2 client/src/themes/frost/fonts/
cp client/src/themes/_staging/inter/Inter-SemiBold.woff2 client/src/themes/frost/fonts/
cp client/src/themes/_staging/inter/Inter-Bold.woff2 client/src/themes/frost/fonts/
cp client/src/themes/_staging/inter/Inter-OFL.txt client/src/themes/frost/fonts/OFL.txt
```

- [ ] **Step 2: Write the manifest**

`client/src/themes/frost/theme.json`:

```json
{
  "manifestVersion": 4,
  "id": "frost",
  "name": "Frost",
  "version": "1.0.0",
  "author": "HomeGlow",
  "description": "Crisp winter light by day, a clear cold night by night — with snow when it's actually snowing.",
  "extends": "classic",
  "modes": ["light", "dark"],
  "colors": { "primary": "#F3F8FB", "secondary": "#4FA6D8", "accent": "#4FA6D8" },
  "fonts": [
    { "family": "Inter", "weight": 400, "src": "fonts/Inter-Regular.woff2" },
    { "family": "Inter", "weight": 600, "src": "fonts/Inter-SemiBold.woff2" },
    { "family": "Inter", "weight": 700, "src": "fonts/Inter-Bold.woff2" }
  ],
  "tokens": {
    "all": {
      "--hg-font-body": "'Inter', sans-serif",
      "--hg-font-heading": "'Inter', sans-serif",
      "--hg-grid-gap": "24px",
      "--hg-button-radius": "999px",
      "--hg-button-weight": "600"
    },
    "light": {
      "--background": "#F3F8FB",
      "--surface": "#FFFFFF",
      "--text": "#26333A",
      "--text-secondary": "#5B6B74",
      "--border": "#E1ECF2",
      "--accent": "#4FA6D8",
      "--accent-rgb": "79, 166, 216",
      "--hg-frame-bg": "#FFFFFF",
      "--hg-frame-radius": "14px",
      "--hg-frame-shadow": "0 8px 24px rgba(79, 166, 216, 0.12)",
      "--hg-button-bg": "#4FA6D8",
      "--hg-button-text": "#FFFFFF"
    },
    "dark": {
      "--background": "#080E14",
      "--surface": "#101922",
      "--text": "#E8F2F7",
      "--text-secondary": "#8FA6B3",
      "--border": "#1C2733",
      "--accent": "#5FC9E8",
      "--accent-rgb": "95, 201, 232",
      "--hg-frame-bg": "#101922",
      "--hg-frame-radius": "12px",
      "--hg-frame-shadow": "none",
      "--hg-button-bg": "#5FC9E8",
      "--hg-button-text": "#080E14"
    }
  },
  "weather": {
    "default": { "ambience": [] },
    "scenes": {
      "sunny": {
        "ambience": [
          { "layer": "particles", "modes": ["dark"], "motion": "twinkle", "colors": ["#E8F2F7", "#C9E6F2"], "count": 12, "size": [1, 3], "seconds": [3, 8], "opacity": 0.8 }
        ]
      },
      "rainy": {
        "ambience": [
          { "layer": "particles", "motion": "fall", "colors": ["#9FB8C8"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.55 }
        ]
      },
      "snowy": {
        "ambience": [
          { "layer": "particles", "motion": "fall", "colors": ["#FFFFFF", "#E8F2F7"], "count": 13, "size": [3, 6], "seconds": [10, 18], "drift": 30, "opacity": 0.85 }
        ]
      },
      "lightning": {
        "ambience": [
          { "layer": "particles", "motion": "fall", "colors": ["#9FB8C8"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.55 },
          { "layer": "flash", "color": "#E8F2F7", "every": [25, 90], "strength": 0.3, "double": false }
        ]
      }
    }
  }
}
```

This manifest's real validation happens in Task 6, once all four folders
exist and `themes.test.js`'s existing loop test runs `validateThemePackage`
against each — this task doesn't claim that check on its own.

- [ ] **Step 3: Commit**

```bash
git add client/src/themes/frost
git commit -m "feat(themes): add Frost (winter) theme"
```

---

## Task 3: Solstice (summer) theme folder

**Files:**
- Create: `client/src/themes/solstice/theme.json`
- Create: `client/src/themes/solstice/fonts/Inter-Regular.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`, `OFL.txt`

**Interfaces:**
- Produces: a discoverable theme folder with `id: "solstice"`, same discovery mechanism as Task 2.

- [ ] **Step 1: Copy the staged fonts**

```bash
mkdir -p client/src/themes/solstice/fonts
cp client/src/themes/_staging/inter/Inter-Regular.woff2 client/src/themes/solstice/fonts/
cp client/src/themes/_staging/inter/Inter-SemiBold.woff2 client/src/themes/solstice/fonts/
cp client/src/themes/_staging/inter/Inter-Bold.woff2 client/src/themes/solstice/fonts/
cp client/src/themes/_staging/inter/Inter-OFL.txt client/src/themes/solstice/fonts/OFL.txt
```

- [ ] **Step 2: Write the manifest**

`client/src/themes/solstice/theme.json`:

```json
{
  "manifestVersion": 4,
  "id": "solstice",
  "name": "Solstice",
  "version": "1.0.0",
  "author": "HomeGlow",
  "description": "Bright, clean and still by day; the odd shooting star on a clear summer night.",
  "extends": "classic",
  "modes": ["light", "dark"],
  "colors": { "primary": "#FFFCF2", "secondary": "#00BFA6", "accent": "#00BFA6" },
  "fonts": [
    { "family": "Inter", "weight": 400, "src": "fonts/Inter-Regular.woff2" },
    { "family": "Inter", "weight": 600, "src": "fonts/Inter-SemiBold.woff2" },
    { "family": "Inter", "weight": 700, "src": "fonts/Inter-Bold.woff2" }
  ],
  "tokens": {
    "all": {
      "--hg-font-body": "'Inter', sans-serif",
      "--hg-font-heading": "'Inter', sans-serif",
      "--hg-grid-gap": "24px",
      "--hg-button-radius": "999px",
      "--hg-button-weight": "600"
    },
    "light": {
      "--background": "#FFFCF2",
      "--surface": "#FFFFFF",
      "--text": "#2B2A28",
      "--text-secondary": "#6B6A62",
      "--border": "#F0ECDD",
      "--accent": "#00BFA6",
      "--accent-rgb": "0, 191, 166",
      "--hg-frame-bg": "#FFFFFF",
      "--hg-frame-radius": "16px",
      "--hg-frame-shadow": "0 8px 24px rgba(0, 191, 166, 0.14)",
      "--hg-button-bg": "#00BFA6",
      "--hg-button-text": "#FFFFFF"
    },
    "dark": {
      "--background": "#071A1C",
      "--surface": "#0E2B2E",
      "--text": "#F0FFFC",
      "--text-secondary": "#8FC4BE",
      "--border": "#133538",
      "--accent": "#00E6C9",
      "--accent-rgb": "0, 230, 201",
      "--hg-frame-bg": "#0E2B2E",
      "--hg-frame-radius": "16px",
      "--hg-frame-shadow": "none",
      "--hg-button-bg": "#00E6C9",
      "--hg-button-text": "#071A1C"
    }
  },
  "weather": {
    "default": { "ambience": [] },
    "scenes": {
      "sunny": {
        "ambience": [
          { "layer": "streaks", "modes": ["dark"], "color": "#CFF5EE", "length": 120, "every": [300, 900], "seconds": [1.5, 3], "burst": 1 }
        ]
      },
      "rainy": {
        "ambience": [
          { "layer": "particles", "motion": "fall", "colors": ["#7FB8B0"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.5 }
        ]
      },
      "lightning": {
        "ambience": [
          { "layer": "particles", "motion": "fall", "colors": ["#7FB8B0"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.5 },
          { "layer": "flash", "color": "#F0FFFC", "every": [25, 90], "strength": 0.3, "double": false }
        ]
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/themes/solstice
git commit -m "feat(themes): add Solstice (summer) theme"
```

---

## Task 4: Harvest (fall) theme folder

**Files:**
- Create: `client/src/themes/harvest/theme.json`
- Create: `client/src/themes/harvest/fonts/Inter-Regular.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`, `OFL.txt`
- Create: `client/src/themes/harvest/assets/leaf.svg`

**Interfaces:**
- Produces: a discoverable theme folder with `id: "harvest"`.

- [ ] **Step 1: Copy the staged fonts and leaf asset**

```bash
mkdir -p client/src/themes/harvest/fonts client/src/themes/harvest/assets
cp client/src/themes/_staging/inter/Inter-Regular.woff2 client/src/themes/harvest/fonts/
cp client/src/themes/_staging/inter/Inter-SemiBold.woff2 client/src/themes/harvest/fonts/
cp client/src/themes/_staging/inter/Inter-Bold.woff2 client/src/themes/harvest/fonts/
cp client/src/themes/_staging/inter/Inter-OFL.txt client/src/themes/harvest/fonts/OFL.txt
cp client/src/themes/_staging/assets/leaf.svg client/src/themes/harvest/assets/
```

- [ ] **Step 2: Write the manifest**

`client/src/themes/harvest/theme.json`:

```json
{
  "manifestVersion": 4,
  "id": "harvest",
  "name": "Harvest",
  "version": "1.0.0",
  "author": "HomeGlow",
  "description": "Warm and cozy, with leaves always gently falling — and blowing hard when the wind picks up.",
  "extends": "classic",
  "modes": ["light", "dark"],
  "colors": { "primary": "#FBF1E6", "secondary": "#D9772E", "accent": "#D9772E" },
  "fonts": [
    { "family": "Inter", "weight": 400, "src": "fonts/Inter-Regular.woff2" },
    { "family": "Inter", "weight": 600, "src": "fonts/Inter-SemiBold.woff2" },
    { "family": "Inter", "weight": 700, "src": "fonts/Inter-Bold.woff2" }
  ],
  "tokens": {
    "all": {
      "--hg-font-body": "'Inter', sans-serif",
      "--hg-font-heading": "'Inter', sans-serif",
      "--hg-grid-gap": "24px",
      "--hg-button-radius": "999px",
      "--hg-button-weight": "600"
    },
    "light": {
      "--background": "#FBF1E6",
      "--surface": "#FFF8EF",
      "--text": "#3B2A20",
      "--text-secondary": "#8A7259",
      "--border": "#EFE1CC",
      "--accent": "#D9772E",
      "--accent-rgb": "217, 119, 46",
      "--hg-frame-bg": "#FFF8EF",
      "--hg-frame-radius": "20px",
      "--hg-frame-shadow": "0 10px 28px rgba(217, 119, 46, 0.16)",
      "--hg-button-bg": "#D9772E",
      "--hg-button-text": "#FFFFFF"
    },
    "dark": {
      "--background": "#1A100C",
      "--surface": "#2A1A13",
      "--text": "#F5E8DC",
      "--text-secondary": "#B89A82",
      "--border": "#3A251A",
      "--accent": "#E08A3C",
      "--accent-rgb": "224, 138, 60",
      "--hg-frame-bg": "#2A1A13",
      "--hg-frame-radius": "18px",
      "--hg-frame-shadow": "none",
      "--hg-button-bg": "#E08A3C",
      "--hg-button-text": "#1A100C"
    }
  },
  "ambience": [
    { "layer": "particles", "src": "assets/leaf.svg", "motion": "fall", "count": 6, "size": [10, 18], "seconds": [12, 20], "drift": 60, "opacity": 0.85 }
  ],
  "weather": {
    "scenes": {
      "windy": {
        "ambience": [
          { "layer": "particles", "src": "assets/leaf.svg", "motion": "fall", "count": 15, "size": [10, 18], "seconds": [5, 9], "drift": 180, "opacity": 0.9 }
        ]
      },
      "rainy": {
        "ambience": [
          { "layer": "particles", "src": "assets/leaf.svg", "motion": "fall", "count": 3, "size": [10, 18], "seconds": [12, 20], "drift": 60, "opacity": 0.85 },
          { "layer": "particles", "motion": "fall", "colors": ["#8FA08A"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.5 }
        ]
      },
      "lightning": {
        "ambience": [
          { "layer": "particles", "src": "assets/leaf.svg", "motion": "fall", "count": 3, "size": [10, 18], "seconds": [12, 20], "drift": 60, "opacity": 0.85 },
          { "layer": "particles", "motion": "fall", "colors": ["#8FA08A"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.5 },
          { "layer": "flash", "color": "#F5E8DC", "every": [25, 90], "strength": 0.3, "double": false }
        ]
      }
    }
  }
}
```

Note: Harvest's `ambience` (the theme's base, always-on look) is a top-level field, separate from `weather.default` — leaving `weather.default` unset falls back to this base `ambience` automatically (`withWeatherScene` returns `theme.ambience` when no scene/no scene ambience applies), so it doesn't need repeating under `weather.default` explicitly.

- [ ] **Step 3: Commit**

```bash
git add client/src/themes/harvest
git commit -m "feat(themes): add Harvest (fall) theme"
```

---

## Task 5: Bloom (spring) theme folder

**Files:**
- Create: `client/src/themes/bloom/theme.json`
- Create: `client/src/themes/bloom/fonts/Inter-Regular.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`, `OFL.txt`
- Create: `client/src/themes/bloom/assets/petal.svg`, `bird.svg`, `bee.svg`

**Interfaces:**
- Produces: a discoverable theme folder with `id: "bloom"`.

**Note on the manifest below vs. the spec's wording:** the spec describes
Bloom's base `field` glow as having no mode restriction, but the manifest
scopes it `modes: ["light"]` only, matching Reef's own existing `field`
layer (also light-only, per the architecture doc's Reef example) — a soft
light-pattern overlay doesn't read well against a dark background, and
Bloom's dark palette already carries its own mood without it. The petals
layer still has no `modes` restriction, exactly as spec'd.

- [ ] **Step 1: Copy the staged fonts and assets**

```bash
mkdir -p client/src/themes/bloom/fonts client/src/themes/bloom/assets
cp client/src/themes/_staging/inter/Inter-Regular.woff2 client/src/themes/bloom/fonts/
cp client/src/themes/_staging/inter/Inter-SemiBold.woff2 client/src/themes/bloom/fonts/
cp client/src/themes/_staging/inter/Inter-Bold.woff2 client/src/themes/bloom/fonts/
cp client/src/themes/_staging/inter/Inter-OFL.txt client/src/themes/bloom/fonts/OFL.txt
cp client/src/themes/_staging/assets/petal.svg client/src/themes/bloom/assets/
cp client/src/themes/_staging/assets/bird.svg client/src/themes/bloom/assets/
cp client/src/themes/_staging/assets/bee.svg client/src/themes/bloom/assets/
```

- [ ] **Step 2: Write the manifest**

`client/src/themes/bloom/theme.json`:

```json
{
  "manifestVersion": 4,
  "id": "bloom",
  "name": "Bloom",
  "version": "1.0.0",
  "author": "HomeGlow",
  "description": "Soft pastels with petals drifting by, birds and bees on a sunny day, fireflies after dark.",
  "extends": "classic",
  "modes": ["light", "dark"],
  "colors": { "primary": "#FBF5F8", "secondary": "#F2A6C6", "accent": "#F2A6C6" },
  "fonts": [
    { "family": "Inter", "weight": 400, "src": "fonts/Inter-Regular.woff2" },
    { "family": "Inter", "weight": 600, "src": "fonts/Inter-SemiBold.woff2" },
    { "family": "Inter", "weight": 700, "src": "fonts/Inter-Bold.woff2" }
  ],
  "tokens": {
    "all": {
      "--hg-font-body": "'Inter', sans-serif",
      "--hg-font-heading": "'Inter', sans-serif",
      "--hg-grid-gap": "24px",
      "--hg-button-radius": "999px",
      "--hg-button-weight": "600"
    },
    "light": {
      "--background": "#FBF5F8",
      "--surface": "#FFFFFF",
      "--text": "#4A3F45",
      "--text-secondary": "#8A7A82",
      "--border": "#F3E3EC",
      "--accent": "#F2A6C6",
      "--accent-rgb": "242, 166, 198",
      "--hg-frame-bg": "#FFFFFF",
      "--hg-frame-radius": "20px",
      "--hg-frame-shadow": "0 10px 28px rgba(242, 166, 198, 0.18)",
      "--hg-button-bg": "#F2A6C6",
      "--hg-button-text": "#4A3F45"
    },
    "dark": {
      "--background": "#221B22",
      "--surface": "#2E2630",
      "--text": "#F3E9ED",
      "--text-secondary": "#B49FA8",
      "--border": "#3A2F38",
      "--accent": "#E88FB3",
      "--accent-rgb": "232, 143, 179",
      "--hg-frame-bg": "#2E2630",
      "--hg-frame-radius": "18px",
      "--hg-frame-shadow": "none",
      "--hg-button-bg": "#E88FB3",
      "--hg-button-text": "#221B22"
    }
  },
  "ambience": [
    { "layer": "field", "modes": ["light"], "strength": "soft", "spacing": 220, "seconds": 60 },
    { "layer": "particles", "src": "assets/petal.svg", "motion": "fall", "count": 7, "size": [8, 14], "seconds": [14, 22], "drift": 50, "opacity": 0.8 }
  ],
  "weather": {
    "scenes": {
      "sunny": {
        "ambience": [
          { "layer": "field", "modes": ["light"], "strength": "soft", "spacing": 220, "seconds": 60 },
          { "layer": "particles", "src": "assets/petal.svg", "motion": "fall", "count": 7, "size": [8, 14], "seconds": [14, 22], "drift": 50, "opacity": 0.8 },
          { "layer": "flyby", "modes": ["light"], "pictures": [{ "src": "assets/bird.svg", "aspect": 2, "height": 4 }], "height": [55, 70], "every": [40, 90], "seconds": [16, 24], "span": [10, 60] },
          { "layer": "flyby", "modes": ["light"], "pictures": [{ "src": "assets/bee.svg", "aspect": 1.25, "height": 2.5 }], "height": [20, 35], "every": [20, 50], "seconds": [6, 10], "span": [5, 80] },
          { "layer": "particles", "modes": ["dark"], "motion": "twinkle", "colors": ["#F7E79A", "#E8D06A"], "count": 10, "size": [2, 4], "seconds": [4, 9], "opacity": 0.75 }
        ]
      },
      "rainy": {
        "ambience": [
          { "layer": "field", "modes": ["light"], "strength": "soft", "spacing": 220, "seconds": 60 },
          { "layer": "particles", "motion": "fall", "colors": ["#A9B8C6"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.5 }
        ]
      },
      "lightning": {
        "ambience": [
          { "layer": "field", "modes": ["light"], "strength": "soft", "spacing": 220, "seconds": 60 },
          { "layer": "particles", "motion": "fall", "colors": ["#A9B8C6"], "count": 24, "size": [2, 4], "seconds": [3, 5], "opacity": 0.5 },
          { "layer": "flash", "color": "#F3E9ED", "every": [25, 90], "strength": 0.3, "double": false }
        ]
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/themes/bloom
git commit -m "feat(themes): add Bloom (spring) theme"
```

---

## Task 6: Fix the existing discovery test and validate all four theme folders

**Files:**
- Modify: `client/src/utils/themes.test.js:54-56`

**Interfaces:**
- Consumes: `BUILT_IN_THEMES` (now populated with 5 entries instead of 1, automatically, by the existing `import.meta.glob` discovery — no production code change in this task).

- [ ] **Step 1: Update the discovery test's expectation**

Find:

```javascript
  it('are discovered from their folders, Classic first and then by name', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(['classic']);
  });
```

Replace with:

```javascript
  it('are discovered from their folders, Classic first and then by name', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(['classic', 'bloom', 'frost', 'harvest', 'solstice']);
  });
```

(Alphabetical by `name` after Classic: Bloom, Frost, Harvest, Solstice.)

- [ ] **Step 2: Run the full themes test suite**

Run: `npm --prefix client test -- themes.test.js`
Expected: PASS, including the existing `it('are valid packages, against the files in their own folders', ...)` test, which now iterates all 5 themes and runs `validateThemePackage` against each — this is where a typo in any of the four manifests from Tasks 2–5 (an unknown token, a bad color, an asset path that doesn't exist, an `ambience` layer missing a required field) gets caught. If it fails, the error names the exact theme id and field; fix the manifest, not the test.

- [ ] **Step 3: Run the full client suite**

Run: `npm --prefix client test`
Expected: PASS, all files including `appearance.test.js` (untouched by this task, confirms nothing here broke it).

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/themes.test.js
git commit -m "test(themes): update discovery test for the four new seasonal themes"
```

---

## Task 7: `resolveSeasonalThemeId` (TDD)

**Files:**
- Modify: `client/src/utils/themes.js`
- Modify: `client/src/utils/themes.test.js`

**Interfaces:**
- Produces: `resolveSeasonalThemeId(nowMs: number, lat?: number): 'bloom' | 'solstice' | 'harvest' | 'frost'`, exported from `themes.js`. Consumed by Task 8's `app.jsx` wiring.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/utils/themes.test.js`:

```javascript
describe('resolveSeasonalThemeId', () => {
  const at = (monthIndex, day) => new Date(2026, monthIndex, day).getTime();

  it('maps each Northern-hemisphere month to its season', () => {
    expect(resolveSeasonalThemeId(at(2, 15))).toBe('bloom');   // March
    expect(resolveSeasonalThemeId(at(4, 15))).toBe('bloom');   // May
    expect(resolveSeasonalThemeId(at(5, 15))).toBe('solstice'); // June
    expect(resolveSeasonalThemeId(at(7, 15))).toBe('solstice'); // August
    expect(resolveSeasonalThemeId(at(8, 15))).toBe('harvest');  // September
    expect(resolveSeasonalThemeId(at(10, 15))).toBe('harvest'); // November
    expect(resolveSeasonalThemeId(at(11, 15))).toBe('frost');   // December
    expect(resolveSeasonalThemeId(at(1, 15))).toBe('frost');    // February
  });

  it('flips to the opposite season south of the equator', () => {
    expect(resolveSeasonalThemeId(at(2, 15), -33.9)).toBe('harvest'); // March, Sydney
    expect(resolveSeasonalThemeId(at(11, 15), -33.9)).toBe('solstice'); // December, Sydney
  });

  it('gets the month boundaries right', () => {
    expect(resolveSeasonalThemeId(at(1, 28))).toBe('frost');   // Feb 28
    expect(resolveSeasonalThemeId(at(2, 1))).toBe('bloom');    // Mar 1
    expect(resolveSeasonalThemeId(at(7, 31))).toBe('solstice'); // Aug 31
    expect(resolveSeasonalThemeId(at(8, 1))).toBe('harvest');   // Sep 1
  });

  it('defaults to the Northern hemisphere with no latitude', () => {
    expect(resolveSeasonalThemeId(at(11, 15))).toBe('frost');
    expect(resolveSeasonalThemeId(at(11, 15), undefined)).toBe('frost');
    expect(resolveSeasonalThemeId(at(11, 15), 'not-a-number')).toBe('frost');
    expect(resolveSeasonalThemeId(at(11, 15), NaN)).toBe('frost');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- themes.test.js`
Expected: FAIL — `resolveSeasonalThemeId is not defined` / not exported.

- [ ] **Step 3: Implement the function**

Add to `client/src/utils/themes.js`:

```javascript
// Meteorological seasons: fixed calendar months, no equinox lookup. Northern
// hemisphere by default (or when lat isn't a usable number); south of the
// equator the same boundaries apply six months offset.
const NORTHERN_SEASON_BY_MONTH = [
  'frost', 'frost',                          // Jan, Feb
  'bloom', 'bloom', 'bloom',                 // Mar, Apr, May
  'solstice', 'solstice', 'solstice',        // Jun, Jul, Aug
  'harvest', 'harvest', 'harvest',           // Sep, Oct, Nov
  'frost',                                   // Dec
];
const SOUTHERN_SEASON_BY_MONTH = [
  'solstice', 'solstice',
  'harvest', 'harvest', 'harvest',
  'frost', 'frost', 'frost',
  'bloom', 'bloom', 'bloom',
  'solstice',
];

export function resolveSeasonalThemeId(nowMs, lat) {
  const month = new Date(nowMs).getMonth();
  const southern = typeof lat === 'number' && Number.isFinite(lat) && lat < 0;
  return (southern ? SOUTHERN_SEASON_BY_MONTH : NORTHERN_SEASON_BY_MONTH)[month];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix client test -- themes.test.js`
Expected: PASS, all new tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/themes.js client/src/utils/themes.test.js
git commit -m "feat(themes): add resolveSeasonalThemeId for automatic season switching"
```

---

## Task 8: Wire `'auto-season'` into `app.jsx`, with a regression test in `appearance.js`

**Files:**
- Modify: `client/src/app.jsx`
- Modify: `client/src/utils/appearance.test.js`

**Interfaces:**
- Consumes: `resolveSeasonalThemeId(nowMs, lat)` from Task 7.

- [ ] **Step 1: Add the regression test first**

Add `normalizeDeviceAppearance` to the existing `from './appearance.js'` import at the top of `client/src/utils/appearance.test.js`, then add this test (near the existing tests that call `normalizeDeviceAppearance`, e.g. the ones asserting `{ mode: 'auto' }` round-trips and `{ mode: 'nope', colors: 'red' }` is dropped to `{}`):

```javascript
describe('theme field accepts the auto-season sentinel', () => {
  it('stores auto-season exactly like a real theme id', () => {
    expect(normalizeDeviceAppearance({ theme: 'auto-season' })).toEqual({ theme: 'auto-season' });
  });
});
```

- [ ] **Step 2: Run it to confirm it already passes**

Run: `npm --prefix client test -- appearance.test.js`
Expected: PASS — `'auto-season'` already matches `THEME_ID` (`/^[a-z0-9][a-z0-9-]{0,63}$/`), so no production code changes for this step. This is a regression test, not a TDD red/green pair: it pins existing-but-unverified behavior the spec and this plan depend on, so if a future change to `THEME_ID` ever breaks it, this test — not a guess — is what catches it.

- [ ] **Step 3: Find the exact three call sites to change**

Run: `grep -n "appearance.theme\|resolveTheme(appearance.theme\|themeKnown" client/src/app.jsx`
Expected: three matches — the `themeKnown` check, and the two `resolveTheme(appearance.theme, ...)` calls (the base theme, and the weather-scene variant) — confirm their current line numbers before editing, since Tasks 1–7 don't touch this file and line numbers may have drifted from this plan's drafting.

- [ ] **Step 4: Add the effective-theme-id derivation**

Immediately before the `themeKnown` check, add:

```javascript
  // 'auto-season' isn't a real theme id in the registry — it's a sentinel
  // that resolves to whichever of the four seasonal themes matches today's
  // date (and hemisphere, from the same location already configured for
  // auto-dark-mode). Computed fresh each render; a season boundary crossed
  // while the display is idle is picked up at the next scheduled refresh.
  const effectiveThemeId = appearance.theme === 'auto-season'
    ? resolveSeasonalThemeId(Date.now(), appearance.autoDark?.lat)
    : appearance.theme;
```

- [ ] **Step 5: Use it in place of `appearance.theme` at all three sites**

- The `themeKnown` check: change `themeRegistry.themes.some((entry) => entry.id === appearance.theme)` to also treat `appearance.theme === 'auto-season'` as known — the simplest correct form is `appearance.theme === 'auto-season' || themeRegistry.themes.some((entry) => entry.id === effectiveThemeId)`.
- The base theme memo: change `resolveTheme(appearance.theme, themeRegistry.themes, themeRegistry.assets)` to `resolveTheme(effectiveThemeId, themeRegistry.themes, themeRegistry.assets)`, and add `effectiveThemeId` (not `appearance.theme`) to that memo's dependency array in place of `appearance.theme`.
- The weather-scene variant memo: change `resolveTheme(appearance.theme, themeRegistry.themes, themeRegistry.assets, { scene: weatherScene })` the same way, and update its dependency array the same way.

- [ ] **Step 6: Import `resolveSeasonalThemeId`**

Add `resolveSeasonalThemeId` to the existing `from '../utils/themes.js'`-style import at the top of `app.jsx` (find the existing import of `resolveTheme` etc. and add it to that same import statement — this file already imports several names from `./utils/themes.js`).

- [ ] **Step 7: Run the full client suite**

Run: `npm --prefix client test`
Expected: PASS. No existing test exercises `app.jsx` directly (no component-rendering framework), so this step confirms nothing else broke, not that this specific change works — Task 10 covers that with the manual admin-preview pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/app.jsx client/src/utils/appearance.test.js
git commit -m "feat(themes): wire 'auto-season' theme id into app.jsx's theme resolution"
```

---

## Task 9: "Automatic (by season)" option in the appearance UI

**Files:**
- Modify: `client/src/components/AppearanceSettings.jsx`
- Modify: `client/src/i18n/locales/en/admin.json`
- Modify: `client/src/i18n/locales/es/admin.json`

**Interfaces:**
- Consumes: the `'auto-season'` value Task 8 made meaningful.

- [ ] **Step 1: Add the menu item**

In `AppearanceSettings.jsx`, in the theme `<Select>` (the one with `{missingTheme && (...)}` immediately followed by `{themes.map((theme) => (...))}`), add a new `<MenuItem>` for `'auto-season'` between those two — before the `.map()`, after the `missingTheme` block:

```jsx
          <MenuItem value="auto-season">
            {t('admin:appearance.themeAutoSeason')}
          </MenuItem>
```

- [ ] **Step 2: Add the translation keys**

In `client/src/i18n/locales/en/admin.json`, inside the existing `"appearance": { ... "themeDescriptions": { "classic": "..." }, ... }` object, add:

- A new key alongside `"theme"` (same nesting level): `"themeAutoSeason": "Automatic (by season)"`.
- A new entry inside the existing `"themeDescriptions"` object: `"auto-season": "Switches automatically between Bloom, Solstice, Harvest and Frost through the year."` — this makes the description line under the dropdown (which already looks up `themeDescriptions.${draft.theme}`) work for this value with no extra code.

In `client/src/i18n/locales/es/admin.json`, find the equivalent `appearance`/`theme`/`themeDescriptions` keys (same structure, Spanish values) and add the matching two entries: `"themeAutoSeason": "Automático (según la estación)"` and, inside `themeDescriptions`, `"auto-season": "Cambia automáticamente entre Bloom, Solstice, Harvest y Frost a lo largo del año."`.

- [ ] **Step 3: Verify translations are complete**

Run: `npm --prefix client run check:i18n`
Expected: PASS — no missing keys reported for either locale.

- [ ] **Step 4: Run the full client suite**

Run: `npm --prefix client test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AppearanceSettings.jsx client/src/i18n/locales/en/admin.json client/src/i18n/locales/es/admin.json
git commit -m "feat(themes): add 'Automatic (by season)' option to the appearance picker"
```

---

## Task 10: Clean up staging, activate, and verify

No code changes — manual verification and the final activation step, plus deleting the scratch folder from Task 1.

- [ ] **Step 1: Delete the staging folder**

```bash
git rm -r client/src/themes/_staging
git commit -m "chore(themes): remove staging folder, all four theme folders have their own copies"
```

- [ ] **Step 2: Start the dev server**

Run: `npm --prefix client run dev` and `npm --prefix server start` per `docs/guides/getting-started.md` (same setup used to verify the drag-resize plan — `server/.env` with `PORT=5001`, `client/.env` with `VITE_REACT_APP_API_URL=http://localhost:5001`, both already exist from that earlier work).

- [ ] **Step 3: Verify each theme visually, both modes**

In the browser, open Admin → Look → Appearance. For each of Bloom, Solstice, Harvest, Frost: select it, toggle light and dark, confirm cards/text/accent read correctly and nothing clips.

- [ ] **Step 4: Verify weather scenes via the admin preview**

Still in Admin → Look → Appearance, use the existing scene-preview control (backed by `setWeatherScenePreview` in `useWeatherCondition.js` — it's already built into this screen for exactly this purpose) to preview, per theme: `sunny` in both light and dark (confirm Bloom shows birds/bees in light, fireflies in dark; Frost shows nothing in light, a few stars in dark; Solstice shows nothing in light, shooting stars in dark), `rainy` (confirm light rain, and for Harvest confirm leaf count visibly drops), `lightning` (confirm the flash fires, paced several seconds apart, never more than roughly half-strength), and for Frost specifically `snowy`, and for Harvest specifically `windy` (confirm leaves intensify and blow sideways).

- [ ] **Step 5: Verify auto-season resolution**

Select "Automatic (by season)" and confirm the theme that actually renders matches today's real-world season (for the device's configured location, or Northern-hemisphere assumption if none is configured).

- [ ] **Step 6: Set the household appearance to auto-season**

Still in Admin → Look → Appearance, with scope set to "Household" (not just this device), set the theme to "Automatic (by season)" and save — per the spec, this should be active immediately, not left as an unselected option.

- [ ] **Step 7: Deploy and verify on the real Pi**

Tag and push a new version (same release flow as the drag-resize work: `git tag`, `git push origin main`, `git push origin <tag>`, confirm the GitHub Actions build succeeds, confirm both GHCR packages are still public), then on `WindowToTheStars` (`192.168.68.112`, via `plink.exe` per `C:\Users\tjsta\IdeaProjects\ClaudePi\CLAUDE.md`): `cd /opt/homeglow && docker compose pull && docker compose up -d`, then repeat Steps 3–6 against `http://192.168.68.112:3000` to confirm the real deployment matches.
