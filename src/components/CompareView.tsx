'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import { FileRevisionsResponse } from '@/types';
import DiffView from './DiffView';
import DiffView, { RevisionDescriptor } from './DiffView';

function tokenizeRevisionName(baseName: string): string[] {
  if (baseName.includes('__')) return baseName.split('__').map((p) => p.trim()).filter(Boolean);
  if (baseName.includes(' - ')) return baseName.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (baseName.includes('--')) return baseName.split('--').map((p) => p.trim()).filter(Boolean);
  return [baseName];
}

function looksLikeTimestamp(part: string): boolean {
  return /\d{4}[-_]\d{2}[-_]\d{2}/.test(part) || /\d{8}/.test(part);
}

function normalizeTimestamp(rawTimestamp: string, fallback: string): string {
  const cleaned = rawTimestamp.replace(/_/g, ' ').replace(/\./g, ':').trim();
  const date = new Date(cleaned);

  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const fallbackDate = new Date(fallback);
  if (!Number.isNaN(fallbackDate.getTime())) {
    return fallbackDate.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return 'Unknown time';
}

function cleanLabel(prefixes: string[], value: string) {
  const matcher = new RegExp(`^(${prefixes.join('|')})[:\\s_-]*`, 'i');
  return value.replace(matcher, '').trim();
}

function getRevisionDescriptor(name: string, mtime: string): RevisionDescriptor {
  const baseName = name.replace(/\.md$/i, '');
  const tokens = tokenizeRevisionName(baseName);
  const chapter = tokens[0] ?? baseName;

  let timestampToken = '';
  let sourceLabel = '';
  const noteParts: string[] = [];

  for (const token of tokens.slice(1)) {
    if (!timestampToken && looksLikeTimestamp(token)) {
      timestampToken = token;
      continue;
    }

    if (!sourceLabel && /^(author|source|by)\b/i.test(token)) {
      sourceLabel = cleanLabel(['author', 'source', 'by'], token);
      continue;
    }

    noteParts.push(token);
  }

  if (!sourceLabel && noteParts.length > 0) {
    sourceLabel = noteParts.shift() ?? '';
  }

  return {
    filename: name,
    chapter,
    timestampLabel: normalizeTimestamp(timestampToken, mtime),
    sourceLabel: sourceLabel || 'Unknown source',
    noteSummary: noteParts.join(' · ') || 'No note summary',
  };
}

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
  const revisions = files.map((file) => getRevisionDescriptor(file.name, file.mtime));
  const chapters = Array.from(new Set(revisions.map((rev) => rev.chapter))).sort((a, b) =>
    a.localeCompare(b),
  );

  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  const revisionOptions = revisions.filter((rev) =>
    selectedChapter ? rev.chapter === selectedChapter : false,
  );
  const selectedRevisionA = revisionOptions.find((rev) => rev.filename === selectedA) ?? null;
  const selectedRevisionB = revisionOptions.find((rev) => rev.filename === selectedB) ?? null;

  const { content: contentA, isLoading: loadingA } = useFileContent(selectedA);
  const { content: contentB, isLoading: loadingB } = useFileContent(selectedB);

  const bothSelected = selectedRevisionA && selectedRevisionB;
  const isLoading = loadingA || loadingB;

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
  function selectLabel(revision: RevisionDescriptor) {
    return `${revision.timestampLabel} · ${revision.sourceLabel} · ${revision.noteSummary}`;
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
        <span className="text-xs font-semibold text-gray-400 shrink-0">Chapter</span>
        <select
          value={selectedChapter ?? ''}
          onChange={(e) => {
            const nextChapter = e.target.value || null;
            setSelectedChapter(nextChapter);
            setSelectedA(null);
            setSelectedB(null);
          }}
          className={selectClass}
        >
          <option value="">Select document/chapter…</option>
          {chapters.map((chapter) => (
            <option key={chapter} value={chapter}>{chapter}</option>
          ))}
        </select>

        <span className="text-xs font-semibold text-gray-400 shrink-0">A</span>
        <select
          value={selectedA ?? ''}
          onChange={(e) => setSelectedA(e.target.value || null)}
          className={selectClass}
          disabled={!selectedChapter}
        >
          <option value="">Select revision A…</option>
          {revisionOptions.map((revision) => (
            <option key={revision.filename} value={revision.filename}>
              {selectLabel(revision)}
            </option>
          ))}
        </select>

        <span className="text-xs text-gray-600 shrink-0">vs</span>

        <span className="text-xs font-semibold text-gray-400 shrink-0">B</span>
        <select
          value={selectedB ?? ''}
          onChange={(e) => setSelectedB(e.target.value || null)}
          className={selectClass}
          disabled={!selectedChapter}
        >
          <option value="">Select revision B…</option>
          {revisionOptions.map((revision) => (
            <option key={revision.filename} value={revision.filename}>
              {selectLabel(revision)}
            </option>
          ))}
        </select>
      </div>

      {!activeFile ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Select a document to compare revisions
          {selectedChapter
            ? 'Select two revisions from this chapter'
            : 'Select a document/chapter first'}
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
        <DiffView
          contentA={contentA}
          contentB={contentB}
          revisionA={selectedRevisionA!}
          revisionB={selectedRevisionB!}
        />
      )}
    </div>
  );
}
