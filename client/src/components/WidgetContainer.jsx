import React, { Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Box, IconButton } from '@mui/material';
import GridLayout, { getCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import axios from 'axios';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { getDeviceApiBase } from '../utils/deviceName.js';
import {
  applyResizability,
  clampLayoutItem,
  layoutItemFromNormalized,
  layoutToNormalized,
  scaleLayoutItem,
} from '../utils/gridLayout.js';
import CountdownCircle from './CountdownCircle';
import { shouldAcceptLayoutChange } from '../utils/layoutSync';
import { buildLayout, savedSourcesById } from '../utils/gridPlacement';
import { readGridMetrics } from '../utils/gridMetrics';
import { frameDecoration } from '../utils/widgetFrame';
import FrameOrnaments from './FrameOrnaments';
import ThemeAmbience from '../themes/engine/ThemeAmbience.jsx';

// No auto-compaction; block overlaps (same as compactType={null} + preventCollision).
const GRID_COMPACTOR = getCompactor(null, false, true);

const CORE_WIDGET_ID_TO_NAME = {
  'calendar-widget': 'calendar',
  'chores-widget': 'chores',
  'photos-widget': 'photos',
  'weather-widget': 'weather',
};

const resolveWidgetName = (widgetId) => {
  if (CORE_WIDGET_ID_TO_NAME[widgetId]) return CORE_WIDGET_ID_TO_NAME[widgetId];
  if (widgetId.startsWith('plugin-')) return `plugin:${widgetId.slice(7)}`;
  return null;
};

// Core widgets arrive Suspense-wrapped (they're lazy-loaded). Props cloned
// onto a Suspense boundary are silently dropped, so inject them into the
// widget element itself.
const injectWidgetProps = (element, props) => {
  if (React.isValidElement(element) && element.type === Suspense) {
    return React.cloneElement(element, {}, React.cloneElement(element.props.children, props));
  }
  return React.cloneElement(element, props);
};

const WidgetContainer = ({
  children,
  widgets = [],
  locked = true,
  onLayoutChange: onLayoutChangeCallback,
  activeTab = 1,
  activeTabId = 1,
  deviceWidgetSettings = {},
  devicePluginSettings = {},
  isActive = true,
}) => {
  const API_DEVICE_URL = getDeviceApiBase(API_BASE_URL);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [gridCols, setGridCols] = useState(12);
  // The theme's gap between widgets, read once from --hg-grid-gap.
  const [gridMetrics] = useState(readGridMetrics);
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [layout, setLayout] = useState([]);
  const [isLockTransitioning, setIsLockTransitioning] = useState(false);
  const [refreshKeys, setRefreshKeys] = useState({});
  const containerRef = useRef(null);
  const prevWidgetIdsRef = useRef('');
  const prevGridColsRef = useRef(null);
  const lockedRef = useRef(locked);
  const prevLockedRef = useRef(locked);
  const hasInitializedLockEffectRef = useRef(false);
  const saveTimerRef = useRef(null);
  // Which tab the current `layout` state was built for. Null until the first
  // rebuild lands. Guards against saving a layout mid tab change — see
  // shouldAcceptLayoutChange.
  const layoutTabRef = useRef(null);
  // The widgets of the latest render, whose savedLayout describes the active
  // tab. Read when a save is requested, not when the debounced save fires.
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const saveLayoutsToApi = useCallback((layoutItems, tabNumber, cols) => {
    // Every widget is saved, but against what it was loaded from: one nobody
    // moved keeps its stored 12-col values exactly instead of being re-rounded
    // through the live column count (see layoutToNormalized).
    const savedSources = savedSourcesById(widgetsRef.current);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Persist in normalized (12-col) units so layouts round-trip across breakpoints.
      const layouts = layoutToNormalized(layoutItems, cols, savedSources)
        .filter(stored => resolveWidgetName(stored.i))
        .map(stored => ({
          widget_name: resolveWidgetName(stored.i),
          tabNumber: tabNumber,
          layout_x: stored.x,
          layout_y: stored.y,
          layout_w: stored.w,
          layout_h: stored.h,
        }));

      if (layouts.length > 0) {
        axios.patch(`${API_DEVICE_URL}/widget-assignments/layout/bulk`, { layouts }).catch(() => { });
      }
    }, 500);
  }, []);

  // Update container width and grid columns based on screen size
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const computed = window.getComputedStyle(containerRef.current);
        const paddingLeft = parseFloat(computed.paddingLeft) || 0;
        const paddingRight = parseFloat(computed.paddingRight) || 0;
        const width = Math.max(0, containerRef.current.clientWidth - paddingLeft - paddingRight);
        setContainerWidth(width);

        // Responsive grid columns
        if (width < 600) {
          setGridCols(16); // Mobile: 16 columns
        } else if (width < 960) {
          setGridCols(32); // Tablet: 32 columns
        } else {
          setGridCols(48); // Desktop: 48 columns
        }
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    const currentCacheKey = `${activeTab}:${widgets.map(w => w.id).sort().join(',')}`;
    const widgetsChanged = currentCacheKey !== prevWidgetIdsRef.current;
    const prevCols = prevGridColsRef.current;
    const colsChanged = prevCols != null && prevCols !== gridCols;

    // First paint / widget-set changes rebuild from saved (12-col) layouts.
    // Column-only changes rescale the live layout so resize affordances stay correct.
    if (!widgetsChanged && !colsChanged) {
      prevGridColsRef.current = gridCols;
      return;
    }

    if (widgetsChanged) {
      prevWidgetIdsRef.current = currentCacheKey;

      const initialLayout = buildLayout(widgets, gridCols, lockedRef.current);
      setLayout(initialLayout);
      layoutTabRef.current = activeTab;
    } else if (colsChanged) {
      setLayout((currentLayout) => {
        // Through the stored 12-col values rather than column to column: a
        // phone turning between 4 and 8 columns would otherwise re-round every
        // widget through the coarse grid, and the next save would keep it.
        const stored = layoutToNormalized(currentLayout, prevCols, savedSourcesById(widgets));
        const nextLayout = currentLayout.map((item, index) => {
          const scaled = scaleLayoutItem(item, prevCols, gridCols);
          const { x, w } = layoutItemFromNormalized(stored[index], gridCols);
          return {
            ...clampLayoutItem({ ...scaled, x, w }, gridCols),
            static: lockedRef.current,
          };
        });
        return nextLayout;
      });
      layoutTabRef.current = activeTab;
    }

    prevGridColsRef.current = gridCols;
  }, [widgets, activeTab, gridCols]);

  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = locked;

    setIsLockTransitioning(true);

    setLayout((currentLayout) => {
      const updatedLayout = currentLayout.map(item => ({
        ...item,
        static: locked
      }));

      // Same invariant as handleLayoutChange: only persist when the layout state
      // and the active tab agree. Locking mid tab change would otherwise write
      // the previous tab's arrangement under the new tab's number by this path
      // instead.
      const shouldPersistLockedLayouts = hasInitializedLockEffectRef.current
        && !wasLocked
        && locked
        && layoutTabRef.current === activeTab;
      if (shouldPersistLockedLayouts) {
        saveLayoutsToApi(updatedLayout, activeTab, gridCols);
      }

      return updatedLayout;
    });

    if (!hasInitializedLockEffectRef.current) {
      hasInitializedLockEffectRef.current = true;
    }

    const timer = setTimeout(() => {
      setIsLockTransitioning(false);
    }, 50);

    return () => clearTimeout(timer);
  }, [locked, saveLayoutsToApi, activeTab]);

  // Deselect widget when locked
  useEffect(() => {
    if (locked) {
      setSelectedWidget(null);
    }
  }, [locked]);

  const handleLayoutChange = (newLayout) => {
    // Not just `locked`: the grid also emits during a tab change, before the
    // rebuild for the new tab has landed. Saving then writes the previous tab's
    // arrangement under the new tab's number.
    if (!shouldAcceptLayoutChange({
      locked,
      layoutTab: layoutTabRef.current,
      activeTab,
    })) {
      return;
    }

    const currentLayoutById = new Map(layout.map(item => [item.i, item]));
    const safeLayout = newLayout.map((item) => {
      const existing = currentLayoutById.get(item.i);
      const minW = existing?.minW ?? item.minW ?? 2;
      const minH = existing?.minH ?? item.minH ?? 2;
      return {
        ...item,
        minW,
        minH,
        w: Math.max(item.w, minW),
        h: Math.max(item.h, minH),
      };
    });

    const hasChanged = safeLayout.some(item => {
      const existing = currentLayoutById.get(item.i);
      if (!existing) return true;
      return existing.x !== item.x || existing.y !== item.y || existing.w !== item.w || existing.h !== item.h;
    });

    if (!hasChanged) return;

    const updatedLayout = safeLayout.map(item => ({
      ...item,
      static: locked
    }));

    setLayout(updatedLayout);

    saveLayoutsToApi(updatedLayout, activeTab, gridCols);

    if (onLayoutChangeCallback) {
      onLayoutChangeCallback(updatedLayout);
    }
  };

  const handleWidgetClick = (widgetId, e) => {
    if (locked) return;
    if (e.target.closest('.drag-handle')) return;
    if (e.target.closest('.react-resizable-handle')) return;
    e.stopPropagation();
    setSelectedWidget(widgetId);
  };

  const handleWidgetTouch = (widgetId, e) => {
    if (locked) return;
    if (e.target.closest('.drag-handle')) return;
    if (e.target.closest('.react-resizable-handle')) return;
    e.stopPropagation();
    setSelectedWidget(widgetId);
  };

  const isInteractiveTarget = (target) => {
    if (!target?.closest) return false;
    return Boolean(
      target.closest(
        'button, a, input, textarea, select, [role="button"], [contenteditable="true"], .MuiButtonBase-root, .MuiInputBase-root, .MuiSwitch-root, .MuiToggleButton-root'
      )
    );
  };

  // Click/Touch outside to deselect
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.widget-wrapper')) {
        if (selectedWidget) {
          setSelectedWidget(null);
        }
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [selectedWidget]);

  // Safety net: if selection state and rendered controls drift out of sync, clear selection.
  useEffect(() => {
    if (locked || !selectedWidget) return;

    const rafId = window.requestAnimationFrame(() => {
      const selectedElement = containerRef.current?.querySelector('.widget-wrapper.selected');
      if (!selectedElement) {
        setSelectedWidget(null);
        return;
      }

      const hasResizeControls = selectedElement.querySelector('.react-resizable-handle');
      if (!hasResizeControls) {
        setSelectedWidget(null);
      }
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [locked, selectedWidget, layout]);

  const getWidgetRefreshInterval = (widgetId) => {
    const widgetMap = {
      'chores-widget': 'chores',
      'calendar-widget': 'calendar',
      'photos-widget': 'photos',
      'weather-widget': 'weather',
    };

    const settingsKey = widgetMap[widgetId];
    if (settingsKey && deviceWidgetSettings[settingsKey]) {
      return deviceWidgetSettings[settingsKey].refreshInterval || 0;
    }

    if (widgetId.startsWith('plugin-')) {
      const filename = widgetId.slice(7);
      return devicePluginSettings[filename]?.refreshInterval || 0;
    }

    return 0;
  };

  // Bumping the nonce tells the widget to refetch in place. It must NOT be
  // used as a React key — that force-remounts the widget, re-running its
  // mount fetch and restarting its timers (the churn bug in issue #75).
  const handleWidgetRefresh = useCallback((widgetId) => {
    setRefreshKeys(prev => ({
      ...prev,
      [widgetId]: (prev[widgetId] || 0) + 1
    }));
  }, []);

  // The layout handed to the grid must describe exactly the children being
  // rendered — one entry each, no more.
  //
  // `layout` state is rebuilt by an effect, so during a tab change it still
  // describes the previous tab while the children are already the new tab's.
  // Passing it raw gives the grid entries whose `i` matches no child, and
  // children with no entry; it then synthesizes placements and, with
  // preventCollision, shuffles non-static items around until they fit. That is
  // the visible scramble, and it only appears unlocked because static items are
  // pinned and excluded from collision movement.
  //
  // Deriving it per render closes the window: the grid never sees one tab's
  // items alongside another tab's children.
  // The layout handed to the grid must describe exactly the children being
  // rendered. `layout` state is rebuilt by an effect, so during a tab change it
  // still describes the previous tab — passing it raw gives the grid entries
  // matching no child and children with no entry, and it shuffles non-static
  // items around hunting for a fit. That is the visible scramble, and it only
  // appears unlocked because static items are pinned.
  //
  // Built from `widgets`, whose savedLayout is already scoped to the active tab,
  // so it is correct even mid-transition. Once the rebuild has landed for this
  // tab, live state wins so a drag in progress is not thrown away.
  const gridLayout = useMemo(() => {
    const built = buildLayout(widgets, gridCols, locked);
    const reconciled = layoutTabRef.current !== activeTab
      ? built
      : built.map((item) => layout.find((l) => l.i === item.i) || item);
    return applyResizability(reconciled, selectedWidget, locked);
  }, [widgets, layout, gridCols, locked, activeTab, selectedWidget]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        minHeight: '100vh',
        padding: 2,
        position: 'relative',
        backgroundColor: 'var(--background)',
        // A theme's page image (Classic: none), pinned like the body's.
        backgroundImage: 'var(--hg-page-image)',
        backgroundSize: 'var(--hg-page-image-size)',
        backgroundPosition: 'var(--hg-page-image-position)',
        backgroundAttachment: 'fixed',
        '& .react-grid-item': {
          transition: (selectedWidget || isLockTransitioning) ? 'none !important' : 'all 200ms ease',
          transitionProperty: 'left, top, width, height',
        },
        '& .react-grid-item.cssTransforms': {
          transitionProperty: (selectedWidget || isLockTransitioning) ? 'none !important' : 'transform, width, height',
        },
        '& .react-grid-item.react-grid-placeholder': {
          background: 'var(--accent)',
          opacity: 0.2,
          borderRadius: 'var(--hg-radius-md)',
          zIndex: 2,
          transition: 'all 100ms ease',
        },
        '& .react-resizable-handle': {
          zIndex: 1004,
        },
      }}
    >
      <ThemeAmbience />
      {layout.length > 0 && (
        <GridLayout
          className="layout"
          width={containerWidth}
          layout={gridLayout}
          gridConfig={{
            cols: gridCols,
            rowHeight: gridMetrics.rowHeight,
            margin: [gridMetrics.gap, gridMetrics.gap],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: !locked,
            handle: '.drag-handle',
            cancel: '.widget-content',
          }}
          resizeConfig={{ enabled: true, handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] }}
          compactor={GRID_COMPACTOR}
          onLayoutChange={handleLayoutChange}
        >
          {widgets.map((widget) => {
            const isSelected = !locked && selectedWidget === widget.id;
            const currentLayout = layout.find(l => l.i === widget.id);
            const fallbackLayout = {
              i: widget.id,
              ...layoutItemFromNormalized(
                {
                  x: widget.defaultPosition.x,
                  y: widget.defaultPosition.y,
                  w: widget.defaultSize.width,
                  h: widget.defaultSize.height,
                  minW: widget.minWidth || 3,
                  minH: widget.minHeight || 2,
                },
                gridCols
              ),
              static: locked,
            };
            const effectiveLayout = currentLayout || fallbackLayout;
            return (
              <Box
                key={widget.id}
                className={`widget-wrapper ${isSelected ? 'selected' : ''}`}
                onPointerDownCapture={(e) => {
                  if (!locked && !isSelected && !e.target.closest('.drag-handle') && !e.target.closest('.react-resizable-handle')) {
                    if (isInteractiveTarget(e.target)) {
                      // Select on interactive taps too so edit affordances (drag/resize) remain reachable.
                      setSelectedWidget(widget.id);
                      return;
                    }

                    e.stopPropagation();
                    handleWidgetTouch(widget.id, e);
                  }
                }}
                sx={{
                  width: '100%',
                  height: '100%',
                  position: 'relative',
                  border: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                  borderRadius: 'var(--hg-frame-radius)',
                  padding: 'var(--hg-frame-inset)',
                  backdropFilter: 'var(--hg-frame-backdrop)',
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  boxShadow: isSelected
                    ? '0 8px 32px rgba(var(--accent-rgb), 0.3)'
                    : 'var(--hg-frame-shadow)',
                  background: 'var(--hg-frame-bg)',
                  backgroundImage: 'var(--hg-frame-image)',
                  opacity: (widget.opacity ?? 100) / 100,
                  overflow: 'hidden',
                  cursor: locked ? 'default' : (isSelected ? 'move' : 'pointer'),
                  touchAction: locked ? 'auto' : (isSelected ? 'none' : 'manipulation'),
                  '@media (hover: hover) and (pointer: fine)': {
                    '&:hover': {
                      border: locked
                        ? '3px solid transparent'
                        : (isSelected
                          ? '3px solid var(--accent)'
                          : '3px solid rgba(var(--accent-rgb), 0.3)'),
                      boxShadow: locked
                        ? 'var(--hg-frame-shadow)'
                        : (isSelected
                          ? '0 8px 32px rgba(var(--accent-rgb), 0.3)'
                          : 'var(--hg-frame-shadow-hover)'),
                    }
                  },
                  '&::after': frameDecoration,
                }}
              >
                <FrameOrnaments />
                {!locked && !isSelected && (
                  <Box
                    className="selection-overlay"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedWidget(widget.id);
                    }}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      cursor: 'pointer',
                      zIndex: 1000,
                      pointerEvents: 'auto',
                      touchAction: 'manipulation',
                      userSelect: 'none',
                    }}
                  />
                )}

                {isSelected && !locked && (
                  <>
                    {/* Invisible Drag Handle - Covers entire widget when selected and unlocked */}
                    <Box
                      className="drag-handle"
                      sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        cursor: 'move',
                        zIndex: 1001,
                        userSelect: 'none',
                        pointerEvents: locked ? 'none' : 'auto',
                      }}
                    />

                  </>
                )}

                {/* Countdown ring: the per-widget refresh scheduler. Paused
                    (no ticking, no refreshes) while the screen is inactive;
                    fires an immediate catch-up refresh on resume if overdue. */}
                <CountdownCircle
                  refreshInterval={getWidgetRefreshInterval(widget.id)}
                  onRefresh={() => handleWidgetRefresh(widget.id)}
                  isActive={isActive}
                />

                {/* Widget Content */}
                <Box
                  className="widget-content"
                  sx={{
                    width: '100%',
                    height: '100%',
                    overflow: 'auto',
                    pointerEvents: (locked || !isSelected) ? 'auto' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {injectWidgetProps(widget.content, {
                    widgetId: widget.id,
                    refreshNonce: refreshKeys[widget.id] || 0,
                    isActive,
                    activeTabId,
                    widgetSize: {
                      width: effectiveLayout.w,
                      height: effectiveLayout.h,
                    },
                  })}
                </Box>
              </Box>
            );
          })}
        </GridLayout>
      )}
      {children}
    </Box>
  );
};

export default WidgetContainer;
