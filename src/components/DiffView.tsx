'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { diffLines, Change } from 'diff';
import { DiffLine, DiffHunk, buildPreparedDiff } from '@/lib/diffUtils';
import { domId, domIdSuffix } from '@/lib/domId';

export type HunkMergeState = 'unresolved' | 'takeA' | 'takeB' | 'edited';

interface DiffViewProps {
  contentA: string;
  contentB: string;
  filenameA: string;
  filenameB: string;
  activeHunkId?: number | null;
  mergeStateByHunk?: Record<number, HunkMergeState>;
  editedContentByHunk?: Record<number, string>;
  onTakeA?: (hunkId: number) => void;
  onTakeB?: (hunkId: number) => void;
  onEditHunk?: (hunkId: number) => void;
  onEditedContentChange?: (hunkId: number, value: string) => void;
  onActiveHunkChange?: (hunkId: number | null) => void;
  actionLabel?: string;
  actionHint?: string;
  actionDisabled?: boolean;
  onAction?: () => void | Promise<void>;
  onMergeStateChange?: (state: { mergedContent: string; unresolvedCount: number }) => void;
}

function DiffLineRow({ line, hunkId, lineIndex }: { line: DiffLine; hunkId: number; lineIndex: number }) {
  const lineNumClass = 'w-10 shrink-0 text-right select-none text-gray-600 tabular-nums';

  let rowClass = 'flex min-w-0 font-mono text-xs leading-5';
  let prefixClass = 'w-5 shrink-0 text-center select-none';
  let prefix = ' ';

  if (line.kind === 'added') {
    rowClass += ' bg-green-950';
    prefixClass += ' text-green-400';
    prefix = '+';
  } else if (line.kind === 'removed') {
    rowClass += ' bg-red-950';
    prefixClass += ' text-red-400';
    prefix = '-';
  }

  return (
    <div id={domId('diff-view-div-001', hunkId, lineIndex)} className={rowClass}>
      <span className={`${lineNumClass} pr-1`}>{line.lineNumA ?? ''}</span>
      <span className={`${lineNumClass} pr-2`}>{line.lineNumB ?? ''}</span>
      <span className={prefixClass}>{prefix}</span>
      <span className="flex-1 pl-2 whitespace-pre-wrap break-all text-gray-200 min-w-0">{line.text || '\u00a0'}</span>
    </div>
  );
}

function HunkBlock({
  hunk,
  total,
  isActive,
  mergeState = 'unresolved',
  editedContent = '',
  onTakeA,
  onTakeB,
  onEditHunk,
  onEditedContentChange,
  hunkRef,
  onActivate,
}: {
  hunk: DiffHunk;
  total: number;
  isActive: boolean;
  mergeState?: HunkMergeState;
  editedContent?: string;
  onTakeA?: (hunkId: number) => void;
  onTakeB?: (hunkId: number) => void;
  onEditHunk?: (hunkId: number) => void;
  onEditedContentChange?: (hunkId: number, value: string) => void;
  hunkRef: (el: HTMLDivElement | null) => void;
  onActivate?: (hunkId: number) => void;
}) {
  const isResolved = mergeState !== 'unresolved';
  const hunkIdSuffix = domIdSuffix(hunk.id, hunk.id);

  return (
    <div id={domId('diff-view-div-002', hunkIdSuffix)} ref={hunkRef} className="min-w-0" onClick={() => onActivate?.(hunk.id)}>
      <div id={domId('diff-view-div-003', hunkIdSuffix)}
        className={`flex items-center px-3 py-0.5 text-xs font-mono text-gray-500 bg-gray-900 border-y border-gray-700 ${isActive ? 'border-l-2 border-l-blue-500' : ''}`}
      >
        <span>
          @@ hunk {hunk.id + 1} of {total} @@
        </span>
        <span
          className={`ml-3 rounded px-2 py-0.5 text-[11px] ${isResolved ? 'bg-green-950 text-green-300' : 'bg-yellow-950 text-yellow-300'}`}
        >
          {isResolved ? 'Resolved' : 'Unresolved'}
        </span>
        <div id={domId('diff-view-div-004', hunkIdSuffix)} className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onTakeA?.(hunk.id)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${mergeState === 'takeA' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            title="Use A-side changes for this hunk"
          >
            Take A
          </button>
          <button
            onClick={() => onTakeB?.(hunk.id)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${mergeState === 'takeB' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            title="Use B-side changes for this hunk"
          >
            Take B
          </button>
          <button
            onClick={() => onEditHunk?.(hunk.id)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${mergeState === 'edited' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            title="Edit merged content for this hunk"
          >
            Edit merged result
          </button>
        </div>
      </div>
      {hunk.lines.map((line, i) => (
        <DiffLineRow key={i} line={line} hunkId={hunk.id} lineIndex={i} />
      ))}
      {mergeState === 'edited' && (
        <div id={domId('diff-view-div-005', hunkIdSuffix)} className="border-b border-gray-700 bg-gray-900 px-3 py-2">
          <label className="mb-1 block text-[11px] font-medium text-gray-400">Edited merged content for this hunk</label>
          <textarea
            className="h-24 w-full resize-y rounded border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
            value={editedContent}
            onChange={(e) => onEditedContentChange?.(hunk.id, e.target.value)}
            placeholder="Enter merged content for this hunk..."
          />
        </div>
      )}
    </div>
  );
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function DiffView({
  contentA,
  contentB,
  filenameA,
  filenameB,
  activeHunkId,
  mergeStateByHunk,
  editedContentByHunk,
  onTakeA,
  onTakeB,
  onEditHunk,
  onEditedContentChange,
  onActiveHunkChange,
  actionLabel,
  actionHint,
  actionDisabled = false,
  onAction,
  onMergeStateChange,
}: DiffViewProps) {
  const diff = useMemo(() => buildPreparedDiff(contentA, contentB), [contentA, contentB]);
  const [internalActiveHunkId, setInternalActiveHunkId] = useState<number | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, 'a' | 'b'>>({});
  const hunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const { hunks, mergeHunks, totalAdditions, totalRemovals, isIdentical } = diff;
  const isControlledActiveHunk = activeHunkId !== undefined;
  const resolvedActiveHunkId = isControlledActiveHunk ? (activeHunkId ?? null) : internalActiveHunkId;
  const activeIdx = useMemo(() => {
    if (isIdentical || hunks.length === 0) return -1;
    if (typeof resolvedActiveHunkId === 'number') {
      const nextIdx = hunks.findIndex((hunk) => hunk.id === resolvedActiveHunkId);
      if (nextIdx >= 0) return nextIdx;
    }
    return 0;
  }, [hunks, isIdentical, resolvedActiveHunkId]);

  useEffect(() => {
    setInternalActiveHunkId(null);
    setResolutions({});
  }, [contentA, contentB]);

  useEffect(() => {
    if (isIdentical || hunks.length === 0) {
      if (isControlledActiveHunk) {
        onActiveHunkChange?.(null);
      } else {
        setInternalActiveHunkId(null);
      }
      return;
    }

    if (typeof resolvedActiveHunkId === 'number' && hunks.some((hunk) => hunk.id === resolvedActiveHunkId)) {
      return;
    }

    const firstHunkId = hunks[0]?.id ?? null;
    if (isControlledActiveHunk) {
      onActiveHunkChange?.(firstHunkId);
    } else {
      setInternalActiveHunkId(firstHunkId);
    }
  }, [hunks, isControlledActiveHunk, isIdentical, onActiveHunkChange, resolvedActiveHunkId]);

  const setActiveHunk = useCallback(
    (hunkId: number | null) => {
      if (isControlledActiveHunk) {
        onActiveHunkChange?.(hunkId);
      } else {
        setInternalActiveHunkId(hunkId);
        onActiveHunkChange?.(hunkId);
      }
    },
    [isControlledActiveHunk, onActiveHunkChange],
  );

  const setHunkRef = useCallback(
    (id: number) => (el: HTMLDivElement | null) => {
      if (el) hunkRefs.current.set(id, el);
      else hunkRefs.current.delete(id);
    },
    [],
  );

  function navigateTo(idx: number) {
    const targetHunk = hunks[idx];
    if (!targetHunk) return;
    setActiveHunk(targetHunk.id);
    hunkRefs.current.get(targetHunk.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    if (isIdentical || hunks.length === 0) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName;
        if (target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        navigateTo(Math.max(0, activeIdx - 1));
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        navigateTo(Math.min(hunks.length - 1, activeIdx + 1));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIdx, hunks.length, isIdentical]);

  const mergedContentFromResolutions = useMemo(() => {
    const chunks = diffLines(contentA, contentB);
    let mergeHunkIdx = 0;
    let idx = 0;
    let result = '';

    while (idx < chunks.length) {
      const chunk = chunks[idx];
      if (!chunk.added && !chunk.removed) {
        result += chunk.value;
        idx++;
        continue;
      }

      const group: Change[] = [];
      while (idx < chunks.length && (chunks[idx].added || chunks[idx].removed)) {
        group.push(chunks[idx]);
        idx++;
      }

      const fallbackB = group.filter((entry) => !!entry.added).map((entry) => entry.value).join('');
      const fallbackA = group.filter((entry) => !!entry.removed).map((entry) => entry.value).join('');
      const resolution = resolutions[mergeHunkIdx];

      if (resolution === 'a') result += fallbackA;
      else if (resolution === 'b') result += fallbackB;
      else result += fallbackB;

      mergeHunkIdx++;
    }

    return result;
  }, [contentA, contentB, resolutions]);

  const unresolvedCount = mergeHunks.length - Object.keys(resolutions).length;

  useEffect(() => {
    if (!onMergeStateChange) return;
    if (isIdentical) {
      onMergeStateChange({ mergedContent: contentA, unresolvedCount: 0 });
      return;
    }

    const fallback = diff.stableMergedBContent;
    const resolvedMergedContent = unresolvedCount === 0 ? mergedContentFromResolutions : fallback;
    onMergeStateChange({ mergedContent: resolvedMergedContent, unresolvedCount });
  }, [
    contentA,
    diff.stableMergedBContent,
    isIdentical,
    mergedContentFromResolutions,
    onMergeStateChange,
    unresolvedCount,
  ]);

  return (
    <div id="diff-view-div-006" className="flex-1 min-w-0 flex flex-col overflow-hidden bg-gray-950">
      <div id="diff-view-div-007" className="shrink-0 flex min-w-0 items-center gap-3 px-3 h-10 bg-gray-900 border-b border-gray-700 text-xs sticky top-0 z-10">
        <span className="text-green-400 font-mono">+{totalAdditions}</span>
        <span className="text-red-400 font-mono">-{totalRemovals}</span>

        <span className="text-gray-500 truncate flex-1 min-w-0">
          <span className="text-gray-300">{filenameA}</span>
          <span className="mx-1">vs</span>
          <span className="text-gray-300">{filenameB}</span>
        </span>

        {!isIdentical && hunks.length > 0 && (
          <div id="diff-view-div-008" className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => navigateTo(Math.max(0, activeIdx - 1))}
              disabled={activeIdx === 0}
              className="px-2 py-0.5 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous change"
            >
              Previous
            </button>
            <span className="text-gray-500 tabular-nums">
              {activeIdx + 1} / {hunks.length}
            </span>
            <button
              onClick={() => navigateTo(Math.min(hunks.length - 1, activeIdx + 1))}
              disabled={activeIdx === hunks.length - 1}
              className="px-2 py-0.5 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next change"
            >
              Next
            </button>
          </div>
        )}

        {actionLabel && onAction && (
          <button
            onClick={onAction}
            disabled={actionDisabled}
            title={actionHint}
            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>

      <div id="diff-view-div-009" className="min-w-0 flex-1 overflow-y-auto">
        {isIdentical ? (
          <div id="diff-view-div-010" className="flex-1 flex items-center justify-center h-full text-gray-400 text-sm">Files are identical</div>
        ) : (
          hunks.map((hunk) => (
            <HunkBlock
              key={hunk.id}
              hunk={hunk}
              total={hunks.length}
              isActive={hunk.id === resolvedActiveHunkId}
              mergeState={mergeStateByHunk?.[hunk.id] ?? 'unresolved'}
              editedContent={editedContentByHunk?.[hunk.id] ?? ''}
              onTakeA={onTakeA}
              onTakeB={onTakeB}
              onEditHunk={onEditHunk}
              onEditedContentChange={onEditedContentChange}
              hunkRef={setHunkRef(hunk.id)}
              onActivate={(hunkId) => {
                setActiveHunk(hunkId);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
