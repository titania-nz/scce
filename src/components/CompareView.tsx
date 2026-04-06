'use client';

import { useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import DiffView from './DiffView';

export default function CompareView() {
  const { files } = useFiles();
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  const { content: contentA, isLoading: loadingA } = useFileContent(selectedA);
  const { content: contentB, isLoading: loadingB } = useFileContent(selectedB);

  const bothSelected = selectedA && selectedB;
  const isLoading = loadingA || loadingB;

  const selectClass =
    'flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* File selector header */}
      <div className="flex items-center gap-2 px-3 h-10 bg-gray-900 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-400 shrink-0">A</span>
        <select
          value={selectedA ?? ''}
          onChange={(e) => setSelectedA(e.target.value || null)}
          className={selectClass}
        >
          <option value="">Select a file…</option>
          {files.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>

        <span className="text-xs text-gray-600 shrink-0">vs</span>

        <span className="text-xs font-semibold text-gray-400 shrink-0">B</span>
        <select
          value={selectedB ?? ''}
          onChange={(e) => setSelectedB(e.target.value || null)}
          className={selectClass}
        >
          <option value="">Select a file…</option>
          {files.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {!bothSelected ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Select two files to compare
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Loading…
        </div>
      ) : (
        <DiffView
          contentA={contentA}
          contentB={contentB}
          filenameA={selectedA!}
          filenameB={selectedB!}
        />
      )}
    </div>
  );
}
