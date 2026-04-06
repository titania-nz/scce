'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import { FileRevisionsResponse } from '@/types';
import DiffView from './DiffView';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CompareViewProps {
  selectedFile: string | null;
  onFileSelect?: (filename: string | null) => void;
}

export default function CompareView({ selectedFile, onFileSelect }: CompareViewProps) {
  const { files } = useFiles();
  const [localFile, setLocalFile] = useState<string | null>(selectedFile);
  const activeFile = selectedFile ?? localFile;

  useEffect(() => {
    if (selectedFile) {
      setLocalFile(selectedFile);
    }
  }, [selectedFile]);

  const revisionsKey = activeFile
    ? `/api/files/${encodeURIComponent(activeFile)}/revisions`
    : null;

  const {
    data: revisionsData,
    isLoading: revisionsLoading,
    mutate: mutateRevisions,
  } = useSWR<FileRevisionsResponse>(revisionsKey, fetcher, { revalidateOnFocus: false });

  const revisions = revisionsData?.revisions ?? [];

  const [selectedRevisionA, setSelectedRevisionA] = useState<string | null>(null);
  const [selectedRevisionB, setSelectedRevisionB] = useState<string | null>(null);

  useEffect(() => {
    if (!revisionsData) return;

    const draftId = revisionsData.currentDraftRevisionId;
    const fallbackA = revisions.find((rev) => rev.id !== draftId)?.id ?? revisions[0]?.id ?? null;

    setSelectedRevisionA((prev) => {
      if (prev && revisions.some((rev) => rev.id === prev)) return prev;
      return fallbackA;
    });
    setSelectedRevisionB((prev) => {
      if (prev && revisions.some((rev) => rev.id === prev)) return prev;
      return draftId ?? revisions[0]?.id ?? null;
    });
  }, [revisions, revisionsData]);

  const { content: contentA, isLoading: loadingA } = useFileContent(activeFile, selectedRevisionA);
  const {
    content: contentB,
    isLoading: loadingB,
    promoteRevisionAsDraft,
  } = useFileContent(activeFile, selectedRevisionB);

  const selectClass =
    'flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500';

  const bothSelected = Boolean(activeFile && selectedRevisionA && selectedRevisionB);
  const isLoading = revisionsLoading || loadingA || loadingB;

  const selectedRevisionBMeta = useMemo(
    () => revisions.find((rev) => rev.id === selectedRevisionB) ?? null,
    [revisions, selectedRevisionB],
  );

  async function handleUseRevisionBAsDraft() {
    if (!selectedRevisionB) return;
    await promoteRevisionAsDraft(selectedRevisionB);
    await mutateRevisions();
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-10 bg-gray-900 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-400 shrink-0">Doc</span>
        <select
          value={activeFile ?? ''}
          onChange={(e) => {
            const next = e.target.value || null;
            setLocalFile(next);
            onFileSelect?.(next);
          }}
          className={selectClass}
        >
          <option value="">Select a file…</option>
          {files.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>

      {!activeFile ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Select a document to compare revisions
        </div>
      ) : revisions.length < 2 ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Save this document at least twice to compare revisions
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 h-10 bg-gray-900 border-b border-gray-700 shrink-0">
            <span className="text-xs font-semibold text-gray-400 shrink-0">A</span>
            <select
              value={selectedRevisionA ?? ''}
              onChange={(e) => setSelectedRevisionA(e.target.value || null)}
              className={selectClass}
            >
              {revisions.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  {new Date(rev.createdAt).toLocaleString()} ({rev.id.slice(0, 8)})
                </option>
              ))}
            </select>

            <span className="text-xs text-gray-600 shrink-0">vs</span>

            <span className="text-xs font-semibold text-gray-400 shrink-0">B</span>
            <select
              value={selectedRevisionB ?? ''}
              onChange={(e) => setSelectedRevisionB(e.target.value || null)}
              className={selectClass}
            >
              {revisions.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  {new Date(rev.createdAt).toLocaleString()} ({rev.id.slice(0, 8)})
                  {revisionsData?.currentDraftRevisionId === rev.id ? ' • Draft' : ''}
                </option>
              ))}
            </select>
          </div>

          {!bothSelected || isLoading ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              Loading…
            </div>
          ) : (
            <DiffView
              contentA={contentA}
              contentB={contentB}
              filenameA={`${activeFile} @ ${selectedRevisionA?.slice(0, 8)}`}
              filenameB={`${activeFile} @ ${selectedRevisionB?.slice(0, 8)}`}
              actionLabel="Use Revision B as Draft"
              actionDisabled={revisionsData?.currentDraftRevisionId === selectedRevisionB}
              actionHint={
                revisionsData?.currentDraftRevisionId === selectedRevisionB
                  ? 'Revision B is already the active draft'
                  : selectedRevisionBMeta
                    ? `Promote revision from ${new Date(selectedRevisionBMeta.createdAt).toLocaleString()} as draft`
                    : undefined
              }
              onAction={handleUseRevisionBAsDraft}
            />
          )}
        </>
      )}
    </div>
  );
}
