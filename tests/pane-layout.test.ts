import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPaneWidth,
  clampSplitRatio,
  getPersistablePaneWidth,
  sanitizeStoredPaneWidth,
  sanitizeStoredSplitRatio,
} from '../src/lib/paneLayout.ts';

test('pane widths clamp to explicit bounds', () => {
  assert.equal(clampPaneWidth(100, { min: 240, max: 480 }), 240);
  assert.equal(clampPaneWidth(360, { min: 240, max: 480 }), 360);
  assert.equal(clampPaneWidth(600, { min: 240, max: 480 }), 480);
});

test('stored pane widths fall back when values are invalid', () => {
  assert.equal(sanitizeStoredPaneWidth(undefined, 320, { min: 240, max: 480 }), 320);
  assert.equal(sanitizeStoredPaneWidth(Number.NaN, 320, { min: 240, max: 480 }), 320);
  assert.equal(sanitizeStoredPaneWidth(1000, 320, { min: 240, max: 480 }), 480);
});

test('split ratios stay within a usable range', () => {
  assert.equal(sanitizeStoredSplitRatio(undefined, 0.5), 0.5);
  assert.equal(sanitizeStoredSplitRatio(0.05, 0.5), 0.2);
  assert.equal(sanitizeStoredSplitRatio(0.95, 0.5), 0.8);
  assert.equal(clampSplitRatio(0.1, 1800, 320), 320 / 1800);
  assert.equal(clampSplitRatio(0.9, 1800, 320), 1 - (320 / 1800));
});

test('closed panes do not persist collapsed widths', () => {
  assert.equal(getPersistablePaneWidth(false, 320, { min: 240, max: 480 }), null);
  assert.equal(getPersistablePaneWidth(true, 200, { min: 240, max: 480 }), 240);
});
