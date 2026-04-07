'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import { buildFileApiPath } from '@/lib/fileApiPath';
import { buildMergedPreviewRanges, computeDiff, getMergedPreviewAnchorText } from '@/lib/diffUtils';
import { REVISION_STATUSES } from '@/lib/revisionStatus';
import { findAvailableVersionedFilename } from '@/lib/versionedFilename';
import { RevisionStatus } from '@/types';
import DiffView, { HunkMergeState } from './DiffView';
import PreviewPane from './PreviewPane';

interface CompareViewProps {
  selectedFile?: string | null;
  onFileSelect?: (filename: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

type PostMergeAction = 'keep' | 'archive' | 'delete';
type MergedOutputView = 'raw' | 'rich';

function buildArchivePath(filename: string): string {
  return `archive/${filename}`;
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function CompareView({ selectedFile = null, onFileSelect, onDirtyChange }: CompareViewProps) {
  const { files, createFile, deleteFile, renameFile, mutate: mutateFiles } = useFiles();
  const [selectedA, setSelectedA] = useState<string | null>(selectedFile);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [revisionA, setRevisionA] = useState<string>('latest');
  const [revisionB, setRevisionB] = useState<string>('latest');
  const [destination, setDestination] = useState<'overwrite-a' | 'overwrite-b' | 'new-path'>('overwrite-a');
  const [postMergeActionA, setPostMergeActionA] = useState<PostMergeAction>('keep');
  const [postMergeActionB, setPostMergeActionB] = useState<PostMergeAction>('keep');
  const [newFilePath, setNewFilePath] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [mergeNote, setMergeNote] = useState('');
  const [mergeTagsInput, setMergeTagsInput] = useState('');
  const [mergeStatus, setMergeStatus] = useState<RevisionStatus | ''>('');
  const [mergedContent, setMergedContent] = useState('');
  const [autoMergedContent, setAutoMergedContent] = useState('');
  const [mergedDirty, setMergedDirty] = useState(false);
  const [unresolvedHunks, setUnresolvedHunks] = useState(0);
  const [isSavingMerged, setIsSavingMerged] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [mergedOutputView, setMergedOutputView] = useState<MergedOutputView>('raw');
  const [activeHunkId, setActiveHunkId] = useState<number | null>(null);
  const [isMergeConfigCollapsed, setIsMergeConfigCollapsed] = useState(false);
  const pendingSaveRef = useRef<{ filename: string; content: string } | null>(null);
  const mergedPreviewRef = useRef<HTMLDivElement>(null);

  const {
    content: contentA,
    revisions: revisionsA,
    isLoading: loadingA,
    saveContent: saveA,
  } = useFileContent(selectedA);
  const {
    content: contentB,
    revisions: revisionsB,
    isLoading: loadingB,
    saveContent: saveB,
  } = useFileContent(selectedB);

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
  const targetFilename = useMemo(() => {
    if (destination === 'overwrite-b') return selectedB ?? '';
    if (destination === 'new-path') return newFilePath.trim();
    return selectedA ?? '';
  }, [destination, newFilePath, selectedA, selectedB]);
  const sourceAWillBeReplaced = Boolean(selectedA) && selectedA === targetFilename.trim();
  const sourceBWillBeReplaced = Boolean(selectedB) && selectedB === targetFilename.trim();

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

  const mergedPreviewRanges = useMemo(
    () => buildMergedPreviewRanges(diff, mergeStateByHunk, editedContentByHunk),
    [diff, editedContentByHunk, mergeStateByHunk],
  );

  const mergedOutputLines = useMemo(() => mergedOutput.split('\n'), [mergedOutput]);
  const activeMergedPreviewText = useMemo(
    () => getMergedPreviewAnchorText(mergedOutputLines, activeHunkId !== null ? mergedPreviewRanges[activeHunkId] : undefined),
    [activeHunkId, mergedOutputLines, mergedPreviewRanges],
  );

  useEffect(() => {
    if (activeHunkId === null || mergedOutputView !== 'raw') return;
    const root = mergedPreviewRef.current;
    if (!root) return;

    const target = root.querySelector<HTMLElement>(`[data-merged-preview-hunk="${activeHunkId}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeHunkId, mergedOutput, mergedOutputView]);

  useEffect(() => {
    setUnresolvedHunks(unresolvedCount);
  }, [unresolvedCount]);

  async function handleFinalize() {
    if (!bothSelected) {
      setErrorMessage('Select two files before finalizing a merge.');
      return;
    }
    if (!canFinalizeMerge) {
      setErrorMessage('Resolve all merge hunks before finalizing.');
      return;
    }

    const filename = targetFilename.trim();
    if (!filename) {
      setSaveError('Choose a merge target before saving.');
      return;
    }

    const tags = mergeTagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const fileNames = files.map((file) => file.name);
    const cleanupSummary: string[] = [];

    const payload = {
      content: mergedOutput,
      note: mergeNote || `Merged ${selectedA} and ${selectedB}`,
      tags,
      status: mergeStatus || undefined,
    };

    setIsSavingMerged(true);
    setErrorMessage(null);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      let savedFilename = filename;

      if (destination === 'overwrite-a' && selectedA) {
        await saveA(mergedOutput, payload);
      } else if (destination === 'overwrite-b' && selectedB) {
        await saveB(mergedOutput, payload);
      } else {
        const existingFile = files.find((file) => file.name === filename);
        if (!existingFile) {
          const created = await createFile(filename, mergedOutput);
          savedFilename = created?.name ?? filename;
          await mutateFiles();
        } else {
          const response = await fetch(buildFileApiPath(filename), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const errorPayload = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(errorPayload.error ?? `Could not save ${filename}`);
          }
        }
        await mutateFiles();
      }

      const processedSources = new Set<string>();
      const cleanupPlans = [
        { sourceName: selectedA, action: postMergeActionA },
        { sourceName: selectedB, action: postMergeActionB },
      ];

      for (const cleanupPlan of cleanupPlans) {
        const sourceName = cleanupPlan.sourceName?.trim();
        if (!sourceName || sourceName === savedFilename || processedSources.has(sourceName)) continue;
        if (cleanupPlan.action === 'keep') continue;
        processedSources.add(sourceName);

        if (cleanupPlan.action === 'delete') {
          await deleteFile(sourceName);
          cleanupSummary.push(`deleted ${sourceName}`);
          continue;
        }

        const archiveBasePath = buildArchivePath(sourceName);
        const archiveTarget = findAvailableVersionedFilename(archiveBasePath, fileNames);
        await renameFile(sourceName, archiveTarget);
        fileNames.push(archiveTarget);
        cleanupSummary.push(`archived ${sourceName} to ${archiveTarget}`);
      }

      onFileSelect?.(savedFilename);
      setSelectedA(savedFilename);
      setRevisionA('latest');
      setSelectedB(null);
      setRevisionB('latest');
      setSaveSuccess(
        cleanupSummary.length > 0
          ? `Merged output saved to ${savedFilename}; ${cleanupSummary.join('; ')}.`
          : `Merged output saved to ${savedFilename}.`,
      );
      setMergedDirty(false);
      onDirtyChange?.(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not finalize merge';
      setSaveError(message);
      setErrorMessage(message);
    } finally {
      setIsSavingMerged(false);
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            onClick={() => setIsMergeConfigCollapsed((prev) => !prev)}
            aria-expanded={!isMergeConfigCollapsed}
            aria-controls="merge-config-panel"
            className="inline-flex shrink-0 items-center gap-2 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-800"
          >
            <span className="text-[10px] text-gray-400">{isMergeConfigCollapsed ? '+' : '-'}</span>
            <span>{isMergeConfigCollapsed ? 'Show merge controls' : 'Hide merge controls'}</span>
          </button>
          <div className="min-w-0 flex-1 text-xs text-gray-400">
            <span className="font-medium text-gray-200">Merge setup</span>
            <span className="mx-2 text-gray-600">•</span>
            <span className="truncate">
              {selectedA || 'Choose file A'} vs {selectedB || 'choose file B'}
            </span>
          </div>
          <span className={`shrink-0 text-xs ${unresolvedHunks > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
            {unresolvedHunks > 0 ? `${unresolvedHunks} unresolved hunk(s)` : 'All hunks resolved'}
          </span>
        </div>

        {!isMergeConfigCollapsed && (
          <div id="merge-config-panel" className="flex flex-col gap-2 px-3 pb-2">
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

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 shrink-0">Destination</span>
              <select
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value as 'overwrite-a' | 'overwrite-b' | 'new-path');
                  setSaveError(null);
                  setSaveSuccess(null);
                }}
                className={`${selectClass} max-w-64`}
              >
                <option value="overwrite-a">Overwrite file A</option>
                <option value="overwrite-b">Overwrite file B</option>
                <option value="new-path">Save as new file path</option>
              </select>

              {destination === 'new-path' && (
                <input
                  className={`${selectClass} min-w-64`}
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="docs/merged-result.md"
                />
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <input
                className={selectClass}
                value={mergeNote}
                onChange={(e) => setMergeNote(e.target.value)}
                placeholder="Revision note (optional)"
              />
              <input
                className={selectClass}
                value={mergeTagsInput}
                onChange={(e) => setMergeTagsInput(e.target.value)}
                placeholder="Tags (optional, comma-separated)"
              />
              <select
                className={selectClass}
                value={mergeStatus}
                onChange={(e) => setMergeStatus((e.target.value as RevisionStatus) || '')}
              >
                <option value="">No status</option>
                {REVISION_STATUSES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <span className="min-w-16 text-gray-400">After A</span>
                <select
                  className={selectClass}
                  value={sourceAWillBeReplaced ? 'keep' : postMergeActionA}
                  onChange={(e) => setPostMergeActionA(e.target.value as PostMergeAction)}
                  disabled={sourceAWillBeReplaced || !selectedA}
                >
                  <option value="keep">Keep file A</option>
                  <option value="archive">Archive file A</option>
                  <option value="delete">Delete file A</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <span className="min-w-16 text-gray-400">After B</span>
                <select
                  className={selectClass}
                  value={sourceBWillBeReplaced ? 'keep' : postMergeActionB}
                  onChange={(e) => setPostMergeActionB(e.target.value as PostMergeAction)}
                  disabled={sourceBWillBeReplaced || !selectedB}
                >
                  <option value="keep">Keep file B</option>
                  <option value="archive">Archive file B</option>
                  <option value="delete">Delete file B</option>
                </select>
              </label>
            </div>
            {(sourceAWillBeReplaced || sourceBWillBeReplaced) && (
              <p className="text-xs text-gray-500">
                The merge target always stays in place, so overwrite targets cannot be archived or deleted in the same step.
              </p>
            )}

            {(saveSuccess || saveError) && (
              <div className={`text-xs ${saveError ? 'text-red-400' : 'text-green-400'}`}>
                {saveError ?? saveSuccess}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-700">
              <label className="text-xs text-gray-300 shrink-0">Merge target</label>
              <input
                value={targetFilename ?? ''}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="merged-result.md"
                className="flex-1 min-w-56 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleFinalize}
                disabled={!bothSelected || isSavingMerged}
                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSavingMerged ? 'Saving…' : 'Finalize Merge'}
              </button>
              <span className={`text-xs ${unresolvedHunks > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
                {unresolvedHunks > 0 ? `${unresolvedHunks} unresolved hunk(s)` : 'All hunks resolved'}
              </span>
            </div>
            {errorMessage && <p className="text-xs text-red-300">{errorMessage}</p>}
          </div>
        )}
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
            activeHunkId={activeHunkId}
            mergeStateByHunk={mergeStateByHunk}
            editedContentByHunk={editedContentByHunk}
            onActiveHunkChange={setActiveHunkId}
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
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded border border-gray-700 bg-gray-950 p-0.5">
                  {([
                    ['raw', 'MD Raw'],
                    ['rich', 'Rich Text'],
                  ] as const).map(([view, label]) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setMergedOutputView(view)}
                      className={`rounded px-2 py-1 transition-colors ${
                        mergedOutputView === view
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className={canFinalizeMerge ? 'text-green-400' : 'text-yellow-400'}>
                  {canFinalizeMerge ? 'Ready to finalize' : `${unresolvedCount} unresolved hunk(s)`}
                </span>
              </div>
            </div>
            <div className="h-72 overflow-hidden rounded border border-gray-700 bg-gray-950">
              {mergedOutputView === 'raw' ? (
                <div ref={mergedPreviewRef} className="h-full overflow-y-auto font-mono text-xs text-gray-200">
                  {mergedOutputLines.map((line, index) => {
                    const activeRange = activeHunkId !== null ? mergedPreviewRanges[activeHunkId] : undefined;
                    const isActive =
                      activeRange !== undefined &&
                      index >= activeRange.startLine &&
                      index <= activeRange.endLine;

                    return (
                      <div
                        key={`${index}-${line}`}
                        data-merged-preview-hunk={isActive ? activeHunkId : undefined}
                        className={`flex min-w-0 border-b border-gray-900/60 ${
                          isActive ? 'bg-blue-950/70' : ''
                        }`}
                      >
                        <span className="w-12 shrink-0 select-none border-r border-gray-800 px-2 py-1 text-right text-gray-500">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-3 py-1">
                          {line || '\u00a0'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <PreviewPane content={mergedOutput} scrollToText={activeMergedPreviewText} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
