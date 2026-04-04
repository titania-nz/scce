'use client';

import { useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { FileEntry } from '@/types';

interface SidebarProps {
  selectedFile: string | null;
  onFileSelect: (filename: string) => void;
  onFileDeleted: (filename: string) => void;
  onFileRenamed: (oldName: string, newName: string) => void;
}

export default function Sidebar({
  selectedFile,
  onFileSelect,
  onFileDeleted,
  onFileRenamed,
}: SidebarProps) {
  const { files, isLoading, createFile, deleteFile, renameFile } = useFiles();
  const [newFileName, setNewFileName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    let name = newFileName.trim();
    if (!name) return;
    if (!name.endsWith('.md')) name += '.md';
    setError(null);
    try {
      await createFile(name);
      setNewFileName('');
      setShowNewInput(false);
      onFileSelect(name);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not create file');
    }
  }

  async function handleDelete(file: FileEntry) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    setError(null);
    try {
      await deleteFile(file.name);
      if (selectedFile === file.name) onFileDeleted(file.name);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not delete file');
    }
  }

  function startRename(file: FileEntry) {
    setRenamingFile(file.name);
    setRenameValue(file.name.replace(/\.md$/, ''));
  }

  async function handleRename(oldName: string) {
    let newName = renameValue.trim();
    if (!newName) {
      setRenamingFile(null);
      return;
    }
    if (!newName.endsWith('.md')) newName += '.md';
    if (newName === oldName) {
      setRenamingFile(null);
      return;
    }
    setError(null);
    try {
      await renameFile(oldName, newName);
      setRenamingFile(null);
      onFileRenamed(oldName, newName);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not rename file');
    }
  }

  return (
    <aside className="flex flex-col h-full bg-gray-900 text-gray-100 w-64 shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Files</span>
        <button
          onClick={() => { setShowNewInput(true); setError(null); }}
          className="text-gray-400 hover:text-white transition-colors"
          title="New file"
          aria-label="New file"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {showNewInput && (
        <div className="px-3 py-2 border-b border-gray-700">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setShowNewInput(false); setNewFileName(''); }
            }}
            placeholder="filename.md"
            className="w-full bg-gray-800 text-gray-100 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <button
              onClick={handleCreate}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setShowNewInput(false); setNewFileName(''); }}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-3 text-sm text-gray-500">Loading...</div>
        )}
        {!isLoading && files.length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-500">No files yet</div>
        )}
        {files.map((file) => (
          <div
            key={file.name}
            className={`group flex items-center px-3 py-2 cursor-pointer hover:bg-gray-800 transition-colors ${
              selectedFile === file.name ? 'bg-gray-800 border-l-2 border-blue-500' : 'border-l-2 border-transparent'
            }`}
          >
            {renamingFile === file.name ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(file.name);
                  if (e.key === 'Escape') setRenamingFile(null);
                }}
                onBlur={() => handleRename(file.name)}
                className="flex-1 bg-gray-700 text-gray-100 text-sm px-1 py-0.5 rounded border border-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            ) : (
              <>
                <span
                  className="flex-1 text-sm truncate"
                  onClick={() => onFileSelect(file.name)}
                  title={file.name}
                >
                  {file.name}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(file); }}
                    className="text-gray-400 hover:text-white p-0.5"
                    title="Rename"
                    aria-label={`Rename ${file.name}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                    className="text-gray-400 hover:text-red-400 p-0.5"
                    title="Delete"
                    aria-label={`Delete ${file.name}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
