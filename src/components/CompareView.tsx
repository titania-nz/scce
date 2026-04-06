'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import { computeDiff } from '@/lib/diffUtils';
import DiffView, { HunkMergeState } from './DiffView';

interface CompareViewProps {
  selectedFile?: string | null;
  onFileSelect?: (filename: string | null) => void;
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function CompareView({ selectedFile = null, onFileSelect }: CompareViewProps) {
  const { files } = useFiles();
  const [selectedA, setSelectedA] = useState<string | null>(selectedFile);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [revisionA, setRevisionA] = useState<string>('latest');
  const [revisionB, setRevisionB] = useState<string>('latest');

  const { content: contentA, revisions: revisionsA, isLoading: loadingA } = useFileContent(selectedA);
  const { content: contentB, revisions: revisionsB, isLoading: loadingB } = useFileContent(selectedB);

  const bothSelected = selectedA && selectedB;
  const isLoading = loadingA || loadingB;

  const selectClass =
    'flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500';

  const selectedRevisionA = useMemo(
    () => revisionsA.find((revision) => revision.id === revisionA),
    [revisionA, revisionsA],
  );
  const selectedRevisionB = useMemo(
    () => revisionsB.find((revision) => revision.id === revisionB),
    [revisionB, revisionsB],
  );

  const effectiveContentA = selectedRevisionA?.content ?? contentA;
  const effectiveContentB = selectedRevisionB?.content ?? contentB;
  const diff = useMemo(
    () => computeDiff(effectiveContentA ?? '', effectiveContentB ?? ''),
    [effectiveContentA, effectiveContentB],
  );

  const [mergeStateByHunk, setMergeStateByHunk] = useState<Record<number, HunkMergeState>>({});
  const [editedContentByHunk, setEditedContentByHunk] = useState<Record<number, string>>({});
  const [mergedOutput, setMergedOutput] = useState('');

  const headerA = selectedRevisionA?.note ? `${selectedA} - ${selectedRevisionA.note}` : selectedA ?? '';
  const headerB = selectedRevisionB?.note ? `${selectedB} - ${selectedRevisionB.note}` : selectedB ?? '';
  const hasDiff = !diff.isIdentical && diff.hunks.length > 0;

  useEffect(() => {
    setMergeStateByHunk(() =>
      Object.fromEntries(diff.hunks.map((hunk) => [hunk.id, 'unresolved' satisfies HunkMergeState])),
    );
    setEditedContentByHunk({});
  }, [diff.hunks, selectedA, selectedB, revisionA, revisionB]);

  const unresolvedCount = useMemo(
    () => diff.hunks.filter((hunk) => (mergeStateByHunk[hunk.id] ?? 'unresolved') === 'unresolved').length,
    [diff.hunks, mergeStateByHunk],
  );
  const canFinalizeMerge = !hasDiff || unresolvedCount === 0;

  const mergedOutputDraft = useMemo(() => {
    if (!effectiveContentA && !effectiveContentB) return '';
    if (diff.isIdentical || diff.hunks.length === 0) return effectiveContentB ?? effectiveContentA ?? '';

    const out: string[] = [];
    let cursor = 0;

    for (const hunk of diff.hunks) {
      for (let i = cursor; i < hunk.start; i++) {
        out.push(diff.flatLines[i].text);
      }

      const state = mergeStateByHunk[hunk.id] ?? 'unresolved';
      if (state === 'edited') {
        const edited = editedContentByHunk[hunk.id] ?? '';
        if (edited.length > 0) out.push(...edited.split('\n'));
      } else {
        const takeB = state === 'takeB' || state === 'unresolved';
        for (const line of hunk.lines) {
          if (takeB && line.kind !== 'removed') out.push(line.text);
          if (!takeB && state === 'takeA' && line.kind !== 'added') out.push(line.text);
        }
      }

      cursor = hunk.end + 1;
    }

    for (let i = cursor; i < diff.flatLines.length; i++) {
      out.push(diff.flatLines[i].text);
    }

    return out.join('\n');
  }, [diff, editedContentByHunk, effectiveContentA, effectiveContentB, mergeStateByHunk]);

  useEffect(() => {
    setMergedOutput(mergedOutputDraft);
  }, [mergedOutputDraft]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-col gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 shrink-0">A</span>
          <select
            value={selectedA ?? ''}
            onChange={(e) => {
              const next = e.target.value || null;
              setSelectedA(next);
              onFileSelect?.(next);
              setRevisionA('latest');
            }}
            className={selectClass}
          >
            <option value="">Select a file...</option>
            {files.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
          <select
            value={revisionA}
            onChange={(e) => setRevisionA(e.target.value)}
            className={`${selectClass} max-w-60`}
            disabled={!selectedA}
          >
            <option value="latest">Latest</option>
            {[...revisionsA].reverse().map((revision) => (
              <option key={revision.id} value={revision.id}>
                {new Date(revision.createdAt).toLocaleDateString()} {revision.note ? `- ${revision.note}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 shrink-0">B</span>
          <select
            value={selectedB ?? ''}
            onChange={(e) => {
              const next = e.target.value || null;
              setSelectedB(next);
              setRevisionB('latest');
            }}
            className={selectClass}
          >
            <option value="">Select a file...</option>
            {files.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
          <select
            value={revisionB}
            onChange={(e) => setRevisionB(e.target.value)}
            className={`${selectClass} max-w-60`}
            disabled={!selectedB}
          >
            <option value="latest">Latest</option>
            {[...revisionsB].reverse().map((revision) => (
              <option key={revision.id} value={revision.id}>
                {new Date(revision.createdAt).toLocaleDateString()} {revision.note ? `- ${revision.note}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!bothSelected ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Select two files to compare
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Loading...
        </div>
      ) : (
        <>
          <DiffView
            contentA={effectiveContentA}
            contentB={effectiveContentB}
            filenameA={headerA}
            filenameB={headerB}
            mergeStateByHunk={mergeStateByHunk}
            editedContentByHunk={editedContentByHunk}
            onTakeA={(hunkId) => {
              setMergeStateByHunk((prev) => ({ ...prev, [hunkId]: 'takeA' }));
            }}
            onTakeB={(hunkId) => {
              setMergeStateByHunk((prev) => ({ ...prev, [hunkId]: 'takeB' }));
            }}
            onEditHunk={(hunkId) => {
              setMergeStateByHunk((prev) => ({ ...prev, [hunkId]: 'edited' }));
              setEditedContentByHunk((prev) => {
                if (prev[hunkId] !== undefined) return prev;
                const hunk = diff.hunks.find((nextHunk) => nextHunk.id === hunkId);
                if (!hunk) return prev;
                const initial = hunk.lines.filter((line) => line.kind !== 'removed').map((line) => line.text).join('\n');
                return { ...prev, [hunkId]: initial };
              });
            }}
            onEditedContentChange={(hunkId, value) => {
              setEditedContentByHunk((prev) => ({ ...prev, [hunkId]: value }));
            }}
            actionLabel="Finalize merge"
            actionHint={canFinalizeMerge ? 'All hunks are resolved' : `${unresolvedCount} unresolved hunk(s) remain`}
            actionDisabled={!canFinalizeMerge}
            onAction={() => {
              // Placeholder entry point for finalize workflow.
              console.info('Merged output ready', { mergedOutput });
            }}
          />
          <div className="shrink-0 border-t border-gray-700 bg-gray-900 p-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-300">Merged Output Preview</span>
              <span className={canFinalizeMerge ? 'text-green-400' : 'text-yellow-400'}>
                {canFinalizeMerge ? 'Ready to finalize' : `${unresolvedCount} unresolved hunk(s)`}
              </span>
            </div>
            <textarea
              className="h-36 w-full resize-y rounded border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              readOnly
              value={mergedOutput}
            />
          </div>
        </>
      )}
    </div>
  );
}
