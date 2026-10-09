export const BASE_WIDGET_SETTINGS = {
  chores: { enabled: false },
  calendar: { enabled: false },
  photos: { enabled: false },
  weather: { enabled: false },
};

export const normalizeWidgetSettings = (raw, defaults = BASE_WIDGET_SETTINGS) => ({
  ...defaults,
  ...(raw && typeof raw === 'object' ? raw : {}),
  chores: { ...defaults.chores, ...(raw?.chores || {}) },
  calendar: { ...defaults.calendar, ...(raw?.calendar || {}) },
  photos: { ...defaults.photos, ...(raw?.photos || {}) },
  weather: { ...defaults.weather, ...(raw?.weather || {}) },
});

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
