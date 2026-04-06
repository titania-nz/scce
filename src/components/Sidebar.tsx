'use client';

import { ReactNode, useMemo, useRef, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { FileEntry } from '@/types';

type FolderNode = {
  folders: Map<string, FolderNode>;
  files: FileEntry[];
};

interface SidebarProps {
  selectedFile: string | null;
  onFileSelect: (filename: string) => void;
  onFileDeleted: (filename: string) => void;
  onFileRenamed: (oldName: string, newName: string) => void;
}

function createFolderNode(): FolderNode {
  return { folders: new Map(), files: [] };
}

function buildTree(files: FileEntry[]): FolderNode {
  const root = createFolderNode();

  for (const file of files) {
    const parts = file.name.split('/');
    const fileName = parts.pop();
    if (!fileName) continue;

    let current = root;
    for (const folder of parts) {
      if (!current.folders.has(folder)) {
        current.folders.set(folder, createFolderNode());
      }
      current = current.folders.get(folder)!;
    }

    current.files.push(file);
  }

  return root;
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
  const [clipboardContent, setClipboardContent] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));
  const [pathSearch, setPathSearch] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredFiles = useMemo(() => {
    const pathFilter = pathSearch.trim().toLowerCase();
    const nameFilter = nameSearch.trim().toLowerCase();
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    return files.filter((file) => {
      const fileDate = new Date(file.mtime);
      const chapterMatches = !pathFilter || file.name.toLowerCase().includes(pathFilter);
      const fileName = file.name.split('/').at(-1)?.toLowerCase() ?? file.name.toLowerCase();
      const metaMatches = !nameFilter || fileName.includes(nameFilter);
      const fromMatches = !fromDate || fileDate >= fromDate;
      const toMatches = !toDate || fileDate <= toDate;
      return chapterMatches && metaMatches && fromMatches && toMatches;
    });
  }, [pathSearch, dateFrom, dateTo, files, nameSearch]);

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  function resetNewInput() {
    setShowNewInput(false);
    setNewFileName('');
    setClipboardContent(null);
  }

  function toggleFolder(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  async function handleCreate() {
    let name = newFileName.trim().replace(/\\/g, '/');
    if (!name) return;
    if (!name.endsWith('.md')) name += '.md';
    setError(null);
    try {
      await createFile(name, clipboardContent ?? '');
      resetNewInput();
      onFileSelect(name);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not create file');
    }
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setClipboardContent(text);
      const today = new Date().toISOString().slice(0, 10);
      setNewFileName(`paste-${today}`);
      setShowNewInput(true);
      setError(null);
    } catch {
      setError('Could not read clipboard. Check browser permissions.');
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    setError(null);
    let lastCreated: string | null = null;
    for (const file of Array.from(picked)) {
      try {
        const content = await file.text();
        const base = file.name.includes('.')
          ? file.name.replace(/\.[^.]*$/, '')
          : file.name;
        const name = base.replace(/[^a-zA-Z0-9_\-. /]/g, '_') + '.md';
        await createFile(name, content);
        lastCreated = name;
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? `Could not import ${file.name}`);
      }
    }
    e.target.value = '';
    if (lastCreated) onFileSelect(lastCreated);
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
    let newName = renameValue.trim().replace(/\\/g, '/');
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

  function renderTree(node: FolderNode, parentPath = '', depth = 0) {
    const folderItems = Array.from(node.folders.entries()).sort(([a], [b]) => a.localeCompare(b));
    const fileItems = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    const elements: ReactNode[] = [];

    for (const [folderName, child] of folderItems) {
      const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
      const isExpanded = expandedFolders.has(folderPath);
      elements.push(
        <div key={`folder-${folderPath}`}>
          <button
            onClick={() => toggleFolder(folderPath)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-gray-300 hover:bg-gray-800 transition-colors"
            style={{ paddingLeft: `${12 + depth * 14}px` }}
          >
            <span className="text-xs text-gray-500 w-3">{isExpanded ? '▾' : '▸'}</span>
            <span className="truncate">{folderName}</span>
          </button>
          {isExpanded && <div>{renderTree(child, folderPath, depth + 1)}</div>}
        </div>,
      );
    }

    for (const file of fileItems) {
      const displayName = file.name.split('/').at(-1) ?? file.name;
      elements.push(
        <div
          key={file.name}
          className={`group flex items-center px-3 py-1.5 cursor-pointer hover:bg-gray-800 transition-colors ${
            selectedFile === file.name ? 'bg-gray-800 border-l-2 border-blue-500' : 'border-l-2 border-transparent'
          }`}
          style={{ paddingLeft: `${24 + depth * 14}px` }}
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
                {displayName}
              </span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); startRename(file); }}
                  className="text-gray-400 hover:text-white p-0.5"
                  title="Rename"
                  aria-label={`Rename ${file.name}`}
                >
                  ✎
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                  className="text-gray-500 hover:text-red-400 p-0.5"
                  title="Delete"
                  aria-label={`Delete ${file.name}`}
                >
                  ✕
                </button>
              </div>
            </>
          )}
        </div>,
      );
    }

    return elements;
  }

  return (
    <aside className="flex flex-col h-full bg-gray-900 text-gray-100 w-80 shrink-0 border-r border-gray-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePasteFromClipboard}
            className="text-gray-400 hover:text-white transition-colors"
            title="Paste from clipboard"
            aria-label="Paste from clipboard"
          >
            📋
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-400 hover:text-white transition-colors"
            title="Upload file"
            aria-label="Upload file"
          >
            ⤴
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,text/plain,text/markdown"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => { setShowNewInput(true); setClipboardContent(null); setError(null); }}
            className="text-gray-400 hover:text-white transition-colors"
            title="New file"
            aria-label="New file"
          >
            ＋
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-gray-700 space-y-2">
        <input
          type="text"
          value={pathSearch}
          onChange={(e) => setPathSearch(e.target.value)}
          placeholder="Filter by path"
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            aria-label="Modified from date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            aria-label="Modified to date"
          />
        </div>
        <input
          type="text"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          placeholder="Filter by filename"
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        />
      </div>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {showNewInput && (
        <div className="px-3 py-2 border-b border-gray-700">
          {clipboardContent !== null && (
            <div className="text-xs text-blue-400 mb-1.5">Clipboard content ready</div>
          )}
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') resetNewInput();
            }}
            placeholder="folder/filename.md"
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
              onClick={resetNewInput}
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
        {!isLoading && filteredFiles.length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-500">No matching files</div>
        )}
        {!isLoading && renderTree(tree)}
      </div>
    </aside>
  );
}
