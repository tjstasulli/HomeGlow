# Drag-to-Resize Widgets + Deploy from Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's button-stepper widget resize with native click-and-drag resize handles, and move the Pi's deployment from upstream's images to this fork's own GHCR-published images.

**Architecture:** `WidgetContainer.jsx` already renders widgets inside a `react-grid-layout` `GridLayout` with `resizeConfig={{ enabled: false }}` — drag-to-move works through the library natively, but resize is currently implemented as a parallel, bypassing +/- button system with its own hand-rolled collision guard (`resizeGuard.js`). Enabling the library's own `resizeConfig` and scoping it per-widget via the `isResizable` layout-item field removes the need for that parallel system entirely; the library's existing collision/compaction config (`GRID_COMPACTOR`) already covers resize the same way it covers drag. Deployment changes are config-only: the fork's CI workflow already publishes to `ghcr.io/<owner>/homeglow-*` dynamically, so no workflow edits are needed — only a compose-file image reference change on the Pi and in the repo's own root `docker-compose.yml`.

**Tech Stack:** React 19, `react-grid-layout@2.1.0` (v2 "grouped config" API — `dragConfig`/`resizeConfig`/`gridConfig`, not the classic flat-props API), Vitest, Docker Compose, GitHub Actions, GHCR.

**Spec:** `docs/superpowers/specs/2026-10-09-drag-resize-and-fork-deploy-design.md` (Phase 1 only — the spec's "Phase 2" section, private repo/images + Watchtower, is explicitly out of scope for this plan).

## Global Constraints

- Do not change `gridLayout.js`'s, `gridPlacement.js`'s, or `layoutSync.js`'s existing exported functions or their tests — the normalized-storage format and breakpoint-scaling math are unaffected by this work (spec Non-goals).
- Do not add a component-rendering test framework (e.g. `@testing-library/react`) — the project currently has none, and introducing one is out of scope; all new tests must be pure-function tests in the existing Vitest style (see `gridLayout.test.js` for the convention).
- `resizeConfig.handles` must be exactly `['n', 's', 'e', 'w']` — the four cardinal directions, matching the four directions the removed buttons offered (top/right/bottom/left). No diagonal handles.
- Resize handles must be visible only for the currently-selected widget, and never when the dashboard is locked — same visibility rule the removed buttons followed.
- Both GHCR images (`homeglow-frontend`, `homeglow-backend`) are to be public (spec §2 "Cost") — do not set either to private as part of this plan.

## Review Focus

- Growing a widget via drag-resize onto a neighboring widget's cells must be rejected, not persisted — covered by Task 2's manual verification; this is the exact bug class `resizeGuard.js` existed to patch over on the old button path, so it's the single most important behavior to confirm survives the switch to the library's native path.
- Shrinking a widget below its `minW`/`minH` must be clamped, not silently ignored or allowed through — covered by Task 2's manual verification (the library enforces this via the `minW`/`minH` already present on every layout item; no app code implements it).
- Locking the dashboard while a widget is selected must hide its resize handles immediately, not just on next selection — already covered by the existing `useEffect` that clears `selectedWidget` on lock (unchanged by this plan) plus Task 1's unit test that `applyResizability` returns `false` for every item when `locked` is true.
- The resize handles must actually be clickable/draggable, not obscured by the full-widget-covering invisible `.drag-handle` overlay (`zIndex: 1001`) that sits on top of the widget for drag-to-move — Task 2 adds explicit higher-`z-index` styling for `.react-resizable-handle` and the step includes manually confirming each of the four handles responds to a drag, not just to a click-through to drag-to-move.
- A tab switch or widget-set change arriving mid-resize must not corrupt the saved layout — already covered by the existing `shouldAcceptLayoutChange`/`layoutTabRef` guard in `handleLayoutChange`, which this plan does not touch; called out here only to confirm no task accidentally weakens it.

---

## Task 1: Add `applyResizability` helper (TDD)

**Files:**
- Modify: `client/src/utils/gridLayout.js`
- Modify: `client/src/utils/gridLayout.test.js`

**Interfaces:**
- Produces: `applyResizability(items: LayoutItem[], selectedWidgetId: string | null, locked: boolean): LayoutItem[]` — exported from `gridLayout.js`. Returns a new array; each item gets `isResizable: !locked && item.i === selectedWidgetId` merged in, every other field untouched. Task 2 imports and calls this as the last step building the grid's live layout.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/utils/gridLayout.test.js` (follow the existing `describe`/`it` style already in that file):

```javascript
import { applyResizability } from './gridLayout.js';

describe('applyResizability', () => {
  const items = [
    { i: 'a', x: 0, y: 0, w: 3, h: 2 },
    { i: 'b', x: 3, y: 0, w: 3, h: 2 },
  ];

  it('marks only the selected item resizable', () => {
    const result = applyResizability(items, 'a', false);
    expect(result.find((item) => item.i === 'a').isResizable).toBe(true);
    expect(result.find((item) => item.i === 'b').isResizable).toBe(false);
  });

  it('marks nothing resizable when nothing is selected', () => {
    const result = applyResizability(items, null, false);
    expect(result.every((item) => item.isResizable === false)).toBe(true);
  });

  it('marks nothing resizable when locked, even if something is selected', () => {
    const result = applyResizability(items, 'a', true);
    expect(result.every((item) => item.isResizable === false)).toBe(true);
  });

  it('preserves every other field on each item', () => {
    const result = applyResizability(items, 'a', false);
    expect(result.find((item) => item.i === 'a')).toMatchObject(items[0]);
  });

  it('returns an empty array for an empty layout', () => {
    expect(applyResizability([], 'a', false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- gridLayout.test.js`
Expected: FAIL — `applyResizability is not a function` / not exported.

- [ ] **Step 3: Implement the minimal function**

Add to `client/src/utils/gridLayout.js` (near the other per-item helpers like `clampLayoutItem`):

```javascript
/**
 * Mark exactly one item resizable: the selected one, and only while unlocked.
 * Mirrors the visibility rule the old resize buttons followed.
 */
export function applyResizability(items, selectedWidgetId, locked) {
  return items.map((item) => ({
    ...item,
    isResizable: !locked && item.i === selectedWidgetId,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix client test -- gridLayout.test.js`
Expected: PASS, all 5 new tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
cd client && git add src/utils/gridLayout.js src/utils/gridLayout.test.js
git commit -m "feat(grid): add applyResizability helper for per-widget resize scoping"
```

---

## Task 2: Wire native drag-resize into WidgetContainer, remove the button system

**Files:**
- Modify: `client/src/components/WidgetContainer.jsx`
- Delete: `client/src/utils/resizeGuard.js`
- Delete: `client/src/utils/resizeGuard.test.js`

**Interfaces:**
- Consumes: `applyResizability(items, selectedWidgetId, locked)` from Task 1.

- [ ] **Step 1: Import `applyResizability`, drop the `resizeGuard` import**

In `client/src/components/WidgetContainer.jsx`, change:

```javascript
import {
  clampLayoutItem,
  layoutItemFromNormalized,
  layoutToNormalized,
  scaleLayoutItem,
} from '../utils/gridLayout.js';
```

to:

```javascript
import {
  applyResizability,
  clampLayoutItem,
  layoutItemFromNormalized,
  layoutToNormalized,
  scaleLayoutItem,
} from '../utils/gridLayout.js';
```

Delete this line entirely (no longer used):

```javascript
import { canCommitResize } from '../utils/resizeGuard';
```

- [ ] **Step 2: Delete the resize-button tap guard ref**

Delete this line (declared alongside the other refs near the top of the component):

```javascript
  const resizeTapGuardRef = useRef(new Map());
```

- [ ] **Step 3: Delete `handleResize` and `handleResizePointerDown`**

Delete both functions in full — `handleResize` (the button click/decrement handler, including its `canCommitResize` check and the `switch (direction)` block) and `handleResizePointerDown` (the tap-guarded wrapper that calls it). Nothing else calls either function once the button JSX in Step 7 is removed.

- [ ] **Step 4: Scope resizability into the `gridLayout` memo**

Change:

```javascript
  const gridLayout = useMemo(() => {
    const built = buildLayout(widgets, gridCols, locked);
    if (layoutTabRef.current !== activeTab) return built;
    return built.map((item) => layout.find((l) => l.i === item.i) || item);
  }, [widgets, layout, gridCols, locked, activeTab]);
```

to:

```javascript
  const gridLayout = useMemo(() => {
    const built = buildLayout(widgets, gridCols, locked);
    const reconciled = layoutTabRef.current !== activeTab
      ? built
      : built.map((item) => layout.find((l) => l.i === item.i) || item);
    return applyResizability(reconciled, selectedWidget, locked);
  }, [widgets, layout, gridCols, locked, activeTab, selectedWidget]);
```

- [ ] **Step 5: Enable native resize on the grid**

Change:

```javascript
          resizeConfig={{ enabled: false }}
```

to:

```javascript
          resizeConfig={{ enabled: true, handles: ['n', 's', 'e', 'w'] }}
```

- [ ] **Step 6: Give the resize handles a higher z-index than the drag-handle overlay**

The invisible `.drag-handle` overlay covers the entire selected widget at `zIndex: 1001` to support drag-to-move; the library's own `.react-resizable-handle` elements render with no explicit z-index and would otherwise sit underneath it, unreachable. Add a rule for them in the same sx block that already styles `.react-grid-item` (the block containing `'& .react-grid-item.react-grid-placeholder'`), immediately after that existing rule:

```javascript
        '& .react-resizable-handle': {
          zIndex: 1004,
        },
```

- [ ] **Step 7: Delete the resize-button render helper, its styles, and its four call sites**

Delete `resizeButtonBaseStyle` (the plain object used only by the buttons):

```javascript
  const resizeButtonBaseStyle = {
    fontSize: '1.5rem',
    userSelect: 'none',
    touchAction: 'none',
    WebkitTouchCallout: 'none',
    filter: 'drop-shadow(0 2px 4px var(--hg-black-30))',
    transition: 'transform 0.1s ease, filter 0.1s ease',
    backgroundColor: 'var(--hg-black-50)',
    padding: '4px 8px',
    borderRadius: 'var(--hg-radius-sm)',
  };
```

Delete the five `can*` booleans that fed only the buttons (keep `currentLayout`, `fallbackLayout`, and `effectiveLayout` — `effectiveLayout` still feeds the `widgetSize` prop passed to widget content further down):

```javascript
            const canDecreaseWidth = currentLayout && currentLayout.w > currentLayout.minW;
            const canDecreaseHeight = currentLayout && currentLayout.h > currentLayout.minH;
            const canIncreaseWidth = currentLayout && (currentLayout.x + currentLayout.w < gridCols);
            const canIncreaseLeft = currentLayout && currentLayout.x > 0;
            const canIncreaseTop = currentLayout && currentLayout.y > 0;
```

Delete the `renderResizeButton` helper in full:

```javascript
            const renderResizeButton = ({ direction, decrement, enabled, symbol }) => (
              <Box
                className="resize-button"
                onPointerDown={handleResizePointerDown(widget.id, direction, decrement)}
                sx={{
                  ...resizeButtonBaseStyle,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  opacity: enabled ? 1 : 0.3,
                  '&:hover': {
                    transform: enabled ? 'scale(1.2)' : 'none',
                    filter: enabled
                      ? 'drop-shadow(0 4px 8px var(--hg-black-50))'
                      : 'drop-shadow(0 2px 4px var(--hg-black-30))',
                  },
                  '&:active': {
                    transform: enabled ? 'scale(1.1)' : 'none',
                  },
                }}
              >
                {symbol}
              </Box>
            );
```

Delete the four button-group `<Box>` blocks (Top/Right/Bottom/Left Resize Buttons) from inside the `{isSelected && !locked && (<>...</>)}` fragment — keep the fragment itself and the `{/* Invisible Drag Handle ... */}` `<Box className="drag-handle" .../>` that follows them, that one stays:

```javascript
                    {/* Top Resize Buttons */}
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        gap: 1,
                        zIndex: 1003,
                        pointerEvents: 'auto',
                      }}
                    >
                      {renderResizeButton({ direction: 'top', decrement: true, enabled: canDecreaseHeight, symbol: '➖' })}
                      {renderResizeButton({ direction: 'top', decrement: false, enabled: canIncreaseTop, symbol: '➕' })}
                    </Box>

                    {/* Right Resize Buttons */}
                    <Box
                      sx={{
                        position: 'absolute',
                        right: 8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        zIndex: 1003,
                        pointerEvents: 'auto',
                      }}
                    >
                      {renderResizeButton({ direction: 'right', decrement: true, enabled: canDecreaseWidth, symbol: '➖' })}
                      {renderResizeButton({ direction: 'right', decrement: false, enabled: canIncreaseWidth, symbol: '➕' })}
                    </Box>

                    {/* Bottom Resize Buttons */}
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        gap: 1,
                        zIndex: 1003,
                        pointerEvents: 'auto',
                      }}
                    >
                      {renderResizeButton({ direction: 'bottom', decrement: true, enabled: canDecreaseHeight, symbol: '➖' })}
                      {renderResizeButton({ direction: 'bottom', decrement: false, enabled: true, symbol: '➕' })}
                    </Box>

                    {/* Left Resize Buttons */}
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        zIndex: 1003,
                        pointerEvents: 'auto',
                      }}
                    >
                      {renderResizeButton({ direction: 'left', decrement: true, enabled: canDecreaseWidth, symbol: '➖' })}
                      {renderResizeButton({ direction: 'left', decrement: false, enabled: canIncreaseLeft, symbol: '➕' })}
                    </Box>
```

- [ ] **Step 8: Repoint the four `.resize-button` selectors at `.react-resizable-handle`**

These guard against a resize interaction being misread as a widget click/select — they need to name the library's real handle class now. Change all four occurrences:

In `handleWidgetClick`:
```javascript
    if (e.target.closest('.resize-button')) return;
```
→
```javascript
    if (e.target.closest('.react-resizable-handle')) return;
```

In `handleWidgetTouch`: the identical line, same change.

In the widget wrapper's `onPointerDownCapture`:
```javascript
                  if (!locked && !isSelected && !e.target.closest('.drag-handle') && !e.target.closest('.resize-button')) {
```
→
```javascript
                  if (!locked && !isSelected && !e.target.closest('.drag-handle') && !e.target.closest('.react-resizable-handle')) {
```

In the selection-safety-net effect:
```javascript
      const hasResizeControls = selectedElement.querySelector('.resize-button');
```
→
```javascript
      const hasResizeControls = selectedElement.querySelector('.react-resizable-handle');
```

- [ ] **Step 9: Delete the now-unused guard module and its test**

```bash
cd client
git rm src/utils/resizeGuard.js src/utils/resizeGuard.test.js
```

- [ ] **Step 10: Run the full test suite**

Run: `npm --prefix client test`
Expected: PASS. `resizeGuard.test.js` no longer runs (deleted); `gridLayout.test.js` (including Task 1's new tests) and `gridPlacement.test.js` pass unchanged; no other test references `resizeGuard`, `canCommitResize`, `handleResize`, or `.resize-button` (confirmed via repo-wide search before writing this plan).

- [ ] **Step 11: Manually verify in a dev server**

Run: `npm --prefix client run dev` (and the backend per `docs/guides/getting-started.md` if the dashboard needs it running to load widgets/layout).

In the browser, with the dashboard unlocked:
- Select a widget; confirm its four edge handles (not buttons) appear and nothing else's do.
- Drag each of the four edges (n/s/e/w) and confirm the widget resizes smoothly and the change persists across a page reload.
- Drag a widget's edge toward a neighboring widget until they'd touch; confirm it stops at the neighbor rather than overlapping it (Review Focus #1).
- Try to shrink a widget past its minimum size; confirm it stops at the minimum rather than going smaller (Review Focus #2).
- Lock the dashboard while a widget is selected; confirm its handles disappear immediately (Review Focus #3).
- Deselect, select a different widget, confirm only that widget's handles show.

- [ ] **Step 12: Commit**

```bash
cd client
git add src/components/WidgetContainer.jsx
git commit -m "feat(grid): replace resize-stepper buttons with native drag-resize handles"
```

---

## Task 3: Point the fork's own `docker-compose.yml` at its own images

**Files:**
- Modify: `docker-compose.yml` (repo root)

**Interfaces:** None — static config edit.

- [ ] **Step 1: Update both image references**

Change:
```yaml
    image: ghcr.io/jherforth/homeglow-backend:latest
```
to:
```yaml
    image: ghcr.io/tjstasulli/homeglow-backend:latest
```

Change:
```yaml
    image: ghcr.io/jherforth/homeglow-frontend:latest
```
to:
```yaml
    image: ghcr.io/tjstasulli/homeglow-frontend:latest
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(deploy): point docker-compose.yml at this fork's own GHCR images"
```

---

## Task 4: Tag and publish a release from the fork

No code changes — GitHub repo configuration and a release tag. Each step's own result is its verification.

- [ ] **Step 1: Push Tasks 1–3's commits to the fork**

```bash
git push origin main
```

- [ ] **Step 2: Enable GitHub Actions on the fork**

In the browser: `https://github.com/tjstasulli/HomeGlow/actions` → click through the one-time "I understand my workflows, go ahead and enable them" prompt (forks have Actions disabled by default).
Verify: the Actions tab now shows the repo's workflows listed instead of the enable prompt.

- [ ] **Step 3: Confirm Actions has write access to packages**

In the browser: `https://github.com/tjstasulli/HomeGlow/settings/actions` → under "Workflow permissions", select "Read and write permissions" → Save.
Verify: the page shows "Read and write permissions" as the selected option after saving.

- [ ] **Step 4: Tag and push a release**

```bash
git tag v1.9.2
git push origin v1.9.2
```

(Use whatever the next version number should be if `v1.9.2` is already taken on this fork — check `git tag -l` first.)

- [ ] **Step 5: Watch the build**

In the browser: `https://github.com/tjstasulli/HomeGlow/actions` → open the run triggered by the tag push.
Verify: both matrix jobs (`frontend`, `backend`) complete successfully.

- [ ] **Step 6: Set both GHCR packages public**

In the browser: `https://github.com/users/tjstasulli/packages/container/package/homeglow-frontend` → Package settings → Change visibility → Public. Repeat for `homeglow-backend`.
Verify: each package's page no longer shows a "Private" badge.

- [ ] **Step 7: Confirm the images pull anonymously**

```bash
docker pull ghcr.io/tjstasulli/homeglow-frontend:latest
docker pull ghcr.io/tjstasulli/homeglow-backend:latest
```

Run from any machine with Docker, logged out of `ghcr.io` — confirms public visibility actually took effect, not just that the setting was saved.
Expected: both pulls succeed with no authentication prompt or error.

---

## Task 5: Deploy to WindowToTheStars

No code changes — Pi-side config and verification. Connect via `plink.exe` with `C:\Users\tjsta\.ssh\PiPrivate.ppk`, user `spaceman`, per `C:\Users\tjsta\IdeaProjects\ClaudePi\CLAUDE.md`.

- [ ] **Step 1: Update `/opt/homeglow/compose.yaml` on the Pi**

Edit the two `image:` lines the same way as Task 3:
```
ghcr.io/jherforth/homeglow-backend:latest   -> ghcr.io/tjstasulli/homeglow-backend:latest
ghcr.io/jherforth/homeglow-frontend:latest  -> ghcr.io/tjstasulli/homeglow-frontend:latest
```

- [ ] **Step 2: Pull and restart**

```bash
cd /opt/homeglow
docker compose pull
docker compose up -d
```

Verify: `docker compose ps` shows both `homeglow-backend` and `homeglow-frontend` as `Up`, and `docker inspect --format '{{.Config.Image}}' homeglow-frontend` (and `-backend`) prints the new `ghcr.io/tjstasulli/...` reference.

- [ ] **Step 3: Verify the dashboard**

Open `http://192.168.68.112:3000` in a browser. Confirm the dashboard loads and existing widgets/layout are intact (the image change doesn't touch persisted layout data).

- [ ] **Step 4: Verify drag-resize on the real deployment**

Repeat Task 2 Step 11's manual checks against this live instance: select a widget, drag each of its four edges, confirm collision prevention and minimum-size clamping both hold, confirm locking hides the handles.

- [ ] **Step 5: Confirm restart survives a container recreation**

```bash
docker inspect --format '{{.Name}}: {{.HostConfig.RestartPolicy.Name}}' homeglow-backend homeglow-frontend
```

Expected: `unless-stopped` for both (unchanged by this plan — confirms the compose edit didn't accidentally drop it).
