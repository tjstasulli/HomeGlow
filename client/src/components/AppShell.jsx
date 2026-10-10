import React from 'react';
import { Box } from '@mui/material';
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
  settingsOpen,
  settingsContent,
  adminSections,
  activeAdminTab,
  onSelectAdminTab,
  onBackToDashboard,
  children,
}) => {
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
        settingsOpen={settingsOpen}
        adminSections={adminSections}
        activeAdminTab={activeAdminTab}
        onSelectAdminTab={onSelectAdminTab}
        onBackToDashboard={onBackToDashboard}
      />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          // Reserve space for the collapsed rail only - the expanded state
          // overlays on top via its own position:fixed, it never resizes
          // this box. The rail renders at this width on every viewport
          // size, so the margin isn't conditioned on mobile either.
          ml: `${SIDEBAR_COLLAPSED_WIDTH}px`,
        }}
      >
        {settingsOpen ? settingsContent : children}
      </Box>
    </Box>
  );
};

export default AppShell;
