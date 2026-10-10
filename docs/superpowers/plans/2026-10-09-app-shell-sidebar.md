# App Shell Sidebar + Removable Home Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating-dock `TabBar` + modal `AdminPanel` with one persistent, collapsible left sidebar covering both dashboard-tab switching and Settings, and make the Home tab a normal, deletable/renamable tab.

**Architecture:** A new `AppShell` component owns a collapsible sidebar (two modes: Dashboard tabs, Settings) and a content area that shows either the widget grid or `AdminPanel`. The sidebar's tab-switching half reuses `TabBar.jsx`'s icon set but replaces its horizontal-dock layout with a vertical rail. `AdminPanel` loses its own top-level `Tabs` bar and `Dialog` wrapper but keeps every section's content unchanged. The server drops tab 1's hardcoded protection and generalizes tab renumbering/widget-merge-on-delete to work for any tab.

**Tech Stack:** React 19, MUI, Fastify, better-sqlite3, `node:test` (server), Vitest (client, pure-function only — no component-rendering framework).

**Spec:** `docs/superpowers/specs/2026-10-09-app-shell-sidebar-design.md`

## Global Constraints

- No component-rendering test framework exists in this client — sidebar collapse/expand/overlay behavior and any other UI-only behavior is verified manually via Playwright against the dev server, not new client unit tests.
- Overlay, not push: the sidebar must never resize `WidgetContainer`'s live column count when it expands/collapses (spec §3).
- Default sidebar state is collapsed to an icon rail (spec §3).
- `adminNavigation.js`'s hash scheme and exports (`ADMIN_LAYOUT`, `ADMIN_TABS`, `parseAdminHash`, `setAdminHash`, `clearAdminHash`, `isAdminHash`, `normalizeAdminLocation`) are unchanged — reused as-is, not modified.
- No tab is ever renamed/re-iconed by the system as a side effect of deleting another tab (spec §4) — the merge target is purely where orphaned widgets land, invisibly.

## Review Focus

- Deleting a device's *only* tab must be refused with a clear, visible error (not just a generic "try again" alert) — covered by Task 1's server test and Task 4's client-side error-surfacing fix.
- A device that already deleted tab 1, then deletes another tab, must still merge that tab's orphaned widgets somewhere — covered by Task 1's new server test for merging into a non-1 lowest tab.
- The renumbering step after a delete must not skip tab number 1 forever once tab 1 itself has been deleted (today's renumbering always starts survivors at 2) — covered by Task 1's renumbering fix and test.
- A widget that's selected (resize handles showing) when the sidebar expands over it must stay selected and keep its live column count — covered by Task 4's manual Playwright verification.
- The sidebar must remain usable at the mobile breakpoint, not just collapse into something unreachable — covered by Task 4's manual Playwright verification at a mobile viewport width.

---

## Task 1: Server — generalize tab deletion/modification, drop Home's special status

**Files:**
- Modify: `server/index.js:4476-4486` (PATCH handler's home-tab guard)
- Modify: `server/index.js:4582-4645` (DELETE handler: guard, merge target, renumbering)
- Test: `server/tests/apiEndpoints.test.js`

**Interfaces:**
- Consumes: existing `getTabByNumber(deviceName, tabNumber)`, `parseTabConfigJson(configJson)`, `saveTabConfigById(tabId, layoutMap)`, `normalizeLayoutFields(layout)`, `touchDeviceUpdateTime(deviceName)`, `ensureDeviceExists(deviceName)` — all already defined elsewhere in `server/index.js`, unchanged.
- Produces: `DELETE /api/devices/:deviceName/tabs/:tabNumber` now accepts any tab number including 1, refuses only when it's the device's last remaining tab (`400 { error: 'Cannot delete your only tab' }`), and merges onto the lowest-numbered remaining tab instead of hardcoded tab 1. `PATCH /api/devices/:deviceName/tabs/:tabNumber` now accepts tab 1 like any other. Later tasks (client) consume this by removing their own tab-1-specific UI guards.

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/apiEndpoints.test.js`, after the existing `'deleting a non-home tab moves assigned widgets to Home tab'` test (the one ending at line 279):

```javascript
test('deleting the home tab moves its widgets to the new lowest tab, and home becomes deletable', async () => {
    const deviceName = `delete-home-tab-${Date.now()}`;

    const createTabRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs`, {
        method: 'POST',
        body: JSON.stringify({ label: 'Extras', icon: 'star', show_label: true }),
    });
    assert.equal(createTabRes.status, 200);
    assert.equal(createTabRes.body.number, 2);

    const createAssignmentRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/widget-assignments`, {
        method: 'POST',
        body: JSON.stringify({ widget_name: 'plugin:sample-widget', tabNumber: 1 }),
    });
    assert.equal(createAssignmentRes.status, 200);

    const deleteTabRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs/1`, {
        method: 'DELETE',
    });
    assert.equal(deleteTabRes.status, 200);

    const tabsRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs`);
    assert.equal(tabsRes.status, 200);
    assert.equal(tabsRes.body.length, 1);
    assert.equal(tabsRes.body[0].number, 1, 'the sole survivor is renumbered to 1, not left at 2');
    assert.equal(tabsRes.body[0].label, 'Extras', 'the survivor keeps its own label - nothing renames it to Home');

    const assignmentsRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/widget-assignments`);
    assert.equal(assignmentsRes.status, 200);
    const movedAssignment = assignmentsRes.body.find((row) => row.widget_name === 'plugin:sample-widget');
    assert.ok(movedAssignment, 'Expected plugin assignment to survive home-tab deletion');
    assert.equal(movedAssignment.tab_number, 1, 'merged onto the renumbered survivor, now tab 1');
});

test('deleting a device\'s only remaining tab is refused', async () => {
    const deviceName = `delete-only-tab-${Date.now()}`;

    // A brand-new device has exactly one tab (Home, number 1) and nothing else.
    const deleteTabRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs/1`, {
        method: 'DELETE',
    });
    assert.equal(deleteTabRes.status, 400);
    assert.equal(deleteTabRes.body.error, 'Cannot delete your only tab');

    const tabsRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs`);
    assert.equal(tabsRes.status, 200);
    assert.equal(tabsRes.body.length, 1, 'the only tab was not deleted');
});

test('the home tab can be renamed like any other tab', async () => {
    const deviceName = `rename-home-tab-${Date.now()}`;

    const patchRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs/1`, {
        method: 'PATCH',
        body: JSON.stringify({ label: 'Main', icon: 'star' }),
    });
    assert.equal(patchRes.status, 200);

    const tabsRes = await api(`/api/devices/${encodeURIComponent(deviceName)}/tabs`);
    assert.equal(tabsRes.status, 200);
    assert.equal(tabsRes.body[0].label, 'Main');
    assert.equal(tabsRes.body[0].icon, 'star');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test tests/apiEndpoints.test.js`
Expected: FAIL. The home-tab-delete test fails with the handler's current `400 'Cannot delete home tab'` response instead of a `200`. The only-tab-refusal test fails because today's handler never produces the message `'Cannot delete your only tab'` (it unconditionally blocks tab 1 with a different message, regardless of how many tabs exist). The rename test fails with `400 'Cannot modify home tab'`.

- [ ] **Step 3: Remove the PATCH handler's home-tab guard**

Find in `server/index.js`:
```javascript
fastify.patch('/api/devices/:deviceName/tabs/:tabNumber', async (request, reply) => {
  const { deviceName, tabNumber } = request.params;
  const { label, icon, show_label } = request.body;
  if (!deviceName) {
    return reply.status(400).send({ error: 'deviceName is required' });
  }
  ensureDeviceExists(deviceName);
  if (parseInt(tabNumber) === 1) {
    return reply.status(400).send({ error: 'Cannot modify home tab' });
  }

  try {
```
Replace with:
```javascript
fastify.patch('/api/devices/:deviceName/tabs/:tabNumber', async (request, reply) => {
  const { deviceName, tabNumber } = request.params;
  const { label, icon, show_label } = request.body;
  if (!deviceName) {
    return reply.status(400).send({ error: 'deviceName is required' });
  }
  ensureDeviceExists(deviceName);

  try {
```

- [ ] **Step 4: Rewrite the DELETE handler**

Find in `server/index.js`:
```javascript
fastify.delete('/api/devices/:deviceName/tabs/:tabNumber', async (request, reply) => {
  const { deviceName, tabNumber } = request.params;
  if (!deviceName) {
    return reply.status(400).send({ error: 'deviceName is required' });
  }
  ensureDeviceExists(deviceName);

  if (parseInt(tabNumber) === 1) {
    return reply.status(400).send({ error: 'Cannot delete home tab' });
  }

  try {
    const parsedTabNumber = parseInt(tabNumber, 10);

    const sourceTab = getTabByNumber(deviceName, parsedTabNumber);
    if (!sourceTab) {
      return reply.status(404).send({ error: 'Tab not found' });
    }

    const homeTab = getTabByNumber(deviceName, 1);
    const sourceLayoutMap = parseTabConfigJson(sourceTab.config_json);
    const homeLayoutMap = parseTabConfigJson(homeTab?.config_json);
    let homeChanged = false;

    Object.entries(sourceLayoutMap).forEach(([widgetName, layout]) => {
      if (!(widgetName in homeLayoutMap)) {
        homeLayoutMap[widgetName] = normalizeLayoutFields(layout);
        homeChanged = true;
      }
    });

    if (homeTab && homeChanged) {
      saveTabConfigById(homeTab.id, homeLayoutMap);
    }

    const deleteStmt = db.prepare('DELETE FROM tabs WHERE number = ? AND device_name = ?');
    deleteStmt.run(parsedTabNumber, deviceName);

    const remainingTabs = db
      .prepare('SELECT id FROM tabs WHERE device_name = ? AND number != 1 ORDER BY number ASC')
      .all(deviceName);

    const renumberTransaction = db.transaction((tabRows) => {
      const tempStmt = db.prepare('UPDATE tabs SET number = ? WHERE id = ? AND device_name = ?');
      const finalStmt = db.prepare('UPDATE tabs SET number = ? WHERE id = ? AND device_name = ?');

      tabRows.forEach((row, index) => {
        tempStmt.run(-2000 - index, row.id, deviceName);
      });

      tabRows.forEach((row, index) => {
        finalStmt.run(index + 2, row.id, deviceName);
      });
    });

    renumberTransaction(remainingTabs);
    touchDeviceUpdateTime(deviceName);

    return { success: true, message: 'Tab deleted successfully' };
  } catch (error) {
    console.error('Error deleting tab:', error);
    reply.status(500).send({ error: 'Failed to delete tab' });
  }
});
```
Replace with:
```javascript
fastify.delete('/api/devices/:deviceName/tabs/:tabNumber', async (request, reply) => {
  const { deviceName, tabNumber } = request.params;
  if (!deviceName) {
    return reply.status(400).send({ error: 'deviceName is required' });
  }
  ensureDeviceExists(deviceName);

  try {
    const parsedTabNumber = parseInt(tabNumber, 10);

    const sourceTab = getTabByNumber(deviceName, parsedTabNumber);
    if (!sourceTab) {
      return reply.status(404).send({ error: 'Tab not found' });
    }

    // No tab is hardcoded as the merge target any more: it's whichever
    // remaining tab has the lowest number. If tab 1 still exists this is
    // identical to the old "always Home" behavior; if tab 1 was already
    // deleted, the next-lowest tab quietly takes over - it is never
    // renamed or re-iconed, this is purely where orphaned widgets land.
    const mergeTargetTab = db
      .prepare('SELECT * FROM tabs WHERE device_name = ? AND number != ? ORDER BY number ASC LIMIT 1')
      .get(deviceName, parsedTabNumber);

    if (!mergeTargetTab) {
      return reply.status(400).send({ error: 'Cannot delete your only tab' });
    }

    const sourceLayoutMap = parseTabConfigJson(sourceTab.config_json);
    const mergeTargetLayoutMap = parseTabConfigJson(mergeTargetTab.config_json);
    let mergeTargetChanged = false;

    Object.entries(sourceLayoutMap).forEach(([widgetName, layout]) => {
      if (!(widgetName in mergeTargetLayoutMap)) {
        mergeTargetLayoutMap[widgetName] = normalizeLayoutFields(layout);
        mergeTargetChanged = true;
      }
    });

    if (mergeTargetChanged) {
      saveTabConfigById(mergeTargetTab.id, mergeTargetLayoutMap);
    }

    const deleteStmt = db.prepare('DELETE FROM tabs WHERE number = ? AND device_name = ?');
    deleteStmt.run(parsedTabNumber, deviceName);

    // No tab is excluded from renumbering any more - gaps are closed
    // starting at 1, the same as every other tab.
    const remainingTabs = db
      .prepare('SELECT id FROM tabs WHERE device_name = ? ORDER BY number ASC')
      .all(deviceName);

    const renumberTransaction = db.transaction((tabRows) => {
      const tempStmt = db.prepare('UPDATE tabs SET number = ? WHERE id = ? AND device_name = ?');
      const finalStmt = db.prepare('UPDATE tabs SET number = ? WHERE id = ? AND device_name = ?');

      tabRows.forEach((row, index) => {
        tempStmt.run(-2000 - index, row.id, deviceName);
      });

      tabRows.forEach((row, index) => {
        finalStmt.run(index + 1, row.id, deviceName);
      });
    });

    renumberTransaction(remainingTabs);
    touchDeviceUpdateTime(deviceName);

    return { success: true, message: 'Tab deleted successfully' };
  } catch (error) {
    console.error('Error deleting tab:', error);
    reply.status(500).send({ error: 'Failed to delete tab' });
  }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && node --test tests/apiEndpoints.test.js`
Expected: PASS, all tests in the file including the three new ones and the pre-existing `'deleting a non-home tab moves assigned widgets to Home tab'` test (whose behavior is unchanged, since tab 1 is still the lowest remaining tab in that scenario).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS (same 3 pre-existing unrelated `timezoneUpgrade.test.js` failures as the rest of this session, caused by a stray `server/.env`; everything else green).

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/tests/apiEndpoints.test.js
git commit -m "feat(tabs): let Home be deleted/renamed like any other tab"
```

---

## Task 2: AppShell + Sidebar in Dashboard mode, replacing the floating dock

**Files:**
- Create: `client/src/components/AppShell.jsx`
- Modify: `client/src/components/TabBar.jsx:223-559` (replace the component body; keep the `TabIcon`/`MenuIcon` definitions at lines 1-221 unchanged)
- Modify: `client/src/app.jsx` (swap the `<TabBar>` wiring for `<AppShell>`; Settings still opens the existing `Dialog`-wrapped `AdminPanel` in this task — that gets replaced in Task 3)

**Interfaces:**
- Consumes: nothing from Task 1 (independent — Task 1 is server-only).
- Produces: `AppShell` component — `(props: { tabs, activeTab, onTabChange, widgetsLocked, onAddTab, onDeleteTab, onToggleTheme, onToggleLock, onOpenSettings, onRefresh, theme, themeMode, screensaverCountdown, children }) => JSX`. `children` is the dashboard content (the widget grid / mobile stack), rendered in the shell's content area. Task 3 consumes this same `AppShell` and adds Settings-mode rendering alongside `children`.

- [ ] **Step 1: Replace `TabBar.jsx`'s component body with a sidebar**

The icon definitions (`TabIcon`, `MenuIcon`, lines 1-221) stay exactly as they are. Find the component body starting at line 223:

```javascript
const TabBar = ({
  tabs,
  activeTab,
  onTabChange,
  widgetsLocked,
  onAddTab,
  onDeleteTab,
  onToggleTheme,
  onToggleLock,
  onOpenSettings,
  onRefresh,
  theme,
  themeMode,
  screensaverCountdown,
}) => {
```
(...through the end of the file, `export default TabBar;`)

Replace the entire body (everything from `const TabBar = ({` through the final `export default TabBar;`) with:

```javascript
export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_EXPANDED_WIDTH = 240;

const TabBar = ({
  tabs,
  activeTab,
  onTabChange,
  widgetsLocked,
  onAddTab,
  onDeleteTab,
  onToggleTheme,
  onToggleLock,
  onOpenSettings,
  onRefresh,
  theme,
  themeMode,
  screensaverCountdown,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();

  const defaultHomeTab = {
    id: 1,
    number: 1,
    label: 'Home',
    icon: 'home',
    show_label: 0,
    index: 0,
  };

  const displayTabs = tabs && tabs.length > 0 ? tabs : [defaultHomeTab];
  const canDeleteTabs = !widgetsLocked && displayTabs.length > 1;

  const getThemeIconName = () => {
    if (themeMode === 'auto') return 'automode';
    return theme === 'dark' ? 'darkmode' : 'lightmode';
  };

  const getThemeLabel = () => {
    if (themeMode === 'auto') return 'Auto Mode';
    return theme === 'dark' ? 'Dark Mode' : 'Light Mode';
  };

  const selectTab = (tabNumber) => {
    onTabChange(tabNumber);
    setExpanded(false);
  };

  const railWidth = isMobile && expanded ? '100%' : (expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH);

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: railWidth,
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--dock-bg)',
        borderRight: '1px solid var(--dock-border)',
        backdropFilter: 'blur(20px)',
        boxShadow: expanded ? '8px 0 32px var(--hg-black-30), 2px 0 8px var(--hg-black-20)' : 'none',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* HomeGlow logo / collapse-expand toggle */}
      <Box
        onClick={() => setExpanded((prev) => !prev)}
        sx={{
          height: 64,
          minHeight: 64,
          display: 'flex',
          alignItems: 'center',
          px: 1,
          gap: 1.5,
          cursor: 'pointer',
          flexShrink: 0,
          '&:hover': { backgroundColor: 'var(--hg-white-10)' },
        }}
      >
        <Box sx={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <img src="/HomeGlowLogo.svg" alt="HomeGlow" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
        </Box>
        {expanded && (
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
            HomeGlow
          </Typography>
        )}
      </Box>

      <Box sx={{ borderTop: '1px solid var(--dock-separator)' }} />

      {/* Dashboard tabs */}
      <Box sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
        {displayTabs.map((tab) => {
          const tabNumber = tab.number ?? tab.id;
          const isActive = activeTab === tabNumber;

          return (
            <Box key={tab.id ?? tabNumber} sx={{ position: 'relative', px: 1, mb: 0.5 }}>
              {canDeleteTabs && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTab(tabNumber);
                  }}
                  sx={{
                    position: 'absolute',
                    top: -4,
                    right: 2,
                    width: 16,
                    height: 16,
                    minWidth: 0,
                    padding: 0,
                    backgroundColor: 'var(--hg-error)',
                    color: 'white',
                    zIndex: 10,
                    '&:hover': { backgroundColor: 'var(--hg-error-hover)' },
                  }}
                >
                  <Close sx={{ fontSize: 10 }} />
                </IconButton>
              )}
              <Tooltip title={expanded ? '' : (tab.label || `Tab ${tabNumber}`)} placement="right">
                <Box
                  onClick={() => selectTab(tabNumber)}
                  sx={{
                    width: '100%',
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.25,
                    cursor: 'pointer',
                    borderRadius: 'var(--hg-radius-lg)',
                    backgroundColor: isActive ? 'var(--dock-active-bg)' : 'transparent',
                    backgroundImage: isActive ? 'var(--dock-active-image)' : 'none',
                    border: isActive ? '1.5px solid var(--dock-active-border)' : '1.5px solid transparent',
                    '&:hover': { backgroundColor: isActive ? 'var(--dock-active-bg)' : 'var(--hg-white-10)' },
                  }}
                >
                  <Box sx={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <TabIcon name={tab.icon} size={22} color={isActive ? 'var(--dock-active-icon)' : 'var(--dock-icon)'} />
                  </Box>
                  {expanded && (
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tab.label || `Tab ${tabNumber}`}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            </Box>
          );
        })}

        {!widgetsLocked && (
          <Box sx={{ px: 1 }}>
            <Tooltip title={expanded ? '' : 'Add new tab'} placement="right">
              <Box
                onClick={onAddTab}
                sx={{
                  width: '100%',
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 1.25,
                  cursor: 'pointer',
                  borderRadius: 'var(--hg-radius-lg)',
                  '&:hover': { backgroundColor: 'var(--hg-white-10)' },
                }}
              >
                <Box sx={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Add sx={{ fontSize: 20, color: 'var(--dock-icon)' }} />
                </Box>
                {expanded && (
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    Add new tab
                  </Typography>
                )}
              </Box>
            </Tooltip>
          </Box>
        )}
      </Box>

      {screensaverCountdown && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 1 }}>
          {screensaverCountdown}
        </Box>
      )}

      <Box sx={{ borderTop: '1px solid var(--dock-separator)' }} />

      {/* Utility buttons: refresh, lock, theme, settings */}
      <Box sx={{ py: 1, px: 1, flexShrink: 0 }}>
        {[
          { id: 'refresh', icon: 'refresh', label: 'Refresh', action: onRefresh },
          ...(isMobile ? [] : [{ id: 'lock', icon: 'move', label: widgetsLocked ? 'Move/Resize' : 'Lock Layout', action: onToggleLock }]),
          { id: 'theme', icon: getThemeIconName(), label: getThemeLabel(), action: onToggleTheme },
          { id: 'settings', icon: 'settings', label: 'Settings', action: onOpenSettings },
        ].map((item) => (
          <Tooltip key={item.id} title={expanded ? '' : item.label} placement="right">
            <Box
              onClick={() => {
                item.action();
                setExpanded(false);
              }}
              sx={{
                width: '100%',
                height: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.25,
                cursor: 'pointer',
                borderRadius: 'var(--hg-radius-lg)',
                '&:hover': { backgroundColor: 'var(--hg-white-10)' },
              }}
            >
              <Box sx={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MenuIcon name={item.icon} size={18} color="var(--text)" />
              </Box>
              {expanded && (
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {item.label}
                </Typography>
              )}
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
};

export default TabBar;
```

Note what was intentionally dropped versus the old dock: the `ClickAwayListener`-driven popup Menu is gone (the sidebar itself now holds Refresh/Settings/Lock/Theme as always-visible rows instead of hiding them behind a Menu click), so the `ClickAwayListener` import becomes unused in this file — remove it from the `import { Box, IconButton, Tooltip, Typography, ClickAwayListener } from '@mui/material';` line at the top, leaving `import { Box, IconButton, Tooltip, Typography } from '@mui/material';`.

- [ ] **Step 2: Create `AppShell.jsx`**

```javascript
import React from 'react';
import { Box } from '@mui/material';
import useIsMobile from '../hooks/useIsMobile.js';
import TabBar, { SIDEBAR_COLLAPSED_WIDTH } from './TabBar.jsx';

// The persistent app frame: a collapsible left sidebar (TabBar, despite the
// name - the file keeps it for now to avoid an unrelated rename) plus a
// content area that fills whatever space the sidebar's collapsed rail
// doesn't take. The sidebar overlays rather than pushes when expanded, so
// expanding/collapsing it never changes the content area's own width - see
// docs/superpowers/specs/2026-10-09-app-shell-sidebar-design.md §3.
const AppShell = ({
  tabs,
  activeTab,
  onTabChange,
  widgetsLocked,
  onAddTab,
  onDeleteTab,
  onToggleTheme,
  onToggleLock,
  onOpenSettings,
  onRefresh,
  theme,
  themeMode,
  screensaverCountdown,
  children,
}) => {
  const isMobile = useIsMobile();

  return (
    <Box sx={{ display: 'flex', width: '100%', minHeight: '100vh' }}>
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        widgetsLocked={widgetsLocked}
        onAddTab={onAddTab}
        onDeleteTab={onDeleteTab}
        onToggleTheme={onToggleTheme}
        onToggleLock={onToggleLock}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
        theme={theme}
        themeMode={themeMode}
        screensaverCountdown={screensaverCountdown}
      />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          // Reserve space for the collapsed rail only - the expanded state
          // overlays on top via its own position:fixed, it never resizes
          // this box.
          ml: isMobile ? 0 : `${SIDEBAR_COLLAPSED_WIDTH}px`,
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

export default AppShell;
```

- [ ] **Step 3: Wire `AppShell` into `app.jsx`, keep Settings on the old modal for now**

Find in `client/src/app.jsx`:
```javascript
import TabBar from './components/TabBar.jsx';
```
Replace with:
```javascript
import AppShell from './components/AppShell.jsx';
```

Find:
```javascript
      {/* Floating Dock TabBar. The dock renders above MUI dialogs, so hide it
          while the Admin Panel is open full-screen on mobile — otherwise it
          covers the bottom action buttons of the panel's dialogs. */}
      {!(isMobile && showAdminPanel) && (
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        widgetsLocked={widgetsLocked}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onToggleTheme={toggleTheme}
        onToggleLock={toggleWidgetsLock}
        onOpenSettings={toggleAdminPanel}
        onRefresh={handlePageRefresh}
        theme={displayTheme}
        themeMode={themeMode}
        screensaverCountdown={
          // No screensaver on mobile — don't show a countdown that never fires.
          isMobile ? null : (
            <ScreensaverCountdown
              enabled={screensaverSettings.enabled}
              timeoutMinutes={screensaverSettings.timeout}
              lastActivityRef={lastActivityRef}
              screensaverActive={screensaverActive}
            />
          )
        }
      />
      )}
```
Replace with:
```javascript
      {/* The sidebar renders above MUI dialogs, so hide it while the Admin
          Panel is open full-screen on mobile — otherwise it covers the
          bottom action buttons of the panel's dialogs. */}
      {!(isMobile && showAdminPanel) && (
      <AppShell
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        widgetsLocked={widgetsLocked}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onToggleTheme={toggleTheme}
        onToggleLock={toggleWidgetsLock}
        onOpenSettings={toggleAdminPanel}
        onRefresh={handlePageRefresh}
        theme={displayTheme}
        themeMode={themeMode}
        screensaverCountdown={
          isMobile ? null : (
            <ScreensaverCountdown
              enabled={screensaverSettings.enabled}
              timeoutMinutes={screensaverSettings.timeout}
              lastActivityRef={lastActivityRef}
              screensaverActive={screensaverActive}
            />
          )
        }
      />
      )}
```

This step intentionally does **not** wrap `children` around the dashboard content yet (`AppShell` is only rendered here as a standalone sidebar overlay, same as the old `TabBar`, not yet hosting the widget grid as `children`) — the dashboard grid keeps rendering exactly where it already does in `app.jsx`'s JSX tree for this task. Task 3 finishes the integration by making the widget grid an actual `children` of `AppShell` and moving `AdminPanel` in alongside it. This keeps this task's diff reviewable as "the sidebar replaces the dock, nothing else changes yet."

- [ ] **Step 4: Update the "Welcome to HomeGlow" empty-state copy**

Find in `client/src/app.jsx`:
```javascript
              <Typography variant="body1" sx={{ color: 'var(--text-secondary)', mb: 1 }}>
                Click the HomeGlow logo in the dock below and open Settings to choose which widgets you want to see.
              </Typography>
```
Replace with:
```javascript
              <Typography variant="body1" sx={{ color: 'var(--text-secondary)', mb: 1 }}>
                Click the HomeGlow logo in the sidebar and open Settings to choose which widgets you want to see.
              </Typography>
```

- [ ] **Step 5: Run the full client test suite**

Run: `cd client && npm test`
Expected: PASS, 578/578 (confirmed via `grep -rln "TabBar" client/src --include="*.test.js"` returning nothing — no test references `TabBar` directly, so none needs updating for its internal restructuring).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/AppShell.jsx client/src/components/TabBar.jsx client/src/app.jsx
git commit -m "feat(shell): replace the floating dock with a collapsible left sidebar"
```

---

## Task 3: Fold Settings into the shell's content area, remove the modal

**Files:**
- Modify: `client/src/components/AdminPanel.jsx:1946-1963` (remove the Dialog-internal top-level `Tabs` bar; the component now receives no `Dialog`/modal wrapper at all)
- Modify: `client/src/app.jsx` (remove the `Dialog` wrapper; render `AdminPanel` as `AppShell`'s content when Settings is open, the widget grid otherwise)
- Modify: `client/src/components/AppShell.jsx` (read the admin hash to know whether Settings mode is active, for the sidebar's open/active state)

**Interfaces:**
- Consumes: `AppShell` from Task 2 (`children` prop now actually used); `adminNavigation.js`'s existing `isAdminHash()`, unchanged.
- Produces: nothing further downstream — this is the last structural task; Task 4 is verification/deploy only.

- [ ] **Step 1: Remove `AdminPanel`'s top-level Tabs bar**

Find in `client/src/components/AdminPanel.jsx`:
```javascript
  return (
    <Box sx={{ width: '100%', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom sx={{ pr: { xs: 5, sm: 0 } }}>
        ⚙️ {t('admin:panelTitle')}
      </Typography>

      <Tabs
        value={ADMIN_TABS.indexOf(location.tab)}
        onChange={(e, index) => navigate({ tab: ADMIN_TABS[index] })}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3 }}
      >
        {ADMIN_TABS.map((name) => (
          <Tab key={name} label={t(`admin:panelTabs.${name}`)} />
        ))}
      </Tabs>

      {sections.length > 0 && (
```
Replace with:
```javascript
  return (
    <Box sx={{ width: '100%', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom sx={{ pr: { xs: 5, sm: 0 } }}>
        {t(`admin:panelTabs.${location.tab}`)}
      </Typography>

      {sections.length > 0 && (
```

(The second-level section `Tabs` block immediately below, and everything after it, is untouched — only the top-level `Tabs` and the generic "⚙️ Settings" heading are removed; the heading now names the active top-level section instead.)

- [ ] **Step 2: Make `AppShell` aware of Settings mode**

Find in `client/src/components/AppShell.jsx`:
```javascript
import React from 'react';
import { Box } from '@mui/material';
import useIsMobile from '../hooks/useIsMobile.js';
import TabBar, { SIDEBAR_COLLAPSED_WIDTH } from './TabBar.jsx';
```
Replace with:
```javascript
import React, { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import useIsMobile from '../hooks/useIsMobile.js';
import TabBar, { SIDEBAR_COLLAPSED_WIDTH } from './TabBar.jsx';
import { isAdminHash } from '../utils/adminNavigation.js';
```

Find:
```javascript
const AppShell = ({
  tabs,
  activeTab,
  onTabChange,
  widgetsLocked,
  onAddTab,
  onDeleteTab,
  onToggleTheme,
  onToggleLock,
  onOpenSettings,
  onRefresh,
  theme,
  themeMode,
  screensaverCountdown,
  children,
}) => {
  const isMobile = useIsMobile();

  return (
```
Replace with:
```javascript
const AppShell = ({
  tabs,
  activeTab,
  onTabChange,
  widgetsLocked,
  onAddTab,
  onDeleteTab,
  onToggleTheme,
  onToggleLock,
  onOpenSettings,
  onRefresh,
  theme,
  themeMode,
  screensaverCountdown,
  settingsOpen,
  settingsContent,
  children,
}) => {
  const isMobile = useIsMobile();

  return (
```

Find:
```javascript
        {children}
      </Box>
    </Box>
  );
};

export default AppShell;
```
Replace with:
```javascript
        {settingsOpen ? settingsContent : children}
      </Box>
    </Box>
  );
};

export default AppShell;
```

(`isAdminHash` is imported for Step 3's use in `app.jsx`, not used inside `AppShell.jsx` itself — `AppShell` takes `settingsOpen` as a prop rather than reading the hash directly, keeping it a plain presentational component. Remove the unused `isAdminHash` import from this file if a lint step flags it after Step 3 is also done; `app.jsx` is where it's actually called.)

- [ ] **Step 3: Replace the Dialog wrapper in `app.jsx` with shell-hosted content**

Find in `client/src/app.jsx`:
```javascript
import { parseAdminHash, clearAdminHash } from './utils/adminNavigation.js';
```
Replace with:
```javascript
import { parseAdminHash, clearAdminHash, isAdminHash } from './utils/adminNavigation.js';
```

Find:
```javascript
      <Dialog
        open={showAdminPanel}
        onClose={toggleAdminPanel}
        maxWidth="lg"
        fullScreen={isMobile}
        // An edge for the floating panel, which can sink into a page background
        // of a similar solid color (#230). Full screen on a phone needs none.
        slotProps={{ paper: { sx: isMobile ? {} : { border: '1px solid var(--card-border)' } } }}
      >
        <DialogContent sx={{ position: 'relative', '@media (max-width:599.95px)': { p: 1.5 } }}>
          <IconButton
            onClick={toggleAdminPanel}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: 'text.secondary',
              zIndex: 1,
              '&:hover': {
                color: 'error.main',
              },
            }}
          >
            <Close />
          </IconButton>
          <Suspense fallback={<Typography sx={{ py: 2 }}>Loading settings...</Typography>}>
            <AdminPanel
              setWidgetSettings={setWidgetSettings}
              onRequestClose={toggleAdminPanel}
              onPluginsChanged={fetchInstalledPlugins}
              onTabsChanged={async () => {
                await fetchTabs();
                await fetchWidgetAssignments();
              }}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      {/* The sidebar renders above MUI dialogs, so hide it while the Admin
          Panel is open full-screen on mobile — otherwise it covers the
          bottom action buttons of the panel's dialogs. */}
      {!(isMobile && showAdminPanel) && (
      <AppShell
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        widgetsLocked={widgetsLocked}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onToggleTheme={toggleTheme}
        onToggleLock={toggleWidgetsLock}
        onOpenSettings={toggleAdminPanel}
        onRefresh={handlePageRefresh}
        theme={displayTheme}
        themeMode={themeMode}
        screensaverCountdown={
          isMobile ? null : (
            <ScreensaverCountdown
              enabled={screensaverSettings.enabled}
              timeoutMinutes={screensaverSettings.timeout}
              lastActivityRef={lastActivityRef}
              screensaverActive={screensaverActive}
            />
          )
        }
      />
      )}
```
Replace with:
```javascript
      <AppShell
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        widgetsLocked={widgetsLocked}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onToggleTheme={toggleTheme}
        onToggleLock={toggleWidgetsLock}
        onOpenSettings={toggleAdminPanel}
        onRefresh={handlePageRefresh}
        theme={displayTheme}
        themeMode={themeMode}
        screensaverCountdown={
          isMobile ? null : (
            <ScreensaverCountdown
              enabled={screensaverSettings.enabled}
              timeoutMinutes={screensaverSettings.timeout}
              lastActivityRef={lastActivityRef}
              screensaverActive={screensaverActive}
            />
          )
        }
        settingsOpen={showAdminPanel}
        settingsContent={
          <Box sx={{ position: 'relative', p: { xs: 1.5, sm: 3 } }}>
            <IconButton
              onClick={toggleAdminPanel}
              sx={{
                position: 'absolute',
                right: 8,
                top: 8,
                color: 'text.secondary',
                zIndex: 1,
                '&:hover': { color: 'error.main' },
              }}
            >
              <Close />
            </IconButton>
            <Suspense fallback={<Typography sx={{ py: 2 }}>Loading settings...</Typography>}>
              <AdminPanel
                setWidgetSettings={setWidgetSettings}
                onRequestClose={toggleAdminPanel}
                onPluginsChanged={fetchInstalledPlugins}
                onTabsChanged={async () => {
                  await fetchTabs();
                  await fetchWidgetAssignments();
                }}
              />
            </Suspense>
          </Box>
        }
      >
```

This opens a `children` block for `AppShell` that is not yet closed — the dashboard content that used to render as a sibling of the (now-removed) `Dialog`/`AppShell` pair becomes `AppShell`'s `children`. This is a pure cut-and-move of existing JSX, no new content to write:

- **Cut start:** the line `<Box sx={{ width: '100%', minHeight: '100vh', position: 'relative', pb: '80px' }}>` (the root content `Box` — opens the widget grid / mobile stack / empty-state block).
- **Cut end:** the `</Box>` that closes that same root content `Box`, identifiable as the `</Box>` immediately followed by a blank line and then `<Dialog` in the pre-Step-3 file (i.e. two lines above where Step 3's first find-block begins).
- **Paste:** immediately after the `<AppShell ...>` opening tag written above (as its first child), before `settingsOpen`/`settingsContent` continue to apply to the same `<AppShell>` element — those are props on the opening tag, unaffected by where children are pasted.
- **New closing tag:** add `</AppShell>` immediately after the pasted block's own closing `</Box>` (i.e. where that `</Box>` used to be directly followed by `<Dialog`, it's now followed by `</AppShell>` instead).

Net effect: `<AppShell ...props... settingsContent={...}>` now wraps the entire root content `Box` as its single child, and the old `Dialog`/separate `AppShell`-as-sibling structure no longer exists.

- [ ] **Step 4: Update the mobile full-screen Settings accommodation**

The old dock-hiding condition (`!(isMobile && showAdminPanel)`) existed because the dock and the Dialog could visually collide on a small screen. With Settings now rendered inline in `AppShell`'s own content area instead of a competing `Dialog`, that collision can't happen the same way, but the sidebar should still collapse to its narrow rail automatically while Settings is open on mobile, so the inline Settings content gets full width. Find in `client/src/components/AppShell.jsx`, inside the `TabBar` usage:

```javascript
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        widgetsLocked={widgetsLocked}
        onAddTab={onAddTab}
        onDeleteTab={onDeleteTab}
        onToggleTheme={onToggleTheme}
        onToggleLock={onToggleLock}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
        theme={theme}
        themeMode={themeMode}
        screensaverCountdown={screensaverCountdown}
      />
```
No code change is required here for correctness (the sidebar already auto-collapses on every navigation action per Task 2's `setExpanded(false)` calls in `selectTab` and the utility-button `onClick`s, which covers opening Settings too) — this step is a verification note only, confirmed in Task 4's manual check rather than a code change. Skip to Step 5.

- [ ] **Step 5: Run the full client test suite**

Run: `cd client && npm test`
Expected: PASS, 578/578.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/AdminPanel.jsx client/src/components/AppShell.jsx client/src/app.jsx
git commit -m "feat(shell): fold Settings into the shell's content area, remove the modal"
```

---

## Task 4: Client-side last-tab guard, manual verification, release and deploy

**Files:**
- Modify: `client/src/app.jsx` (the delete-tab confirm/error copy and the post-delete active-tab fallback)

**Interfaces:**
- Consumes: Task 1's server behavior (dynamic merge target, last-tab refusal with a `400` and an `error` message body); Tasks 2-3's `AppShell`.
- Produces: nothing further — this is the plan's final task.

- [ ] **Step 1: Fix `handleDeleteTab`'s copy and post-delete fallback**

Find in `client/src/app.jsx`:
```javascript
  const handleDeleteTab = async (tabNumber) => {
    if (!window.confirm('Are you sure you want to delete this tab? Widgets will be moved to the Home tab.')) {
      return;
    }

    try {
      await axios.delete(`${API_DEVICE_URL}/tabs/${tabNumber}`);
      await fetchTabs();
      await fetchWidgetAssignments();

      if (activeTab === tabNumber) {
        setActiveTab(1);
      }
    } catch (error) {
      console.error('Error deleting tab:', error);
      alert('Failed to delete tab. Please try again.');
    }
  };
```
Replace with:
```javascript
  const handleDeleteTab = async (tabNumber) => {
    if (!window.confirm('Are you sure you want to delete this tab? Its widgets will be moved to another tab.')) {
      return;
    }

    try {
      const response = await axios.delete(`${API_DEVICE_URL}/tabs/${tabNumber}`);
      const updatedTabs = await fetchTabs();

      await fetchWidgetAssignments();

      if (activeTab === tabNumber) {
        // No tab is hardcoded as "the" fallback any more - land on whichever
        // tab is now lowest-numbered, mirroring the server's merge target.
        const lowestRemaining = Array.isArray(updatedTabs) && updatedTabs.length > 0
          ? Math.min(...updatedTabs.map((tab) => tab.number))
          : 1;
        setActiveTab(lowestRemaining);
      }
    } catch (error) {
      console.error('Error deleting tab:', error);
      alert(error.response?.data?.error || 'Failed to delete tab. Please try again.');
    }
  };
```

This assumes `fetchTabs()` returns the tabs it fetched (so `updatedTabs` can compute the new lowest number without a second request). Check `fetchTabs`'s current definition — if it does not return its result today, add a `return` of the fetched/set array to it as part of this step (find its definition, e.g. `const fetchTabs = useCallback(async () => { ... setTabs(response.data); }, [...]);`, and change the body to capture `const nextTabs = response.data; setTabs(nextTabs); return nextTabs;`, updating every existing call site's expectations is not required since adding a return value never breaks callers that ignore it).

- [ ] **Step 2: Run the full client test suite**

Run: `cd client && npm test`
Expected: PASS, 578/578.

- [ ] **Step 3: Start the dev server and client**

Run (background, two processes): `cd server && npm start` and `cd client && npm run dev`, same `.env` setup already in place from earlier work this session.

- [ ] **Step 4: Manual verification via Playwright**

Against the dev server (apply the established `window.process = { env: {} }` shim in the live page first if any drag/resize interaction trips react-grid-layout's dev-mode-only `process is not defined` crash — confirmed pre-existing and unrelated to this plan, see this session's prior ledger entries):

1. Confirm the sidebar renders collapsed (icon rail only) on first load, and expands on tap, with labels appearing.
2. Click each dashboard tab in the sidebar; confirm the active tab highlights and its widgets render; confirm the sidebar auto-collapses after the click.
3. Add a new tab via the sidebar's "Add new tab" entry; confirm it appears and is selectable.
4. Delete a non-Home tab; confirm the confirm dialog's new copy, and that its widgets (if any) reappear on the tab that's now lowest-numbered.
5. Delete the Home tab itself (tab 1); confirm it succeeds (no more "Cannot delete home tab" error), the remaining tab(s) renumber starting at 1, and - if the deleted tab had widgets - they appear on the new tab 1.
6. With only one tab left, confirm its delete button is hidden from the sidebar, and that calling the delete endpoint directly (e.g. via the browser devtools network tab replaying the request, or temporarily re-enabling the button via devtools) returns `400 Cannot delete your only tab` and that the `alert()` shown to the user now displays that exact message rather than the generic fallback.
7. Rename the Home tab via the tab-icon-edit flow; confirm it saves (no more "Cannot modify home tab" error).
8. Open Settings from the sidebar; confirm it renders inline in the content area (not a popup), the six top-level sections are reachable from the sidebar, and each section's existing content (e.g. Family → Users) still works exactly as before.
9. Select a widget on the dashboard (resize handles visible), then open the sidebar; confirm the widget stays selected and its `.react-grid-item` computed `width`/column count is unchanged while the sidebar is expanded over it (overlay, not push).
10. Resize the browser to the mobile breakpoint; confirm the sidebar's expanded state goes full-width and Settings remains reachable and usable.

- [ ] **Step 5: Stop the dev servers**

Confirm ports used by the dev client/server are no longer listening, same cleanup pattern as earlier tasks this session.

- [ ] **Step 6: Tag and push a release**

Same flow as this session's prior releases: `git push origin main`, `git tag -a vX.Y.Z -m "..."` (next version per this repo's own cadence - a minor bump, since this is a new feature, not a fix, following the precedent already recorded in this session's other ledgers), `git push origin vX.Y.Z`, watch the GitHub Actions build via `gh run list --repo tjstasulli/HomeGlow`, confirm both GHCR packages (`homeglow-backend`, `homeglow-frontend`) pull anonymously at the new tag (`ghcr.io/token` + manifest HTTP 200 checks).

- [ ] **Step 7: Deploy to WindowToTheStars and verify there**

Via `plink.exe` per `C:\Users\tjsta\IdeaProjects\ClaudePi\CLAUDE.md`: `cd /opt/homeglow && docker compose pull && docker compose up -d`, confirm both containers report `Up` and the frontend answers HTTP 200, then repeat a reasonable subset of Step 4's checks against `http://192.168.68.112:3000` (this production system currently has an empty Home tab with no widgets - the Home-tab-deletion and widget-merge checks specifically may not be repeatable there without first adding test data, matching this session's established ruling on that system; the sidebar collapse/expand/Settings-reachability checks are repeatable regardless of whether widgets exist).
