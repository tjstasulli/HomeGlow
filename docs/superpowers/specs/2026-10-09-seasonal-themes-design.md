# Seasonal themes: Bloom, Solstice, Harvest, Frost

## Problem

The user wants the HomeGlow dashboard to look sleek and premium — Apple-
inspired, with a nod to Skylight's calm, card-based warmth — rather than its
current look. That request evolved, through conversation, into something
broader: four full seasonal themes (spring/summer/fall/winter), each with
its own light and dark personality, that switch automatically through the
year with no manual action required.

## Goals

- Four new built-in theme packages — **Bloom** (spring), **Solstice**
  (summer), **Harvest** (fall), **Frost** (winter) — each supporting both
  light and dark mode, each visually distinct but sharing one design
  language.
- A new **"Automatic (by season)"** theme option that resolves to the
  correct one of the four based on the current date (and, where available,
  hemisphere), with no widget and no server changes.
- Ship entirely as **theme data** (manifests, fonts, optional assets) plus
  one small new pure function and a small amount of wiring — never new
  theme *code*, matching every existing theme in this app.

## Non-goals

- Not touching `classic.css`, the grid/layout system, or any spacing/font-
  size/line-height value — the theme architecture explicitly forbids a
  theme package from changing layout metrics, and nothing about this
  request needs to.
- Not retiring Classic — it stays the fallback/default for anyone who wants
  it, same as today.
- Not building a theme marketplace flow or installable-from-URL support —
  these four ship as built-in theme folders in `client/src/themes/`, the
  same way Classic does.
- Not adding a second location setting — season resolution reuses the
  latitude already configured for auto-dark-mode/weather, rather than
  asking the user to configure location twice.

## Design

### 1. Shared design language (all eight palettes)

Established with the user before the seasonal pivot and carried through to
every season:

- **One typeface everywhere: Inter** (OFL-licensed, freely redistributable,
  the closest widely-available relative to Apple's system font). Each theme
  bundles its own copy of the weights it needs in its own `fonts/` folder,
  matching Reef's/Starship's existing per-theme font bundling — no shared
  font file between themes.
- **Dark modes separate cards with a border + subtle glow, never a drop
  shadow** — shadows don't read against a near-black background. Light
  modes use a soft, diffuse shadow instead.
- **24px gap between widget cards** (`--hg-grid-gap`, the token's maximum)
  in every one of the eight palettes — the single biggest lever for
  "looks expensive," per the earlier Horizon discussion.
- **Pill-shaped buttons** (`--hg-button-radius: 999px`) in each palette's
  own accent color.
- **Corner radius carries mood, not just color**: tighter/crisper toward
  winter, looser/softer toward spring and fall. Per-palette values are in
  the table below.
- **Ambience stays restrained in every season** — sparse, slow, mostly-
  static decoration, never the busy animated scenes Reef/Starship use.
  Bloom, Harvest, and Frost each get a literal seasonal particle touch
  (petals, leaves, snow); even those are a handful of slow-moving pieces,
  not a snow globe. Solstice stays particle-free.

### 2. The eight palettes

| Theme (mode) | `--background` | card `--hg-frame-bg` | `--text` | `--accent` | `--hg-frame-radius` | Card separation |
|---|---|---|---|---|---|---|
| Bloom light | `#FBF5F8` | `#FFFFFF` | `#4A3F45` | `#F2A6C6` | `20px` | soft pastel shadow |
| Bloom dark | `#221B22` | `#2E2630` | `#F3E9ED` | `#E88FB3` | `18px` | border + glow |
| Solstice light | `#FFFCF2` | `#FFFFFF` | `#2B2A28` | `#00BFA6` | `16px` | soft shadow |
| Solstice dark | `#071A1C` | `#0E2B2E` | `#F0FFFC` | `#00E6C9` | `16px` | border + glow |
| Harvest light | `#FBF1E6` | `#FFF8EF` | `#3B2A20` | `#D9772E` | `20px` | soft warm shadow |
| Harvest dark | `#1A100C` | `#2A1A13` | `#F5E8DC` | `#E08A3C` | `18px` | border + glow |
| Frost light | `#F3F8FB` | `#FFFFFF` | `#26333A` | `#4FA6D8` | `14px` | cool soft shadow |
| Frost dark | `#080E14` | `#101922` | `#E8F2F7` | `#5FC9E8` | `12px` | border + glow |

Each theme's manifest sets `extends: "classic"` (tokens/colors/MUI options
apply on top of Classic's base, same as Reef/Starship today) and
`modes: ["light", "dark"]`.

### 3. Seasonal ambience

Each theme's `ambience` list stays short (well under the engine's 12-layer
limit) and restrained:

- **Frost**: a `particles` layer, snow — low count (10–15), small size,
  slow fall, low opacity.
- **Harvest**: a `particles` layer, falling leaves — similarly sparse
  (5–8), slow, using the existing `particles` building block's `motion:
  "fall"` the same way Frost's snow does, with a warm-toned leaf asset.
- **Bloom**: a `particles` layer, soft falling petals — sparse (6-10), slow,
  low opacity, plus the same very faint `field` layer (two soft pastel
  glows drifting slowly) underneath for depth.
- **Solstice**: no ambience layer at all — bright and clean, consistent
  with the "sunny day, mostly still" principle from the original Horizon
  concept. Summer's energy comes from its saturated accent color, not
  motion.

All particle/field layers respect the engine's existing universal rules
unchanged: only `transform`/`opacity` animate, nothing renders under
`prefers-reduced-motion`, nothing renders while the dashboard is inactive.

### 4. Font sourcing

Inter's `.woff2` files (Regular 400, SemiBold 600, Bold 700 — matching what
the token system's heading/body/button-weight tokens need) come from
Inter's own official distribution (Google Fonts' hosted Inter, OFL
licensed). Each of the four theme folders gets its own copy of the same
three files plus `OFL.txt`, per the architecture's per-theme-folder
isolation rule — this is a sourcing/download step for the implementation
plan, not a design decision.

### 5. Automatic season switching (new capability)

Nothing today switches a *theme* automatically — only *mode* (light/dark)
has an "Auto" option, driven by `appearance.autoDark` (sunrise/sunset via
latitude, from `client/src/utils/appearance.js`). This adds the equivalent
for theme selection, reusing as much of that existing machinery as
possible:

- **New pure function**, alongside the other appearance/theme utilities:
  `resolveSeasonalThemeId(nowMs, lat)` → one of `'bloom' | 'solstice' |
  'harvest' | 'frost'`. Meteorological seasons (calendar-month based, no
  equinox lookup): Northern hemisphere Mar/Apr/May → spring,
  Jun/Jul/Aug → summer, Sep/Oct/Nov → fall, Dec/Jan/Feb → winter. Southern
  hemisphere (`lat < 0`) gets the same boundaries shifted six months.
  No `lat` (or not a number) defaults to Northern hemisphere, the same
  graceful-degradation shape `isAutoAvailable` already uses for auto-dark.
- **New reserved `theme` value**: `'auto-season'`. It already passes the
  existing `THEME_ID` slug validator in `appearance.js` unchanged — no
  validator changes needed. Stored and read exactly like any other theme
  id.
- **Integration point**: `client/src/app.jsx`, where `appearance.theme`
  currently feeds `resolveTheme(...)` directly (two call sites — the base
  theme and the weather-scene variant). A small derived value computed
  from `appearance.theme`, substituting
  `resolveSeasonalThemeId(Date.now(), appearance.autoDark?.lat)` whenever
  the stored value is `'auto-season'`, feeds both call sites instead. The
  `themeKnown` registry-membership check (used to catch an installed theme
  that's since been removed) treats `'auto-season'` as always known, since
  it is never looked up in the installed-themes registry.
- **Re-evaluation timing**: computed fresh on every render from
  `Date.now()`, so it naturally picks up a season change on the next
  reload/refresh — the same cadence the app already uses for the
  weather-scene recomputation, no new timer needed. A season boundary
  crossed while the display is sitting idle gets picked up at the next
  scheduled refresh already in the per-widget countdown system, not
  instantly at midnight — a one-dashboard-refresh-cycle delay is an
  acceptable trade for not adding a new polling timer.
- **UI**: `AppearanceSettings.jsx`'s theme picker gets one more entry,
  "Automatic (by season)", alongside Classic/Bloom/Solstice/Harvest/Frost/
  any installed themes — mirroring the existing mode picker's Light/Dark/
  Auto pattern. No new location field: it reads the same `autoDark.lat`
  already shown/edited for auto-dark-mode elsewhere in this same settings
  panel.

### 6. Activation

Per the user's decision on the original Horizon concept, carried forward:
once built, the household/device appearance setting is set to
`'auto-season'` as part of this work, so the Pi shows the seasonally-correct
theme immediately on deploy — not left as an unselected option.

## Testing

- `validateThemePackage` passes for each of the four new theme folders
  against their own file lists (fonts present, `src` paths resolve, every
  ambience layer's options match its building block's schema) — the same
  check every existing theme already gets, run via the existing test
  pattern in `utils/themes.test.js`.
- New pure-function tests for `resolveSeasonalThemeId`: each of the four
  seasons' representative months (Northern hemisphere), the Southern-
  hemisphere flip for at least one season, month boundaries (last day of
  Feb vs. first day of Mar, etc.), and the no-`lat`/non-numeric-`lat`
  default-to-Northern case.
- `appearance.js`'s existing validator tests confirm `'auto-season'` is
  accepted as a stored `theme` value (it already matches `THEME_ID`'s
  pattern — a regression test pins this rather than assumes it).
- Manual verification (this app has no component-rendering test framework,
  consistent with the constraint carried over from the drag-resize plan):
  load the dashboard with each of the four themes selected directly, in
  both light and dark mode, confirm cards/text/accent read correctly and
  nothing clips (card content was never touched, but a visual pass catches
  anything a token typo would break); then set `'auto-season'` and confirm
  it resolves to the correct season for the current date; then verify on
  the real WindowToTheStars Pi deployment, the same way the drag-resize
  work was verified there.

## Error handling

Nothing new. An unrecognized/removed theme id already falls back to
Classic (existing `resolveTheme` behavior); `'auto-season'` resolving to
one of four theme ids that always exist as built-in folders means it can
never hit that fallback path in practice. A missing/malformed `autoDark.lat`
degrades to the Northern-hemisphere default rather than erroring, matching
`isAutoAvailable`'s existing shape.

## Rollout

1. Source Inter's three `.woff2` weights + `OFL.txt` into each of the four
   theme folders.
2. Build each theme folder (`theme.json` + fonts + any ambience assets),
   starting with Frost (simplest ambience) through to Bloom/Harvest
   (particle assets needed).
3. Add `resolveSeasonalThemeId` + tests.
4. Wire the `'auto-season'` substitution into `app.jsx`'s two
   `resolveTheme` call sites and the `themeKnown` check.
5. Add the "Automatic (by season)" option to `AppearanceSettings.jsx`'s
   theme picker.
6. Set the household/device appearance to `'auto-season'`.
7. Manual verification pass (all four themes × both modes, then auto mode,
   then the real Pi deployment).
