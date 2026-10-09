import { describe, expect, it } from 'vitest';
import {
  applyResizability,
  NORMALIZED_GRID_COLS,
  clampLayoutItem,
  layoutItemFromNormalized,
  layoutItemToNormalized,
  layoutToNormalized,
  scaleLayoutItem,
} from './gridLayout.js';

describe('clampLayoutItem', () => {
  it('caps width to the column count', () => {
    expect(clampLayoutItem({ x: 0, y: 0, w: 8, h: 5, minW: 2, minH: 2 }, 4)).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 5,
      minW: 2,
      minH: 2,
    });
  });

  it('shifts x left when the item would overflow', () => {
    expect(clampLayoutItem({ x: 2, y: 0, w: 3, h: 2, minW: 1, minH: 1 }, 4)).toEqual({
      x: 1,
      y: 0,
      w: 3,
      h: 2,
      minW: 1,
      minH: 1,
    });
  });
});

describe('scaleLayoutItem', () => {
  it('scales a half-width desktop widget to a usable mobile width', () => {
    // Calendar default: 32/48 ≈ two-thirds. On 4 cols → 3, so "+" can still grow to full width.
    const scaled = scaleLayoutItem(
      { x: 0, y: 0, w: 32, h: 5, minW: 2, minH: 2 },
      NORMALIZED_GRID_COLS,
      4
    );
    expect(scaled.w).toBe(3);
    expect(scaled.x).toBe(0);
    expect(scaled.x + scaled.w).toBeLessThan(4);
  });

  it('scales full-width desktop to full-width mobile', () => {
    const scaled = scaleLayoutItem(
      { x: 0, y: 0, w: 48, h: 5, minW: 2, minH: 2 },
      NORMALIZED_GRID_COLS,
      4
    );
    expect(scaled).toMatchObject({ x: 0, w: 4 });
  });

  it('scales mobile full-width back to desktop full-width', () => {
    const scaled = scaleLayoutItem(
      { x: 0, y: 0, w: 4, h: 5, minW: 2, minH: 2 },
      4,
      NORMALIZED_GRID_COLS
    );
    expect(scaled).toMatchObject({ x: 0, w: 48 });
  });

  it('never lets x+w exceed the grid width when rounding (issue: 8-col to 12-col overlap)', () => {
    // The reported bug: weather at tablet width (x=5, w=3 in 8 cols) saved back
    // as x=7.5→8 and w=4.5→5 = 13 columns, one into the calendar. Rounding the
    // left and right edges and deriving the width keeps x+w within the grid.
    const scaled = scaleLayoutItem(
      { x: 5, y: 0, w: 3, h: 5, minW: 2, minH: 2 },
      8,
      NORMALIZED_GRID_COLS
    );
    expect(scaled.x + scaled.w).toBeLessThanOrEqual(NORMALIZED_GRID_COLS);
  });

  it('keeps touching widgets touching after scaling', () => {
    // Two widgets that exactly tile the 8-col grid must still tile the 12-col
    // grid without overlap or gap.
    const left = scaleLayoutItem({ x: 0, y: 0, w: 5, h: 5, minW: 2, minH: 2 }, 8, 12);
    const right = scaleLayoutItem({ x: 5, y: 0, w: 3, h: 5, minW: 2, minH: 2 }, 8, 12);
    expect(left.x + left.w).toBe(right.x);
    expect(right.x + right.w).toBeLessThanOrEqual(12);
  });

  it('scales the minimum width with the columns', () => {
    // A 12-col minimum of 3 is a quarter of the grid; at 8 columns that is 2.
    // Left at 3, the clamp would widen a 2-wide widget into its neighbour.
    const down = scaleLayoutItem({ x: 4, y: 0, w: 4, h: 3, minW: 3, minH: 2 }, 12, 8);
    expect(down).toMatchObject({ x: 3, w: 2, minW: 2 });
    const up = scaleLayoutItem({ x: 3, y: 0, w: 2, h: 3, minW: 2, minH: 2 }, 8, 12);
    expect(up.minW).toBe(3);
  });
});

describe('normalized conversion', () => {
  it('round-trips through normalized units', () => {
    const mobile = { x: 0, y: 1, w: 3, h: 5, minW: 2, minH: 2 };
    const stored = layoutItemToNormalized(mobile, 4);
    const restored = layoutItemFromNormalized(stored, 4);
    expect(restored).toMatchObject({ x: 0, w: 3, h: 5 });
  });

  it('lets a non-full mobile widget grow after loading a desktop layout', () => {
    const fromDesktop = layoutItemFromNormalized(
      { x: 0, y: 0, w: 32, h: 5, minW: 2, minH: 2 },
      4
    );
    expect(fromDesktop.x + fromDesktop.w).toBeLessThan(4);
  });
});

describe('layoutToNormalized', () => {
  // Three 16-wide widgets across a 48-col row. On a 32-col tablet they show
  // as 0..10, 10..17 and 17..32; converted back one by one they would land
  // on different edges than they were stored at — every width changed by a
  // save that touched nothing.
  const stored = new Map([
    ['a', { x: 0, y: 0, w: 16, h: 3, minW: 2, minH: 2 }],
    ['b', { x: 16, y: 0, w: 16, h: 3, minW: 2, minH: 2 }],
    ['c', { x: 32, y: 0, w: 16, h: 3, minW: 2, minH: 2 }],
  ]);
  const liveAt = (cols, ids = [...stored.keys()]) =>
    ids.map((i) => ({ i, ...layoutItemFromNormalized(stored.get(i), cols) }));
  const edges = (items) => Object.fromEntries(items.map((item) => [item.i, [item.x, item.w, item.y, item.h]]));

  it('saves untouched widgets exactly as they were stored', () => {
    const live = liveAt(32);
    expect(edges(live)).toEqual({ a: [0, 11, 0, 3], b: [11, 10, 0, 3], c: [21, 11, 0, 3] });
    // What converting each widget on its own does.
    expect(layoutItemToNormalized(live[1], 32)).toMatchObject({ x: 17, w: 15 });

    expect(edges(layoutToNormalized(live, 32, stored))).toEqual({
      a: [0, 16, 0, 3], b: [16, 16, 0, 3], c: [32, 16, 0, 3],
    });
  });

  it('keeps the width of a widget that only changed height or row', () => {
    const live = liveAt(32).map((item) => {
      if (item.i === 'b') return { ...item, h: 5 };
      if (item.i === 'c') return { ...item, y: 4 };
      return item;
    });
    expect(edges(layoutToNormalized(live, 32, stored))).toEqual({
      a: [0, 16, 0, 3], b: [16, 16, 0, 5], c: [32, 16, 4, 3],
    });
  });

  it('stores a widget dragged against an untouched neighbour touching it, not overlapping', () => {
    // 'd' dropped flush against 'b' on the tablet, at its left edge (11).
    // Converted alone its right edge lands a column into 'b'.
    const live = [...liveAt(32, ['b', 'c']), { i: 'd', x: 5, y: 0, w: 6, h: 3, minW: 1, minH: 2 }];
    const dNormalizedAlone = layoutItemToNormalized(live[2], 32);
    expect(dNormalizedAlone.x + dNormalizedAlone.w).toBeGreaterThan(16);
    expect(edges(layoutToNormalized(live, 32, stored)).d).toEqual([8, 8, 0, 3]);

    // Flush against the right of 'a' (0..11): starts where 'a' ends, at 11.
    const rightOfA = [...liveAt(32, ['a']), { i: 'd', x: 11, y: 0, w: 6, h: 3, minW: 1, minH: 2 }];
    expect(edges(layoutToNormalized(rightOfA, 32, stored)).d).toEqual([16, 10, 0, 3]);
  });

  it('converts a widget with no stored layout as before', () => {
    const fresh = { i: 'new', x: 3, y: 6, w: 3, h: 2, minW: 1, minH: 2 };
    const [saved] = layoutToNormalized([fresh], 32, stored);
    expect(saved).toMatchObject(layoutItemToNormalized(fresh, 32));
  });

  it('saves a 48-col layout as it is', () => {
    const live = [{ i: 'a', x: 4, y: 0, w: 20, h: 3, minW: 2, minH: 2 }, ...liveAt(48, ['b', 'c'])];
    expect(edges(layoutToNormalized(live, 48, stored))).toEqual({
      a: [4, 20, 0, 3], b: [16, 16, 0, 3], c: [32, 16, 0, 3],
    });
  });

  it('turning a phone between 16 and 32 columns loses nothing', () => {
    const portrait = liveAt(16);
    const throughStored = layoutToNormalized(portrait, 16, stored)
      .map((item) => layoutItemFromNormalized(item, 32));
    expect(edges(throughStored)).toEqual(edges(liveAt(32)));
    // Column to column re-rounds through the coarse grid.
    const rescaled = scaleLayoutItem(portrait[1], 16, 32);
    expect(rescaled.x + rescaled.w).toBeLessThanOrEqual(32);
  });
});

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
