import { describe, it, expect } from 'vitest';
import { normalizeWidgetSettings, BASE_WIDGET_SETTINGS, resolveWidgetOpacity } from './widgetSettings.js';

describe('normalizeWidgetSettings', () => {
  it('returns base defaults for null/undefined/non-object input', () => {
    expect(normalizeWidgetSettings(null)).toEqual(BASE_WIDGET_SETTINGS);
    expect(normalizeWidgetSettings(undefined)).toEqual(BASE_WIDGET_SETTINGS);
    expect(normalizeWidgetSettings('nonsense')).toEqual(BASE_WIDGET_SETTINGS);
    expect(normalizeWidgetSettings(42)).toEqual(BASE_WIDGET_SETTINGS);
  });

  it('deep-merges per-widget settings over defaults', () => {
    const result = normalizeWidgetSettings({ chores: { enabled: true } });
    expect(result.chores).toEqual({ enabled: true });
    expect(result.calendar).toEqual({ enabled: false });
  });

  it('preserves extra per-widget keys the defaults do not know about', () => {
    const result = normalizeWidgetSettings({ weather: { refreshInterval: 300 } });
    expect(result.weather).toEqual({ enabled: false, refreshInterval: 300 });
  });

  it('passes unknown top-level keys through from raw input', () => {
    const result = normalizeWidgetSettings({ legacyKey: '#123456' });
    expect(result.legacyKey).toBe('#123456');
  });

  it('applies caller-supplied defaults for keys missing from raw input', () => {
    // Pins the app.jsx gradient regression: callers with extra top-level
    // defaults (gradient colors) must get them back when raw lacks them.
    const defaults = {
      ...BASE_WIDGET_SETTINGS,
      lightGradientStart: '#00ddeb',
      lightGradientEnd: '#ff6b6b',
    };

    const fromEmpty = normalizeWidgetSettings(undefined, defaults);
    expect(fromEmpty.lightGradientStart).toBe('#00ddeb');
    expect(fromEmpty.lightGradientEnd).toBe('#ff6b6b');

    const fromPartial = normalizeWidgetSettings({ lightGradientStart: '#111111' }, defaults);
    expect(fromPartial.lightGradientStart).toBe('#111111');
    expect(fromPartial.lightGradientEnd).toBe('#ff6b6b');
  });

  it('merges per-widget defaults from caller-supplied defaults', () => {
    const defaults = {
      chores: { enabled: false, refreshInterval: 0 },
      calendar: { enabled: false, refreshInterval: 0 },
      photos: { enabled: false, refreshInterval: 0 },
      weather: { enabled: false, refreshInterval: 0 },
    };

    const result = normalizeWidgetSettings({ chores: { enabled: true } }, defaults);
    expect(result.chores).toEqual({ enabled: true, refreshInterval: 0 });
    expect(result.photos).toEqual({ enabled: false, refreshInterval: 0 });
  });
});

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
