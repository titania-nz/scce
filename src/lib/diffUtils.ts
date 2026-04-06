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
