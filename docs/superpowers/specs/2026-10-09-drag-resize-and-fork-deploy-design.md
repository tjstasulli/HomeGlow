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
- Not setting up automatic/unattended image updates on the Pi in this
  (Phase 1) rollout — updates require an explicit `docker compose pull
  && up -d` after a new tag is published (consistent with how BlackHole's
  containers are managed today). Phase 2 below revisits this once the repo
  goes private.

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

## Phase 2 (later): private repo, private images, Watchtower auto-update

Not part of the initial rollout — done only after Phase 1 (resize feature +
public-image deploy) is live and verified stable on `WindowToTheStars`.

### Goal

Flip `tjstasulli/HomeGlow` to a private repository, to guard against any
secret or proprietary-code exposure from an accidental commit, while keeping
the Pi's deployment working with no manual pull step required going forward.

### Decisions

- Both GHCR packages (`homeglow-frontend`, `homeglow-backend`) go private
  along with the repo — full lockdown, not just the source.
- Updates are delivered via **Watchtower**, not a cron job or manual pulls.

### Design

**1. Registry authentication (prerequisite, done before flipping anything private)**

- Generate a GitHub **fine-grained PAT**, scoped to only the
  `tjstasulli/HomeGlow` repository, with **Packages: read-only** permission
  and a 1-year expiration (fine-grained tokens cannot be set to "no
  expiration"). Scoping to one repo and one permission limits the blast
  radius if the token ever leaks, versus a classic PAT's broader reach.
- One-time on `WindowToTheStars`: `docker login ghcr.io -u tjstasulli
  --password-stdin` using that PAT. This writes credentials to
  `~/.docker/config.json` (Docker's default credential store; the file is
  owner-only by default). No token is stored in any compose file.
- **Rotation**: the PAT expires in ~1 year. Set a reminder to generate a new
  one and re-run `docker login` before then — an expired token makes both
  manual pulls and Watchtower's checks start failing (Watchtower logs this;
  it does not fail silently, but nothing currently surfaces that log to the
  user — see optional notification note below).

**2. Flip repo and packages to private**

- GitHub repo settings → Danger Zone → change visibility to private.
- Each GHCR package's own settings → change visibility to private (package
  visibility is independent of repo visibility and must be set explicitly).
- Verify: `docker compose pull` on the Pi still succeeds using the
  credentials from step 1 before relying on Watchtower.

**3. Watchtower deployment**

Own directory, following the established `/opt/<app>/compose.yaml`
convention (Watchtower is cross-cutting infra, not a HomeGlow component, so
it gets its own folder rather than living inside `/opt/homeglow/`):

```yaml
# /opt/watchtower/compose.yaml
services:
  watchtower:
    container_name: watchtower
    image: containrrr/watchtower:latest
    restart: unless-stopped
    environment:
      TZ: America/New_York
      WATCHTOWER_LABEL_ENABLE: "true"
      WATCHTOWER_CLEANUP: "true"
      WATCHTOWER_SCHEDULE: "0 0 4 * * *"   # 4am daily
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /home/spaceman/.docker/config.json:/config.json:ro
```

- `WATCHTOWER_LABEL_ENABLE` scopes Watchtower to only containers explicitly
  opted in via label — it will not touch any other container that might run
  on this Pi later unless that container is labeled too. Add to both
  HomeGlow services in `/opt/homeglow/compose.yaml`:

  ```yaml
      labels:
        - "com.centurylinklabs.watchtower.enable=true"
  ```

- `WATCHTOWER_CLEANUP` removes the superseded image after a successful
  update, keeping disk usage from growing with every release (same "keep it
  sleek" goal as everything else on these Pis).
- Mounting the host's `config.json` read-only gives Watchtower the same
  registry credentials `docker login` already set up — no second copy of
  the token anywhere.

**Optional, not included by default (YAGNI):** Watchtower supports
Shoutrrr-based notifications (Slack, email, etc.) on update success/failure.
Given the PAT-expiry failure mode above, a Slack notification on *failure*
would surface that quickly — worth adding later if silent update failures
become an actual problem, not up front.

### Rollout (Phase 2)

1. Generate the fine-grained PAT; `docker login` on `WindowToTheStars`.
2. Flip the repo private, then both packages private.
3. Confirm `docker compose pull` still works against `/opt/homeglow`.
4. Add the Watchtower label to both HomeGlow services; deploy
   `/opt/watchtower/compose.yaml`.
5. Tag a test release on the fork; confirm Watchtower picks it up on its
   next scheduled run (or trigger one manually to verify sooner) and that
   the HomeGlow containers restart on the new image.
