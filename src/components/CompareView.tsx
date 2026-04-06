'use client';

import { useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { useFileContent } from '@/hooks/useFileContent';
import PreviewPane from './PreviewPane';

function FilePanel({ label }: { label: string }) {
  const { files } = useFiles();
  const [selected, setSelected] = useState<string | null>(null);
  const { content, isLoading } = useFileContent(selected);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-10 bg-gray-900 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-400 shrink-0 w-4">{label}</span>
        <select
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value || null)}
          className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        >
          <option value="">Select a file…</option>
          {files.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Select a file to preview
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Loading…
          </div>
        ) : (
          <PreviewPane content={content} />
        )}
      </div>
    </div>
  );
}

export default function CompareView() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <FilePanel label="A" />
      <div className="w-px bg-gray-700 shrink-0" />
      <FilePanel label="B" />
    </div>
  );
}
