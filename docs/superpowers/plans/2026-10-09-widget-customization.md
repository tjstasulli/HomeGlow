# Widget Customization (Diagonal Resize, Finer Grid, Per-Widget Opacity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let widgets resize diagonally (both axes at once) on a finer snap grid, and give every widget a 0–100% opacity slider instead of today's on/off transparent toggle — continuing the drag-resize work already shipped this session.

**Architecture:** Three independent, additive changes to the existing grid/widget system, no new subsystems. Diagonal handles and the finer column grid are config-value changes to code already modified in the earlier drag-resize plan. The finer row grid needs a real one-time data migration (row position/height is stored in raw, unnormalized units, unlike column position/width which already auto-scales through the existing breakpoint system). Opacity replaces the `transparent` boolean with a numeric field, read with a backward-compatible fallback so no settings migration is needed for it.

**Tech Stack:** React 19, `react-grid-layout`, better-sqlite3 (server-side schema migrations), `node:test` (server tests), Vitest (client tests).

**Spec:** None — classified as a bounded change (continuing an existing flow in `WidgetContainer.jsx`/`app.jsx`/`AdminPanel.jsx`), confirmed in chat per `superpowers:brainstorming`'s bounded path. This plan is the design record.

## Global Constraints

- `NORMALIZED_GRID_COLS` (12, in `client/src/utils/gridLayout.js`) does not change — it's the storage unit for x/w, already breakpoint-agnostic. Only the *live* column counts (the breakpoints in `WidgetContainer.jsx`) change.
- The row-pitch scale factor is **×2** (116px → 58px), not ×4 — ×4 (29px) breaks `rowHeight = pitch - gap` for every theme using the 24px gap (all four seasonal themes built this session), producing a 5px row height. ×2 is the largest factor that evenly divides 116 and stays safe at every allowed gap value (`GRID_GAPS = [0, 8, 16, 24]` in `gridMetrics.js`): 58 − 24 = 34px, still comfortably positive.
- Column granularity gets the full **×4** (12/8/4 → 48/32/16) — that axis has no equivalent constraint, since width is already normalized/scaled generically.
- No theme file changes in this plan — the row-pitch constant lives in app code (`gridMetrics.js`), not in any `theme.json`.
- Opacity replaces `transparent` in the data model, but old stored data (`transparent: true/false`, no `opacity` field) must keep working with no explicit migration: derive `opacity` from `transparent` at read time (`true` → `0`, `false`/absent → `100`) wherever a widget's settings are read, the same backward-compatible-read pattern already used elsewhere in this app for settings fields.

## Review Focus

- A tab with widgets saved before this migration must come out at exactly double their stored `layout_y`/`layout_h`, not a value off by rounding — covered by Task 2's migration test, which asserts exact values via the real API, not an approximation.
- A **new** widget assignment (no saved layout yet) must still look visually consistent in scale with migrated old widgets — covered by Task 2's default-size/position scaling in `app.jsx`, applied to all five widget-size blocks, and by Task 4's manual check placing a brand-new widget next to an old one.
- A widget with old-style `transparent: true` and no `opacity` field must still render fully invisible after this ships, not suddenly visible at default 100% — covered by Task 3's explicit fallback-derivation tests.
- Diagonal-resizing a widget into a neighbor must still be rejected by the grid's existing collision prevention, the same as cardinal resizing already is — covered by Task 1's manual verification (reuses the exact same collision path, cardinal and diagonal are both just `resizeConfig.handles` entries into the same engine logic).
- The opacity slider must round-trip through a save/reload, including the 0% (fully invisible) and 100% (fully opaque) extremes, not just a middle value a casual test might pick — covered by Task 3's manual verification explicitly checking both extremes.

---

## Task 1: Diagonal resize handles + finer column grid

**Files:**
- Modify: `client/src/components/WidgetContainer.jsx`

**Interfaces:** None — both are literal/array constant changes, nothing downstream depends on their values beyond what's already wired.

- [ ] **Step 1: Add the four corner handles**

Find:

```javascript
          resizeConfig={{ enabled: true, handles: ['n', 's', 'e', 'w'] }}
```

Replace with:

```javascript
          resizeConfig={{ enabled: true, handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] }}
```

- [ ] **Step 2: Widen the column breakpoints by ×4**

Find the three `setGridCols` calls in `updateDimensions` (mobile/tablet/desktop):

```javascript
          setGridCols(4); // Mobile: 4 columns
```
```javascript
          setGridCols(8); // Tablet: 8 columns
```
```javascript
          setGridCols(12); // Desktop: 12 columns
```

Replace with:

```javascript
          setGridCols(16); // Mobile: 16 columns
```
```javascript
          setGridCols(32); // Tablet: 32 columns
```
```javascript
          setGridCols(48); // Desktop: 48 columns
```

- [ ] **Step 3: Run the full client test suite**

Run: `npm --prefix client test`
Expected: PASS. No existing test pins a specific column count or handle list (confirmed: `gridLayout.test.js`/`gridPlacement.test.js` operate on arbitrary `cols` values passed in, not these specific constants), so this is a check that nothing else broke, not a test of the new values — Task 4 covers that manually.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/WidgetContainer.jsx
git commit -m "feat(grid): add diagonal resize handles and widen column grid 4x"
```

---

## Task 2: Finer row grid (×2), with a schema migration

**Files:**
- Modify: `client/src/utils/gridMetrics.js`
- Modify: `client/src/app.jsx`
- Create: `server/migrations/schema29-rowPitchScale.js`
- Modify: `server/index.js:252` (the `schemaMigrations` array)
- Create: `server/tests/rowPitchMigration.test.js`

**Interfaces:** None new — this task only changes constants and adds a one-time data transform; nothing in this plan calls into it programmatically.

- [ ] **Step 1: Halve the row pitch**

In `client/src/utils/gridMetrics.js`, find:

```javascript
export const GRID_PITCH = 116;
```

Replace with:

```javascript
export const GRID_PITCH = 58;
```

- [ ] **Step 2: Scale every core/plugin widget's default height, position, and minimum height by ×2**

In `client/src/app.jsx`, there are five `result.push({...})` blocks (calendar, weather, chores, photos, and the generic plugin block) each with a `defaultPosition`, `defaultSize`, and `minHeight`. Update each exactly as follows (width/x/minWidth are unchanged — those are normalized 12-col units, already breakpoint-agnostic; only height/y, the raw row-unit fields, scale):

Calendar — find:
```javascript
        defaultPosition: { x: 0, y: 0 },
        defaultSize: { width: 8, height: 5 },
        minWidth: 2,
        minHeight: 2,
```
Replace with:
```javascript
        defaultPosition: { x: 0, y: 0 },
        defaultSize: { width: 8, height: 10 },
        minWidth: 2,
        minHeight: 4,
```

Weather — find:
```javascript
        defaultPosition: { x: 8, y: 0 },
        defaultSize: { width: 4, height: 3 },
        minWidth: 2,
        minHeight: 2,
```
Replace with:
```javascript
        defaultPosition: { x: 8, y: 0 },
        defaultSize: { width: 4, height: 6 },
        minWidth: 2,
        minHeight: 4,
```

Chores — find:
```javascript
        defaultPosition: { x: 0, y: 5 },
        defaultSize: { width: 6, height: 4 },
        minWidth: 2,
        minHeight: 2,
```
Replace with:
```javascript
        defaultPosition: { x: 0, y: 10 },
        defaultSize: { width: 6, height: 8 },
        minWidth: 2,
        minHeight: 4,
```

Photos — find:
```javascript
        defaultPosition: { x: 6, y: 5 },
        defaultSize: { width: 6, height: 4 },
        minWidth: 2,
        minHeight: 2,
```
Replace with:
```javascript
        defaultPosition: { x: 6, y: 10 },
        defaultSize: { width: 6, height: 8 },
        minWidth: 2,
        minHeight: 4,
```

Plugin (generic, inside `installedPlugins.forEach`) — find:
```javascript
        defaultPosition: { x: 0, y: 0 },
        defaultSize: { width: 6, height: 4 },
        minWidth: 2,
        minHeight: 2,
```
Replace with:
```javascript
        defaultPosition: { x: 0, y: 0 },
        defaultSize: { width: 6, height: 8 },
        minWidth: 2,
        minHeight: 4,
```

- [ ] **Step 3: Write the migration test first**

This follows the exact two-phase pattern `server/tests/choreHistoryKindMigration.test.js` already uses for schema 20, but builds its pre-migration fixture through the real API (bulk layout PATCH) rather than a hand-rolled SQL insert, since `tabs`' exact column set has changed across several migrations and the API is the one interface guaranteed to produce a valid row.

Create `server/tests/rowPitchMigration.test.js`:

```javascript
// Two-phase test for schema migration 29 (row pitch x2):
// 1) boot a fresh server (migrates to latest), create a widget assignment
//    with a known pre-scale layout via the real API, stop the server;
// 2) revert the DB's schema id to 28 (no structural change needed - the
//    fixture row the API wrote is already valid at every schema version);
// 3) boot again - migration 29 re-runs - and assert the layout doubled.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const Database = require('better-sqlite3');
const { freePort } = require('./freePort');

const serverDir = path.resolve(__dirname, '..');
const tmpDir = path.resolve(__dirname, '.tmp');
const testDbPath = path.join(tmpDir, `row-pitch-migration-${process.pid}-${Date.now()}.db`);
let port;
let baseUrl;

async function usePort() {
    port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
}

let serverProcess;
let serverLogs = '';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(`${baseUrl}/api/test`);
            if (response.ok) return;
        } catch {
            // Server is still starting.
        }
        await delay(250);
    }
    throw new Error(`Server did not become ready within ${timeoutMs}ms. Logs:\n${serverLogs}`);
}

async function startServer() {
    await usePort();
    serverProcess = spawn('node', ['index.js'], {
        cwd: serverDir,
        env: {
            ...process.env,
            PORT: String(port),
            DB_PATH: testDbPath,
            TZ: 'UTC',
            HOMEGLOW_DISABLE_BACKGROUND_JOBS: '1',
            HOMEGLOW_DISABLE_CALENDAR_SYNC: '1',
            ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
    serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
    return waitForServerReady();
}

async function stopServer() {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill();
        await delay(300);
    }
}

test('schema 29 doubles layout_y and layout_h for existing widget assignments', async () => {
    const DEVICE = `fixture-device-${process.pid}`;

    // Phase 1: boot at the latest schema, create a real assignment with a
    // known pre-scale layout through the actual API.
    await startServer();
    const createResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_name: 'chores', tabNumber: 1 }),
    });
    assert.equal(createResponse.status, 200);

    const bulkResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments/layout/bulk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            layouts: [{ widget_name: 'chores', tabNumber: 1, layout_x: 0, layout_y: 5, layout_w: 6, layout_h: 4 }],
        }),
    });
    assert.equal(bulkResponse.status, 200);
    await stopServer();

    // Phase 2: revert only the schema id - the fixture row the API wrote is
    // already a valid row at any schema version, so no structural change is
    // needed, unlike a migration that adds/removes a column.
    const db = new Database(testDbPath);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('28', 'SYSTEM_SCHEMA_ID');
    db.close();

    // Phase 3: boot again - migration 29 re-runs against the fixture row.
    await startServer();
    const assignmentsResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments`);
    assert.equal(assignmentsResponse.status, 200);
    const assignments = await assignmentsResponse.json();
    const chores = assignments.find((a) => a.widget_name === 'chores');

    assert.ok(chores, 'chores assignment present after migration');
    assert.equal(chores.layout_x, 0, 'layout_x unchanged (normalized column unit)');
    assert.equal(chores.layout_w, 6, 'layout_w unchanged (normalized column unit)');
    assert.equal(chores.layout_y, 10, 'layout_y doubled: 5 -> 10');
    assert.equal(chores.layout_h, 8, 'layout_h doubled: 4 -> 8');

    await stopServer();
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test server/tests/rowPitchMigration.test.js`
Expected: FAIL — schema 29 isn't registered yet, so the revert-to-28-and-reboot leaves the server at schema 28 with no migration run; the fixture's `layout_y`/`layout_h` stay at the un-doubled 5/4, failing the `assert.equal(chores.layout_y, 10, ...)` / `layout_h, 8, ...)` assertions. This is a real, specific failure (an assertion mismatch), not a crash — confirming the test is actually exercising the migration path rather than passing vacuously.

- [ ] **Step 5: Write the migration**

Create `server/migrations/schema29-rowPitchScale.js`:

```javascript
const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

// The grid's row pitch (client/src/utils/gridMetrics.js) is halving (116px ->
// 58px, GRID_PITCH), so a widget's stored row-unit fields must double to keep
// its on-screen height exactly what it was. layout_x/layout_w stay as they
// are: those are normalized 12-column units, already independent of pixel
// pitch.
function parseConfigJson(configJson) {
    if (!configJson) return {};
    try {
        const parsed = JSON.parse(configJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        // Ignore malformed JSON and fall back to empty object.
    }
    return {};
}

const ROW_PITCH_SCALE = 2;

try {
    console.log(`=== Starting row pitch scale migration to version ${targetSchemaId} ===`);

    db.exec('BEGIN');
    try {
        const tabs = db.prepare('SELECT id, config_json FROM tabs').all();
        const updateTab = db.prepare('UPDATE tabs SET config_json = ? WHERE id = ?');

        tabs.forEach((tab) => {
            const layout = parseConfigJson(tab.config_json);
            let changed = false;
            Object.keys(layout).forEach((widgetName) => {
                const entry = layout[widgetName];
                if (!entry || typeof entry !== 'object') return;
                if (Number.isFinite(Number(entry.layout_y))) {
                    entry.layout_y = Number(entry.layout_y) * ROW_PITCH_SCALE;
                    changed = true;
                }
                if (Number.isFinite(Number(entry.layout_h))) {
                    entry.layout_h = Number(entry.layout_h) * ROW_PITCH_SCALE;
                    changed = true;
                }
            });
            if (changed) {
                updateTab.run(JSON.stringify(layout), tab.id);
            }
        });

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            schemaIdKey,
            String(targetSchemaId)
        );
        db.exec('COMMIT');
        console.log(`=== Row pitch scale migration completed successfully (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Row pitch scale migration failed ===');
    console.error('Error:', error);
    throw error;
}
```

- [ ] **Step 6: Register it**

In `server/index.js`, find the end of the `schemaMigrations` array:

```javascript
  { schemaId: 28, migrationPath: './migrations/schema28-haPanels', },
];
```

Replace with:

```javascript
  { schemaId: 28, migrationPath: './migrations/schema28-haPanels', },
  { schemaId: 29, migrationPath: './migrations/schema29-rowPitchScale', },
];
```

- [ ] **Step 7: Run the test again to verify it passes**

Run: `node --test server/tests/rowPitchMigration.test.js`
Expected: PASS — all assertions pass, confirming `layout_y` 5→10 and `layout_h` 4→8, `layout_x`/`layout_w` unchanged.

- [ ] **Step 8: Run the full server test suite**

Run: `npm --prefix server test`
Expected: PASS — confirms this migration doesn't break the existing migration chain or any other server test (including `choreHistoryKindMigration.test.js`, which exercises the same two-phase boot pattern).

- [ ] **Step 9: Run the full client test suite**

Run: `npm --prefix client test`
Expected: PASS — confirms the `GRID_PITCH` and `app.jsx` default-size changes don't break any existing test (none pin these specific values, confirmed during planning).

- [ ] **Step 10: Commit**

```bash
git add client/src/utils/gridMetrics.js client/src/app.jsx server/migrations/schema29-rowPitchScale.js server/index.js server/tests/rowPitchMigration.test.js
git commit -m "feat(grid): halve row pitch for finer vertical resize, migrate stored heights"
```

---

## Task 3: Per-widget opacity (replaces the transparent on/off toggle)

**Files:**
- Modify: `client/src/components/WidgetContainer.jsx`
- Modify: `client/src/app.jsx`
- Modify: `client/src/components/AdminPanel.jsx`
- Modify: `client/src/utils/widgetSettings.js`
- Modify: `client/src/utils/widgetSettings.test.js`
- Modify: `client/src/i18n/locales/en/admin.json`
- Modify: `client/src/i18n/locales/es/admin.json`

**Interfaces:**
- Produces: `resolveWidgetOpacity(settings)` in `widgetSettings.js` — `(settings: { opacity?: number, transparent?: boolean }) => number` (0–100). Consumed by `app.jsx` wherever it currently reads `Boolean(widgetSettings.X.transparent)`.

- [ ] **Step 1: Write the failing tests for the fallback helper**

Add to `client/src/utils/widgetSettings.test.js` (follow the existing file's style/imports):

```javascript
describe('resolveWidgetOpacity', () => {
  it('uses opacity when present, ignoring transparent', () => {
    expect(resolveWidgetOpacity({ opacity: 40, transparent: true })).toBe(40);
    expect(resolveWidgetOpacity({ opacity: 0 })).toBe(0);
  });

  it('derives opacity from the legacy transparent flag when opacity is absent', () => {
    expect(resolveWidgetOpacity({ transparent: true })).toBe(0);
    expect(resolveWidgetOpacity({ transparent: false })).toBe(100);
  });

  it('defaults to fully opaque with neither field set', () => {
    expect(resolveWidgetOpacity({})).toBe(100);
    expect(resolveWidgetOpacity(undefined)).toBe(100);
  });

  it('clamps an out-of-range stored value to 0-100', () => {
    expect(resolveWidgetOpacity({ opacity: 150 })).toBe(100);
    expect(resolveWidgetOpacity({ opacity: -10 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- widgetSettings.test.js`
Expected: FAIL — `resolveWidgetOpacity is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

Add to `client/src/utils/widgetSettings.js`:

```javascript
/**
 * A widget's effective opacity (0-100): its own `opacity` if set, else
 * derived from the legacy `transparent` boolean (true -> 0, false/absent ->
 * 100), so settings saved before opacity existed keep rendering exactly as
 * they did.
 */
export function resolveWidgetOpacity(settings) {
  const opacity = settings?.opacity;
  if (typeof opacity === 'number' && Number.isFinite(opacity)) {
    return Math.max(0, Math.min(100, opacity));
  }
  return settings?.transparent ? 0 : 100;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix client test -- widgetSettings.test.js`
Expected: PASS, all new tests plus every pre-existing test in the file.

- [ ] **Step 5: Use the helper in `app.jsx`**

There are five sites reading `transparent` into a widget's props (`Boolean(widgetSettings.calendar.transparent)`, `Boolean(widgetSettings.weather.transparent)`, `Boolean(widgetSettings.chores.transparent)`, `Boolean(widgetSettings.photos.transparent)`, `Boolean(pSettings.transparent)`). Replace each `transparent: Boolean(X.transparent)` line with `opacity: resolveWidgetOpacity(X)`, e.g.:

Find:
```javascript
        transparent: Boolean(widgetSettings.calendar.transparent),
```
Replace with:
```javascript
        opacity: resolveWidgetOpacity(widgetSettings.calendar),
```

Repeat the same substitution (field name `transparent` → `opacity`, value `Boolean(X.transparent)` → `resolveWidgetOpacity(X)`) for `widgetSettings.weather`, `widgetSettings.chores`, `widgetSettings.photos`, and `pSettings` (the plugin block — there, the prop is `transparent: Boolean(pSettings.transparent)`, becoming `opacity: resolveWidgetOpacity(pSettings)`).

Also update the plugin's separate `transparentBackground={pSettings.transparent || false}` prop passed to `PluginWidgetWrapper` (a few lines below the plugin's `result.push`) — leave this one as-is for now; `PluginWidgetWrapper`'s own transparent-background prop is a different concern (whether the plugin iframe's own background is see-through) from the *frame's* opacity this task changes, and is out of scope.

Find:
```javascript
import { normalizeWidgetSettings, BASE_WIDGET_SETTINGS } from './utils/widgetSettings.js';
```
Replace with:
```javascript
import { normalizeWidgetSettings, BASE_WIDGET_SETTINGS, resolveWidgetOpacity } from './utils/widgetSettings.js';
```

- [ ] **Step 6: Simplify `WidgetContainer.jsx` to use opacity directly**

Find:
```javascript
            const restingShadow = widget.transparent ? 'none' : 'var(--hg-frame-shadow)';
```
Delete this line — opacity alone now handles full invisibility; no separate shadow-hiding branch is needed (at `opacity: 0` the shadow is invisible anyway; at partial opacity, a faded shadow is the correct, expected look, not a special case).

Then find the three sites referencing `restingShadow` and `widget.transparent` in the widget's frame `sx` (the `boxShadow`, `background`, `backgroundImage` lines):

```javascript
                  boxShadow: isSelected
                    ? '0 8px 32px rgba(var(--accent-rgb), 0.3)'
                    : restingShadow,
```
Replace with:
```javascript
                  boxShadow: isSelected
                    ? '0 8px 32px rgba(var(--accent-rgb), 0.3)'
                    : 'var(--hg-frame-shadow)',
```

```javascript
                  background: widget.transparent ? 'transparent' : 'var(--hg-frame-bg)',
                  backgroundImage: widget.transparent ? 'none' : 'var(--hg-frame-image)',
```
Replace with:
```javascript
                  background: 'var(--hg-frame-bg)',
                  backgroundImage: 'var(--hg-frame-image)',
                  opacity: (widget.opacity ?? 100) / 100,
```

(The hover rule a few lines below, `boxShadow: locked ? restingShadow : (...)`, also referenced `restingShadow` — update that one the same way, to `'var(--hg-frame-shadow)'` in place of `restingShadow`.)

- [ ] **Step 7: Run the full client test suite**

Run: `npm --prefix client test`
Expected: PASS.

- [ ] **Step 8: Add the opacity slider to the generic core-widget settings block**

In `AdminPanel.jsx`, find the generic per-core-widget block (chores/calendar/photos, iterated by a `widget`/`config` loop):

```javascript
                        <FormControlLabel
                          control={
                            <Switch
                              checked={Boolean(config.transparent)}
                              onChange={() => handleWidgetToggle(widget, 'transparent')}
                            />
                          }
                          label={t('admin:widgets.transparentBackground')}
                          sx={{ ml: 2 }}
                        />
```

Replace with:

```javascript
                        <Box sx={{ mt: 2, ml: 2, maxWidth: 240 }}>
                          <Typography variant="body2" sx={{ mb: 0.5 }}>
                            {t('admin:widgets.opacity', { value: resolveWidgetOpacity(config) })}
                          </Typography>
                          <Slider
                            value={resolveWidgetOpacity(config)}
                            onChange={(e, value) => handleWidgetOpacityChange(widget, value)}
                            min={0}
                            max={100}
                            step={5}
                          />
                        </Box>
```

Add the handler, next to `handleRefreshIntervalChange` (same file/shape — `setLocalWidgetSettings`, not `setPluginSettings`):

```javascript
  const handleWidgetOpacityChange = (widget, opacity) => {
    setLocalWidgetSettings(prev => ({
      ...prev,
      [widget]: {
        ...prev[widget],
        opacity
      }
    }));
  };
```

- [ ] **Step 9: Repeat for the weather-specific settings block**

Find:
```javascript
                      <FormControlLabel
                        control={
                          <Switch
                            checked={Boolean(widgetSettings.weather?.transparent)}
                            onChange={() => handleWidgetToggle('weather', 'transparent')}
                          />
                        }
                        label={t('admin:widgets.transparentBackground')}
                        sx={{ ml: 2 }}
```

Replace the `Switch`/`FormControlLabel` with the same `Box`/`Typography`/`Slider` pattern as Step 8, using `widgetSettings.weather` in place of `config` and `handleWidgetOpacityChange('weather', value)`.

- [ ] **Step 10: Repeat for the plugin settings block**

Find:
```javascript
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={pSettings.transparent || false}
                                    onChange={() => {
                                      setPluginSettings(prev => ({
                                        ...prev,
                                        [plugin.filename]: { ...prev[plugin.filename], transparent: !(prev[plugin.filename]?.transparent) }
                                      }));
                                    }}
                                  />
                                }
```

Replace with the same `Box`/`Typography`/`Slider` pattern, using `pSettings` in place of `config`, and an inline `onChange` (this block manages its own `setPluginSettings` rather than `handleWidgetOpacityChange`, which is scoped to `setLocalWidgetSettings`):

```javascript
                              <Box sx={{ mt: 2, maxWidth: 240 }}>
                                <Typography variant="body2" sx={{ mb: 0.5 }}>
                                  {t('admin:widgets.opacity', { value: resolveWidgetOpacity(pSettings) })}
                                </Typography>
                                <Slider
                                  value={resolveWidgetOpacity(pSettings)}
                                  onChange={(e, value) => {
                                    setPluginSettings(prev => ({
                                      ...prev,
                                      [plugin.filename]: { ...prev[plugin.filename], opacity: value }
                                    }));
                                  }}
                                  min={0}
                                  max={100}
                                  step={5}
                                />
                              </Box>
```

- [ ] **Step 11: Import `resolveWidgetOpacity` into `AdminPanel.jsx`**

Find:
```javascript
import { normalizeWidgetSettings as normalizeSharedWidgetSettings } from '../utils/widgetSettings.js';
```
Replace with:
```javascript
import { normalizeWidgetSettings as normalizeSharedWidgetSettings, resolveWidgetOpacity } from '../utils/widgetSettings.js';
```

- [ ] **Step 12: Add the i18n key, both locales**

In `client/src/i18n/locales/en/admin.json`, find the `widgets` object containing `"transparentBackground": "Transparent Background"` and add alongside it:

```json
    "opacity": "Opacity: {{value}}%",
```

In `client/src/i18n/locales/es/admin.json`, find the equivalent `widgets.transparentBackground` entry and add:

```json
    "opacity": "Opacidad: {{value}}%",
```

(Leave the existing `transparentBackground` keys in both files in place — they're now unused by this UI but removing a translation key the moment its last usage disappears is a separate cleanup decision, not required for this feature to work correctly.)

- [ ] **Step 13: Verify translations are complete**

Run: `npm --prefix client run check:i18n`
Expected: PASS.

- [ ] **Step 14: Run the full client test suite**

Run: `npm --prefix client test`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add client/src/components/WidgetContainer.jsx client/src/app.jsx client/src/components/AdminPanel.jsx client/src/utils/widgetSettings.js client/src/utils/widgetSettings.test.js client/src/i18n/locales/en/admin.json client/src/i18n/locales/es/admin.json
git commit -m "feat(widgets): replace on/off transparent toggle with a 0-100 opacity slider"
```

---

## Task 4: Manual verification, tag, and deploy

No code changes — manual verification across all three changes, then the same release flow used for the earlier drag-resize and seasonal-themes work.

- [ ] **Step 1: Start the dev server**

Run: `npm --prefix client run dev` and `npm --prefix server start` (same `.env` setup already in place from earlier work this session).

- [ ] **Step 2: Verify diagonal resize**

Select a widget, drag each of the four new corner handles (`ne`/`nw`/`se`/`sw`), confirm both width and height change together in one drag, and confirm dragging a corner toward a neighboring widget is still rejected (no overlap persists) exactly as cardinal-direction resize already was.

- [ ] **Step 3: Verify the finer grid on both axes**

Confirm a resize drag now moves in visibly smaller steps than before, both horizontally and vertically, and that widgets still snap cleanly (no stray 1px gaps or overlaps between adjacent widgets).

- [ ] **Step 4: Verify the row-pitch migration visually**

Load a tab with widgets saved before this change (any tab used during the earlier drag-resize/seasonal-themes verification this session). Confirm each widget's on-screen size and position look unchanged from before — the migration should be invisible by design. Then create one brand-new widget assignment (no prior saved layout) and confirm its default size looks visually consistent with the migrated ones, not twice as tall/short.

- [ ] **Step 5: Verify opacity**

For a core widget and a plugin widget: set opacity to 0% (confirm fully invisible, matching how the old "transparent: on" looked), 100% (confirm fully opaque, matching "transparent: off"), and a middle value like 50% (confirm a visibly faded card, shadow included). Reload the page after each change and confirm it persisted.

- [ ] **Step 6: Tag and push a release**

Same flow as the drag-resize and seasonal-themes work: `git push origin main`, `git tag`, `git push origin <tag>`, confirm the GitHub Actions build succeeds, confirm both GHCR packages are still public.

- [ ] **Step 7: Deploy to WindowToTheStars and verify there**

Via `plink.exe` per `C:\Users\tjsta\IdeaProjects\ClaudePi\CLAUDE.md`: `cd /opt/homeglow && docker compose pull && docker compose up -d`, then repeat Steps 2–5 against `http://192.168.68.112:3000`.
