# Drag-to-resize widgets + deploy from fork

## Problem

The live dashboard (`WidgetContainer.jsx`) resizes widgets via four pairs of
➕/➖ step buttons (one pair per edge), each click nudging the widget by one
grid column/row. There is no continuous click-and-drag resize, which feels
rudimentary compared to repositioning (drag-to-move already works natively).

A second component, `DraggableWidget.jsx`, already wires up real
`react-grid-layout` drag-resize handles, but it is dead code — only reachable
from the unused `ExampleWidgetUsage.jsx`, per the project's own
`docs/reference/code-cleanup-issue-116.md`. The live app renders widgets
exclusively through `WidgetContainer.jsx`.

Separately, this work will live on a personal fork
(`github.com/tjstasulli/HomeGlow`) rather than upstream, and the Pi that runs
HomeGlow (`WindowToTheStars`, see the `ClaudePi` ops repo) needs to pull its
images from that fork's own build instead of `ghcr.io/jherforth/*`.

## Goals

- Replace the button-stepper resize interaction with native click-and-drag
  resize handles on all four edges (matching today's four directions), scoped
  to the selected widget only — same as the existing edit-mode affordance
  pattern.
- Remove now-dead/redundant code this enables removing (the resize buttons,
  `resizeGuard.js`).
- Change nothing about drag-to-move, locking, or the persisted layout format.
- Get `WindowToTheStars`'s `compose.yaml` pulling both HomeGlow images from
  `ghcr.io/tjstasulli/*` (built by the fork's own CI), at zero additional
  cost.

## Non-goals

- Not adopting `react-rnd` / abandoning the grid-snapping model.
- Not changing the backend, the grid's column/breakpoint math
  (`gridLayout.js`, `gridPlacement.js`), or the normalized-storage format.
- Not setting up automatic/unattended image updates on the Pi — updates still
  require an explicit `docker compose pull && up -d` after a new tag is
  published (consistent with how BlackHole's containers are managed today).

## Design

### 1. Resize interaction (`client/src/components/WidgetContainer.jsx`)

- Flip `resizeConfig={{ enabled: false }}` to enabled, with handles on all
  four edges (n/s/e/w), scoped per-widget to the current selection — the grid
  already demonstrates per-item override support (`static: locked` is set per
  layout item today), so resizability will follow the same per-item pattern.
  The exact field name/shape will be confirmed against
  `react-grid-layout@2.1.0`'s actual API during implementation (its
  `dragConfig`/`resizeConfig`/`gridConfig` split is a newer, restructured API
  — not the classic flat-props one — so this gets verified against the
  library's real types/docs rather than assumed).
- Delete `handleResize`, `handleResizePointerDown`, `resizeTapGuardRef`,
  `renderResizeButton`, the four button render blocks (top/right/bottom/left),
  and `resizeButtonBaseStyle`.
- Delete `client/src/utils/resizeGuard.js` and `resizeGuard.test.js`. That
  guard exists only because the button path bypassed the grid's own collision
  checking (per its own header comment: drag refuses an overlapping move,
  resize-via-button did not). A native drag-resize goes through the same
  collision path drag-to-move already uses, making the custom guard
  redundant.
- `handleLayoutChange` is unchanged — it already persists x/y/w/h generically
  via `saveLayoutsToApi`, so a resize-by-drag needs no new wiring there.
- `gridLayout.js`, `gridPlacement.js`, `layoutSync.js`, and their existing
  tests are unaffected and unchanged.
- Resize handles are visible only when a widget is selected (same convention
  as today's edit border/buttons), styled consistently with the existing
  `.react-resizable-handle` CSS already present in the codebase (imported in
  `WidgetContainer.jsx`, demonstrated in the dead `DraggableWidget.jsx`).

### 2. Deploy from the fork

`jherforth/HomeGlow`'s `.github/workflows/docker-image.yml` already computes
its image path as `ghcr.io/${{ github.repository_owner }}/homeglow-{frontend,backend}`
— no workflow changes are needed for it to publish to
`ghcr.io/tjstasulli/homeglow-frontend` and `-backend` once run on the fork.

One-time setup on the fork (not code changes):

1. Enable GitHub Actions on the fork (disabled by default on forks).
2. Confirm *Settings → Actions → General → Workflow permissions* is
   "Read and write" (required for the workflow's `packages: write` push).
3. Push a `v*` tag (e.g. `v1.9.2`) to publish a `:latest` image — the
   workflow only stamps `:latest` on a version-tag push; a plain commit push
   or manual `workflow_dispatch` only produces `:latest-test`. Going forward,
   the update flow is: commit → tag → push tag → Actions builds and publishes.
4. Set both GHCR packages (`homeglow-frontend`, `homeglow-backend`) to public
   visibility, so the Pi can `docker pull` without authentication.

**Cost:** `tjstasulli/HomeGlow` is a public repository, so GitHub Actions
minutes are free and unlimited regardless of plan, and GHCR storage/bandwidth
for public packages is free. GitHub's default Actions spending limit for
personal accounts is $0 as an additional backstop. This remains true only as
long as the repo and both packages stay public.

`/opt/homeglow/compose.yaml` on `WindowToTheStars` changes both
`image:` lines from `ghcr.io/jherforth/homeglow-{backend,frontend}:latest` to
`ghcr.io/tjstasulli/homeglow-{backend,frontend}:latest` — both services, not
just frontend, so there is one consistent source for all future updates
(frontend or backend) rather than mixing fork and upstream.

## Testing

- `gridLayout.test.js` / `gridPlacement.test.js`: unaffected, no changes.
- `resizeGuard.test.js`: deleted along with the module it tests.
- New: a focused test asserting the grid's per-widget resizability reflects
  selection state correctly (exact assertion shape depends on confirming
  `react-grid-layout`'s per-item resize-override field during
  implementation).
- Manual verification: resize from each of the four edges on the live
  dashboard in a desktop browser (primary editing surface per the user); spot
  check that collision prevention still blocks growing a widget onto its
  neighbor, matching today's drag-to-move behavior.

## Error handling

No new error paths. Collision prevention, minimum-size clamping, and
persistence-failure handling are all pre-existing and reused as-is — this
change doesn't touch any of them, it only changes what triggers a resize.

## Rollout

1. Implement and test the resize-interaction change on the fork's `main`.
2. Tag a release (e.g. `v1.9.2`), push the tag, confirm both images publish
   to GHCR and that both packages are public.
3. Update `/opt/homeglow/compose.yaml` on `WindowToTheStars` to the new
   image references, `docker compose pull && docker compose up -d`.
4. Manually verify drag-resize on the live dashboard.
