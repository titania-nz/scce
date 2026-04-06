'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import { buildFileApiPath } from '@/lib/fileApiPath';
import { RevisionStatus } from '@/types';
import DiffView from './DiffView';

interface CompareViewProps {
  selectedFile?: string | null;
  onFileSelect?: (filename: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const EditorPane = dynamic(() => import('./EditorPane'), { ssr: false });

// Main component export: this is the entry point rendered by parent routes/components.
export default function CompareView({ selectedFile = null, onFileSelect, onDirtyChange }: CompareViewProps) {
  const { files, createFile, mutate: mutateFiles } = useFiles();
  const [selectedA, setSelectedA] = useState<string | null>(selectedFile);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [revisionA, setRevisionA] = useState<string>('latest');
  const [revisionB, setRevisionB] = useState<string>('latest');
  const [destination, setDestination] = useState<'overwrite-a' | 'overwrite-b' | 'new-path'>('overwrite-a');
  const [newFilePath, setNewFilePath] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [mergeNote, setMergeNote] = useState('');
  const [mergeTagsInput, setMergeTagsInput] = useState('');
  const [mergeStatus, setMergeStatus] = useState<RevisionStatus | ''>('');
  const [targetFilename, setTargetFilename] = useState('');
  const [mergedContent, setMergedContent] = useState('');
  const [autoMergedContent, setAutoMergedContent] = useState('');
  const [mergedDirty, setMergedDirty] = useState(false);
  const [unresolvedHunks, setUnresolvedHunks] = useState(0);
  const [isSavingMerged, setIsSavingMerged] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const pendingSaveRef = useRef<{ filename: string; content: string } | null>(null);

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
  const parsedMergeTags = useMemo(
    () => mergeTagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
    [mergeTagsInput],
  );

  const headerA = selectedRevisionA?.note ? `${selectedA} - ${selectedRevisionA.note}` : selectedA ?? '';
  const headerB = selectedRevisionB?.note ? `${selectedB} - ${selectedRevisionB.note}` : selectedB ?? '';
  const targetFilename = destination === 'overwrite-a'
    ? selectedA
    : destination === 'overwrite-b'
      ? selectedB
      : (newFilePath.trim() || null);
  const isFinalizeDisabled = !bothSelected
    || isLoading
    || isFinalizing
    || !targetFilename
    || (destination === 'overwrite-a' && !selectedA)
    || (destination === 'overwrite-b' && !selectedB);

  async function handleFinalize(): Promise<void> {
    if (!selectedA || !selectedB || !targetFilename) return;
    setIsFinalizing(true);
    setSaveError(null);
    setSaveSuccess(null);

    const timestamp = new Date().toISOString();
    const note = (mergeNote.trim() || `Merged from A/B compare on ${timestamp}`);
    const metadata = {
      note,
      tags: parsedMergeTags,
      status: mergeStatus || undefined,
    };

    try {
      if (destination === 'overwrite-a') {
        await saveA(effectiveContentB, metadata);
      } else if (destination === 'overwrite-b') {
        await saveB(effectiveContentA, metadata);
      } else {
        const response = await fetch(buildFileApiPath(targetFilename), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: effectiveContentB,
            ...metadata,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error ?? 'Could not save merged file');
        }
      }

      await mutateFiles();
      setSaveSuccess(`Merge saved to ${targetFilename}.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not finalize merge');
    } finally {
      setIsFinalizing(false);
    }
  }

  useEffect(() => {
    setMergedDirty(false);
    setMergedContent('');
    setAutoMergedContent('');
    setUnresolvedHunks(0);
  }, [selectedA, selectedB, revisionA, revisionB]);

  useEffect(() => {
    setTargetFilename(selectedA ?? '');
  }, [selectedA]);

  useEffect(() => {
    if (!mergedDirty) {
      setMergedContent(autoMergedContent);
    }
  }, [autoMergedContent, mergedDirty]);

  useEffect(() => {
    onDirtyChange?.(mergedDirty);
  }, [mergedDirty, onDirtyChange]);

  const performSave = useCallback(async (filename: string, content: string) => {
    if (!filename.endsWith('.md')) {
      setErrorMessage('Target filename must end with .md');
      return;
    }

    setErrorMessage(null);
    setIsSavingMerged(true);
    try {
      const exists = files.some((file) => file.name === filename);
      if (exists) {
        const res = await fetch(`/api/files/${filename.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            note: `Merged from ${selectedA ?? 'A'} and ${selectedB ?? 'B'}`,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Could not overwrite file');
        }
      } else {
        await createFile(filename, content);
      }

      setMergedDirty(false);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save merged file');
    } finally {
      setIsSavingMerged(false);
    }
  }, [createFile, files, selectedA, selectedB]);

  const handleFinalize = useCallback(async () => {
    if (!targetFilename.trim()) {
      setErrorMessage('Choose a target file before finalizing.');
      return;
    }
    if (unresolvedHunks > 0) {
      const proceed = window.confirm(`There are ${unresolvedHunks} unresolved hunks. Continue with current merged text?`);
      if (!proceed) return;
    }

    const filename = targetFilename.trim();
    const exists = files.some((file) => file.name === filename);
    if (exists) {
      pendingSaveRef.current = { filename, content: mergedContent };
      setShowOverwriteConfirm(true);
      return;
    }

    await performSave(filename, mergedContent);
  }, [files, mergedContent, performSave, targetFilename, unresolvedHunks]);

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
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="needs-review">Needs review</option>
          </select>
        </div>

        {(saveSuccess || saveError) && (
          <div className={`text-xs ${saveError ? 'text-red-400' : 'text-green-400'}`}>
            {saveError ?? saveSuccess}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-700">
          <label className="text-xs text-gray-300 shrink-0">Merge target</label>
          <input
            value={targetFilename}
            onChange={(e) => setTargetFilename(e.target.value)}
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
            actionLabel={isFinalizing ? 'Finalizing...' : 'Finalize merge'}
            actionHint="Save merge result to the selected destination"
            actionDisabled={isFinalizeDisabled}
            onAction={handleFinalize}
          />
          <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden">
            <DiffView
              contentA={effectiveContentA}
              contentB={effectiveContentB}
              filenameA={headerA}
              filenameB={headerB}
              onMergeStateChange={({ mergedContent: nextMerged, unresolvedCount }) => {
                setAutoMergedContent(nextMerged);
                setUnresolvedHunks(unresolvedCount);
              }}
            />
          </div>
          <div className="hidden lg:block w-px bg-gray-700" />
          <div className="hidden lg:flex flex-1 min-w-0 flex-col bg-gray-900">
            <div className="px-3 py-2 text-xs border-b border-gray-700 text-gray-300">
              Merged preview/editor
            </div>
            <EditorPane
              value={mergedContent}
              onChange={(value) => {
                setMergedContent(value);
                setMergedDirty(value !== autoMergedContent);
              }}
            />
          </div>
        </div>
        </>
      )}

      {showOverwriteConfirm && (
        <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Overwrite existing file?</h2>
            <p className="text-xs text-gray-300">
              <span className="font-mono">{pendingSaveRef.current?.filename}</span> already exists. This will replace its content.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  pendingSaveRef.current = null;
                  setShowOverwriteConfirm(false);
                }}
                className="px-2 py-1 rounded border border-gray-600 text-xs text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const pending = pendingSaveRef.current;
                  pendingSaveRef.current = null;
                  setShowOverwriteConfirm(false);
                  if (!pending) return;
                  await performSave(pending.filename, pending.content);
                }}
                className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-xs text-white"
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
