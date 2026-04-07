import { diffLines } from 'diff';

export type DiffLineKind = 'added' | 'removed' | 'context';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  lineNumA: number | null;
  lineNumB: number | null;
}

export interface DiffHunk {
  id: number;
  start: number;
  end: number;
  lines: DiffLine[];
}

export interface ComputedDiff {
  hunks: DiffHunk[];
  flatLines: DiffLine[];
  totalAdditions: number;
  totalRemovals: number;
  isIdentical: boolean;
}

export interface PreparedDiff extends ComputedDiff {
  mergeHunks: DiffHunk[];
  stableMergedBContent: string;
}

export interface MergedPreviewRange {
  startLine: number;
  endLine: number;
}

const CONTEXT = 3;

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export function computeDiff(a: string, b: string): ComputedDiff {
  const changes = diffLines(a, b);

  // Flatten Change[] into DiffLine[], tracking line numbers for each side
  const flat: DiffLine[] = [];
  let lineNumA = 1;
  let lineNumB = 1;

  for (const change of changes) {
    const rawLines = change.value.split('\n');
    // diffLines always ends chunks with \n, so the last element is always an
    // empty string — drop it to avoid phantom blank lines.
    if (rawLines[rawLines.length - 1] === '') rawLines.pop();

    const kind: DiffLineKind = change.added ? 'added' : change.removed ? 'removed' : 'context';

    for (const text of rawLines) {
      flat.push({
        kind,
        text,
        lineNumA: kind === 'added' ? null : lineNumA,
        lineNumB: kind === 'removed' ? null : lineNumB,
      });
      if (kind !== 'added') lineNumA++;
      if (kind !== 'removed') lineNumB++;
    }
  }

  let totalAdditions = 0;
  let totalRemovals = 0;
  for (const line of flat) {
    if (line.kind === 'added') totalAdditions++;
    else if (line.kind === 'removed') totalRemovals++;
  }

  const isIdentical = totalAdditions === 0 && totalRemovals === 0;
  if (isIdentical) {
    return { hunks: [], flatLines: flat, totalAdditions: 0, totalRemovals: 0, isIdentical: true };
  }

  // Find indices of all changed lines
  const changedIndices: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].kind !== 'context') changedIndices.push(i);
  }

  // Build windows [start, end] (inclusive) around each cluster of changes
  // then merge overlapping/adjacent windows
  const windows: Array<[number, number]> = [];
  for (const idx of changedIndices) {
    const start = Math.max(0, idx - CONTEXT);
    const end = Math.min(flat.length - 1, idx + CONTEXT);
    if (windows.length > 0 && start <= windows[windows.length - 1][1] + 1) {
      windows[windows.length - 1][1] = Math.max(windows[windows.length - 1][1], end);
    } else {
      windows.push([start, end]);
    }
  }

  const hunks: DiffHunk[] = windows.map(([start, end], id) => ({
    id,
    start,
    end,
    lines: flat.slice(start, end + 1),
  }));

  return { hunks, flatLines: flat, totalAdditions, totalRemovals, isIdentical };
}

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export function buildPreparedDiff(a: string, b: string): PreparedDiff {
  const computed = computeDiff(a, b);

  // Build the stable B-wins merged content: skip A-only lines, keep B and context.
  const changes = diffLines(a, b);
  let stableMergedBContent = '';
  for (const change of changes) {
    if (change.removed) continue;
    stableMergedBContent += change.value;
  }

  return {
    ...computed,
    mergeHunks: computed.hunks,
    stableMergedBContent,
  };
}

export function buildMergedPreviewRanges(
  diff: ComputedDiff,
  mergeStateByHunk: Record<number, 'unresolved' | 'takeA' | 'takeB' | 'edited'>,
  editedContentByHunk: Record<number, string>,
): Record<number, MergedPreviewRange> {
  if (diff.isIdentical || diff.hunks.length === 0) return {};

  let sourceCursor = 0;
  let outputCursor = 0;
  const ranges: Record<number, MergedPreviewRange> = {};

  for (const hunk of diff.hunks) {
    outputCursor += Math.max(0, hunk.start - sourceCursor);
    sourceCursor = hunk.end + 1;

    const state = mergeStateByHunk[hunk.id] ?? 'unresolved';
    let lineCount = 0;

    if (state === 'edited') {
      const edited = editedContentByHunk[hunk.id] ?? '';
      lineCount = edited.length > 0 ? edited.split('\n').length : 0;
    } else {
      const takeB = state === 'takeB' || state === 'unresolved';
      lineCount = hunk.lines.filter((line) => (takeB ? line.kind !== 'removed' : line.kind !== 'added')).length;
    }

    ranges[hunk.id] = {
      startLine: outputCursor,
      endLine: Math.max(outputCursor, outputCursor + lineCount - 1),
    };
    outputCursor += lineCount;
  }

  return ranges;
}

export function getMergedPreviewAnchorText(
  lines: string[],
  range?: MergedPreviewRange,
): string | null {
  if (!range) return null;

  for (let index = range.startLine; index <= range.endLine; index++) {
    const line = lines[index]?.trim();
    if (line) return line;
  }

  return null;
}
