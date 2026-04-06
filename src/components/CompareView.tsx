'use client';

import { useMemo, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import { buildFileApiPath } from '@/lib/fileApiPath';
import { RevisionStatus } from '@/types';
import DiffView from './DiffView';

interface CompareViewProps {
  selectedFile?: string | null;
  onFileSelect?: (filename: string | null) => void;
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function CompareView({ selectedFile = null, onFileSelect }: CompareViewProps) {
  const { files, mutate: mutateFiles } = useFiles();
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
      )}
    </div>
  );
}
