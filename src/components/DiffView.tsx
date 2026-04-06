'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { computeDiff, DiffHunk, DiffLine } from '@/lib/diffUtils';

interface DiffViewProps {
  contentA: string;
  contentB: string;
  filenameA: string;
  filenameB: string;
  actionLabel?: string;
  actionHint?: string;
  actionDisabled?: boolean;
  onAction?: () => void | Promise<void>;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const lineNumClass = 'w-10 shrink-0 text-right select-none text-gray-600 tabular-nums';

  let rowClass = 'flex font-mono text-xs leading-5';
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
    <div className={rowClass}>
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
  hunkRef,
}: {
  hunk: DiffHunk;
  total: number;
  isActive: boolean;
  hunkRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={hunkRef}>
      <div
        className={`flex items-center px-3 py-0.5 text-xs font-mono text-gray-500 bg-gray-900 border-y border-gray-700 ${isActive ? 'border-l-2 border-l-blue-500' : ''}`}
      >
        @@ hunk {hunk.id + 1} of {total} @@
      </div>
      {hunk.lines.map((line, i) => (
        <DiffLineRow key={i} line={line} />
      ))}
    </div>
  );
}

export default function DiffView({
  contentA,
  contentB,
  filenameA,
  filenameB,
  actionLabel,
  actionHint,
  actionDisabled = false,
  onAction,
}: DiffViewProps) {
  const diff = useMemo(() => computeDiff(contentA, contentB), [contentA, contentB]);
  const [activeIdx, setActiveIdx] = useState(0);
  const hunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    setActiveIdx(0);
  }, [contentA, contentB]);

  const setHunkRef = useCallback(
    (id: number) => (el: HTMLDivElement | null) => {
      if (el) hunkRefs.current.set(id, el);
      else hunkRefs.current.delete(id);
    },
    [],
  );

  function navigateTo(idx: number) {
    setActiveIdx(idx);
    hunkRefs.current.get(idx)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const { hunks, totalAdditions, totalRemovals, isIdentical } = diff;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
      <div className="shrink-0 flex items-center gap-3 px-3 h-10 bg-gray-900 border-b border-gray-700 text-xs sticky top-0 z-10">
        <span className="text-green-400 font-mono">+{totalAdditions}</span>
        <span className="text-red-400 font-mono">-{totalRemovals}</span>

        <span className="text-gray-500 truncate flex-1 min-w-0">
          <span className="text-gray-300">{filenameA}</span>
          <span className="mx-1">vs</span>
          <span className="text-gray-300">{filenameB}</span>
        </span>

        {!isIdentical && hunks.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
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

      <div className="flex-1 overflow-y-auto">
        {isIdentical ? (
          <div className="flex-1 flex items-center justify-center h-full text-gray-400 text-sm">Files are identical</div>
        ) : (
          hunks.map((hunk) => (
            <HunkBlock
              key={hunk.id}
              hunk={hunk}
              total={hunks.length}
              isActive={hunk.id === activeIdx}
              hunkRef={setHunkRef(hunk.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
