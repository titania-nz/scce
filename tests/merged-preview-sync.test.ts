import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMergedPreviewRanges, computeDiff, getMergedPreviewAnchorText } from '../src/lib/diffUtils.ts';

test('merged preview ranges track the active hunk output after hunk choices change', () => {
  const sourceA = ['Intro', 'Keep', 'A only', 'Shared tail', 'Done'].join('\n');
  const sourceB = ['Intro', 'Keep', 'B only', 'Shared tail', 'Done'].join('\n');
  const diff = computeDiff(sourceA, sourceB);

  assert.equal(diff.hunks.length, 1);

  const unresolvedRanges = buildMergedPreviewRanges(diff, {}, {});
  assert.deepEqual(unresolvedRanges[0], { startLine: 0, endLine: 4 });

  const mergedOutputTakeB = sourceB.split('\n');
  assert.equal(getMergedPreviewAnchorText(mergedOutputTakeB, unresolvedRanges[0]), 'Intro');

  const editedRanges = buildMergedPreviewRanges(diff, { 0: 'edited' }, { 0: 'Custom replacement' });
  assert.deepEqual(editedRanges[0], { startLine: 0, endLine: 0 });

  const mergedOutputEdited = ['Custom replacement'];
  assert.equal(getMergedPreviewAnchorText(mergedOutputEdited, editedRanges[0]), 'Custom replacement');
});

test('merged preview anchor skips blank lines inside an active range', () => {
  const lines = ['', '   ', '### Active Section', 'Body'];

  assert.equal(
    getMergedPreviewAnchorText(lines, { startLine: 0, endLine: 3 }),
    '### Active Section',
  );
  assert.equal(getMergedPreviewAnchorText(lines, undefined), null);
});
