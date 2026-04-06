'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from './Sidebar';
import PreviewPane from './PreviewPane';
import Toolbar from './Toolbar';
import CompareView from './CompareView';
import { useFileContent } from '@/hooks/useFileContent';
import { useAutoSave } from '@/hooks/useAutoSave';
import { RevisionStatus } from '@/types';

// CodeMirror accesses browser APIs — must be dynamically imported with ssr:false
const EditorPane = dynamic(() => import('./EditorPane'), { ssr: false });

const STATUS_OPTIONS: Array<{ value: RevisionStatus; label: string }> = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'needs-review', label: 'Needs review' },
];

export default function EditorPage() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [status, setStatus] = useState<RevisionStatus | ''>('');

  const { content: loadedContent, revisions, isLoading, saveContent } = useFileContent(selectedFile);
  const prevFileRef = useRef<string | null>(null);

  const parsedTags = useMemo(
    () => tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tagsInput],
  );

  // When loaded content changes (new file selected), update editor content
  useEffect(() => {
    if (selectedFile !== prevFileRef.current) {
      prevFileRef.current = selectedFile;
      setContent(loadedContent);
      setIsDirty(false);
      const latestRevision = revisions.at(-1);
      setRevisionNote(latestRevision?.note ?? '');
      setStatus(latestRevision?.status ?? '');
      setTagsInput((latestRevision?.tags ?? []).join(', '));
    }
  }, [loadedContent, revisions, selectedFile]);

  const { isSaving, saveNow } = useAutoSave({
    content,
    filename: selectedFile,
    isDirty,
    saveFn: async (c) => {
      await saveContent(c, { note: revisionNote, tags: parsedTags, status: status || undefined });
      setIsDirty(false);
    },
  });

  function handleContentChange(val: string) {
    setContent(val);
    setIsDirty(true);
  }

  const handleSaveNow = useCallback(async () => {
    if (!selectedFile || !isDirty) return;
    await saveNow(content);
    setIsDirty(false);
  }, [content, isDirty, selectedFile, saveNow]);

  // Ctrl+S to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveNow();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveNow]);

  async function handleFileSelect(filename: string) {
    // Auto-save current file before switching
    if (selectedFile && isDirty) {
      await saveContent(content, { note: revisionNote, tags: parsedTags, status: status || undefined }).catch(() => {});
    }
    setSelectedFile(filename);
    setSidebarOpen(false);
  }

  function handleFileDeleted(filename: string) {
    if (selectedFile === filename) {
      setSelectedFile(null);
      setContent('');
      setIsDirty(false);
      setRevisionNote('');
      setTagsInput('');
      setStatus('');
    }
  }

  function handleFileRenamed(oldName: string, newName: string) {
    if (selectedFile === oldName) {
      setSelectedFile(newName);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-10 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`
          fixed md:static inset-y-0 left-0 z-20
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        <Sidebar
          selectedFile={selectedFile}
          onFileSelect={handleFileSelect}
          onFileDeleted={handleFileDeleted}
          onFileRenamed={handleFileRenamed}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Toolbar
          filename={selectedFile}
          isDirty={isDirty}
          isSaving={isSaving}
          mobileView={mobileView}
          compareMode={compareMode}
          onMobileViewChange={setMobileView}
          onSave={handleSaveNow}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onToggleCompare={() => setCompareMode((m) => !m)}
        />

        {compareMode ? (
          <CompareView />
        ) : !selectedFile ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Select a file or create a new one</p>
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Loading...
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
              <div className={`flex-1 flex overflow-hidden ${mobileView === 'preview' ? 'hidden md:flex' : 'flex'}`}>
                <EditorPane value={content} onChange={handleContentChange} />
              </div>

              <div className="hidden md:block w-px bg-gray-700 shrink-0" />

              <div className={`flex-1 flex overflow-hidden ${mobileView === 'edit' ? 'hidden md:flex' : 'flex'}`}>
                <PreviewPane content={content} />
              </div>
            </div>

            <aside className="hidden lg:flex w-80 border-l border-gray-700 bg-gray-900/70 flex-col overflow-hidden">
              <div className="p-3 border-b border-gray-700 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Revision details</h2>

                <label className="block text-xs text-gray-300">
                  Note
                  <textarea
                    className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 resize-y min-h-20"
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                    placeholder="Why this revision exists..."
                  />
                </label>

                <label className="block text-xs text-gray-300">
                  Status
                  <select
                    className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100"
                    value={status}
                    onChange={(e) => setStatus((e.target.value as RevisionStatus) || '')}
                  >
                    <option value="">No status</option>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs text-gray-300">
                  Tags (comma separated)
                  <input
                    className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="planning, scope"
                  />
                </label>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 sticky top-0 bg-gray-900 py-1">
                  Revision timeline
                </h3>

                {revisions.length === 0 ? (
                  <p className="text-xs text-gray-500">No revisions yet. Save this file to create one.</p>
                ) : (
                  [...revisions].reverse().map((revision) => (
                    <button
                      key={revision.id}
                      className="w-full text-left p-2 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800"
                      onClick={() => {
                        setRevisionNote(revision.note ?? '');
                        setStatus(revision.status ?? '');
                        setTagsInput((revision.tags ?? []).join(', '));
                      }}
                    >
                      <p className="text-[11px] text-gray-500">
                        {new Date(revision.createdAt).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-200 mt-1 line-clamp-3">
                        {revision.note || 'No note'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {revision.status && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900 text-blue-200">
                            {revision.status}
                          </span>
                        )}
                        {revision.tags?.map((tag) => (
                          <span key={`${revision.id}-${tag}`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-200">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
