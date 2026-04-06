'use client';

import { useMemo, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import DiffView from './DiffView';

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

  const headerA = selectedRevisionA?.note ? `${selectedA} - ${selectedRevisionA.note}` : selectedA ?? '';
  const headerB = selectedRevisionB?.note ? `${selectedB} - ${selectedRevisionB.note}` : selectedB ?? '';

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
        <DiffView
          contentA={effectiveContentA}
          contentB={effectiveContentB}
          filenameA={headerA}
          filenameB={headerB}
        />
      )}
    </div>
  );
}
