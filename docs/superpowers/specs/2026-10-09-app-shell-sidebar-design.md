# App Shell: Left Sidebar Navigation + Removable Home Tab

**Status:** Approved in chat, section by section. This document is the design record.

## 1. Problem and goal

HomeGlow's navigation today lives in two separate surfaces:

- `TabBar.jsx` — a floating, bottom-center, horizontal dock holding the
  household's dashboard tabs (Home + any custom tabs), plus Menu / Add-tab /
  Lock / Theme / Refresh buttons.
- `AdminPanel.jsx` — a modal `Dialog`, opened from the dock's Menu, with its
  own horizontal tab bar (`Dashboard / Look / Displays / Family / Security /
  System`) and, within most of those, a second horizontal tab bar for
  sections (e.g. Family → Users / Chores / Prizes / Vacation).

The user wants this reworked into a single, persistent, traditional-website
layout: one left-hand sidebar, collapsible, that handles both switching
dashboard tabs and reaching Settings — replacing both surfaces above. As
part of the same change, the Home tab (today hardcoded as undeletable and
unrenamable) becomes a regular tab like any other.

**Non-goals:** This spec does not change the *content* of any admin section
(Family, System, etc.) — only how you navigate to it. It does not add
hash-routing for dashboard-tab selection (that stays plain React state, as
today). It does not touch the weather-widget split (separate spec).

## 2. Architecture

One new component, `AppShell.jsx`, becomes the persistent frame `app.jsx`
renders instead of today's `<TabBar>` + `<Dialog><AdminPanel/></Dialog>`
pair:

```
<AppShell>
  <Sidebar />           {/* collapsible left rail/panel, always mounted */}
  <MainContent>
    {activeView === 'dashboard' ? <WidgetContainer .../> : <AdminPanel .../>}
  </MainContent>
</AppShell>
```

`AdminPanel.jsx` stops being a `Dialog`. It keeps every section's actual
content (forms, tables, the Family/Chores sub-tabs, etc.) exactly as it
renders today — only its own top-level `Tabs` bar (`ADMIN_TABS`, today
rendered horizontally inside the panel) is removed. That top-level choice
(Dashboard / Look / Displays / Family / Security / System) moves into the
sidebar; `AdminPanel` becomes `<AdminPanel activeTab={location.tab}
location={location} navigate={navigate} ... />`, rendering only the content
for whichever top-level tab the sidebar selected. The *second-level*
section tabs (Users / Chores / Prizes / Vacation within Family, etc.) and
any third-level subsections (Chores → Definitions / History / Settings)
are unchanged — they keep rendering as in-content horizontal tab strips at
the top of the content area, exactly as today. Only the single top-level
choice moves to the sidebar; nesting the second and third levels into the
sidebar too would make it unreasonably deep for six top-level sections that
each already have their own sub-navigation.

`adminNavigation.js`'s hash scheme (`#/admin/family/chores/history`) is
unchanged and still drives which admin section/sub-section is showing.
What changes is *who* reads `location.tab` to decide the top-level view —
today `AdminPanel`'s own `Tabs`; after this change, the sidebar.

## 3. Sidebar behavior

- **Two modes, one list.** The sidebar shows one navigable list at a time.
  **Dashboard mode** (default): the household's dashboard tabs (today's
  `TabBar` tab list, vertical instead of horizontal), with a Settings
  entry (gear icon) pinned at the bottom. Tapping the gear switches the
  *entire list* to **Settings mode**: the six admin top-level entries
  (Dashboard / Look / Displays / Family / Security / System), with a
  "back to dashboard" entry pinned at the top to return to Dashboard mode.
  Lock, Theme, and Refresh render as icon buttons below the list in both
  modes (today's dock buttons, relocated, always reachable).
- **Default: collapsed**, to an icon-only rail — matches the current
  full-width dashboard look. Column width is intentionally not fixed to a
  frozen width so it's easy to tune while implementing; call it 64px
  collapsed.
- **Expand on tap**, not hover — this is a touchscreen-first device. A tap
  anywhere on the collapsed rail, or a dedicated toggle at its top, expands
  it to show labels for whichever mode (Dashboard or Settings) is current.
- **Overlay, not push.** Expanded, the sidebar slides over the left edge of
  the widget grid; it does not resize `WidgetContainer`'s column count.
  Reasoning: resizing on every expand/collapse would force
  `react-grid-layout` to recompute columns and reflow every widget each
  time, which is both expensive and visually unstable for a wall display
  that's supposed to look static between interactions.
- **Auto-collapse** after a dashboard-tab switch or after leaving Settings
  (closing it back to the dashboard view), back to the icon rail.
- **Mobile:** below the existing `isMobile` breakpoint, the sidebar
  overlay becomes full-width when expanded (same pattern `AdminPanel`
  already uses for its mobile full-screen dialog today), so it remains
  usable on a phone-sized viewport.

## 4. Removing Home's special status

Today, `server/index.js`'s tab PATCH and DELETE handlers both hard-refuse
tab number 1 (`Cannot modify home tab` / `Cannot delete home tab`), and
`DELETE .../tabs/:tabNumber` merges the deleted tab's orphaned widget
assignments into tab 1 unconditionally
(`const homeTab = getTabByNumber(deviceName, 1)`).

**New rules:**

- Drop the `parseInt(tabNumber) === 1` guards entirely from both the PATCH
  and DELETE handlers. Tab 1 ("Home" is just its seeded name/icon on a
  fresh device) becomes exactly as deletable and renamable as any other
  tab.
- **New guard:** DELETE refuses to remove the *last remaining tab* for a
  device — `if (remainingTabCountAfterDelete === 0) return 400 'Cannot
  delete your only tab'`. This is the only thing stopping a device from
  having zero tabs; today it's an accidental side effect of tab 1 being
  unconditionally protected.
- **Dynamic merge target.** The orphaned-widget merge destination changes
  from "tab 1" to "the remaining tab with the lowest `number`" —
  `const mergeTarget = db.prepare('SELECT * FROM tabs WHERE device_name = ?
  AND number != ? ORDER BY number ASC LIMIT 1').get(deviceName,
  parsedTabNumber)`. If tab 1 still exists, this is identical to today's
  behavior. If tab 1 (or whatever was deleted) has already been removed,
  the new lowest-numbered tab quietly takes over — no tab is ever renamed,
  re-iconed, or specially flagged; it's purely where orphaned widgets land.
- Client-side: anywhere a delete/rename control is hidden specifically
  "because this is tab 1" (`TabBar.jsx` today; its replacement in
  `AppShell`'s sidebar after this change), the condition becomes "hidden
  because this is the only remaining tab" instead.

## 5. Components and files

**New:**
- `client/src/components/AppShell.jsx` — the sidebar + content-area frame.
  Owns sidebar collapsed/expanded state and which mode (Dashboard vs.
  Settings) is active.

**Rebuilt (not reused):**
- `client/src/components/TabBar.jsx` — today's horizontal floating-dock
  layout doesn't adapt to a vertical rail; its tab-icon SVG set
  (`TabIcon`) is reused, but the container/layout code is replaced. The
  file may be renamed as part of implementation (e.g. `Sidebar.jsx`) — the
  plan decides the exact name.

**Modified:**
- `client/src/components/AdminPanel.jsx` — remove the `Dialog` wrapper and
  the top-level `ADMIN_TABS` `Tabs` block (lines ~1946-1963 today); accept
  the active top-level tab from props/location instead of owning it
  internally. Every section's content (lines after the removed `Tabs`
  blocks) is unchanged.
- `client/src/app.jsx` — replace the `<TabBar>` + `<Dialog><AdminPanel
  .../></Dialog>` block (today's lines ~1493-1510 and ~1454-1486) with
  `<AppShell>`. `showAdminPanel`/`toggleAdminPanel` state is replaced by
  the shell's own active-view state.
- `server/index.js` — the tab PATCH handler (`Cannot modify home tab`,
  ~line 4483) and DELETE handler (`Cannot delete home tab`, ~line 4589),
  per §4.
- `server/tests/*` — whichever existing test(s) assert "deleting a tab
  merges orphans into Home"/tab-1-is-protected get updated to assert the
  dynamic-lowest-tab behavior instead; a new test covers "deleting your
  last tab is refused."

**Unchanged:**
- `client/src/utils/adminNavigation.js` — hash scheme and
  `normalizeAdminLocation`/`parseAdminHash`/`buildAdminHash` logic.
- Every admin section's own content component (`ChoreSchedulesTab.jsx`,
  etc.).

## 6. Testing

- **Server:** the tab-deletion suite's assertions move from "merges into
  tab 1" to "merges into the lowest remaining tab number," plus a new test
  for the last-tab-deletion refusal. Run via `node:test` as established.
- **Client:** this app has no component-rendering test framework
  (established constraint from earlier work this session) — the sidebar's
  collapse/expand/overlay behavior, and the end-to-end "delete Home, add a
  widget, delete another tab, confirm it merges into the new lowest tab"
  flow, are verified manually via Playwright against the dev server,
  matching this session's established verification pattern for UI
  behavior with no automated coverage.

## 7. Review Focus

- Deleting the device's *only* tab must be refused with a clear error, not
  silently leave the device with zero tabs — covered by the new server
  test in §6.
- A device that has already deleted tab 1 and then deletes another tab
  must still merge orphaned widgets somewhere (the new lowest-numbered
  tab), not drop them — covered by the updated server test in §6.
- The sidebar's mobile (narrow-viewport) behavior must remain usable, not
  just collapse into something unreachable — covered by manual Playwright
  verification at a mobile viewport width in §6.
- Widgets already in edit mode (resize/drag selected) must not have their
  selection silently cleared or grid column count recalculated just from
  the sidebar expanding over them (overlay, not push, per §3) — covered by
  manual Playwright verification: select a widget, open the sidebar,
  confirm the widget stays selected and its live column count is
  unchanged.
