'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from './Sidebar';
import PreviewPane from './PreviewPane';
import Toolbar from './Toolbar';
import CompareView from './CompareView';
import { useFileContent } from '@/hooks/useFileContent';
import { useAutoSave } from '@/hooks/useAutoSave';

// CodeMirror accesses browser APIs — must be dynamically imported with ssr:false
const EditorPane = dynamic(() => import('./EditorPane'), { ssr: false });

export default function EditorPage() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [workingDraftByFile, setWorkingDraftByFile] = useState<Record<string, string>>({});
  const [lastCheckpointAtByFile, setLastCheckpointAtByFile] = useState<Record<string, string>>({});

  const { content: loadedContent, isLoading, saveContent } = useFileContent(selectedFile);
  const prevFileRef = useRef<string | null>(null);

  const saveWorkingCopy = useCallback(async (draftContent: string) => {
    if (!selectedFile) return;
    setWorkingDraftByFile((prev) => {
      if (prev[selectedFile] === draftContent) {
        return prev;
      }
      return { ...prev, [selectedFile]: draftContent };
    });
  }, [selectedFile]);

  // When loaded content changes (new file selected), update editor from working draft if present.
  useEffect(() => {
    if (selectedFile !== prevFileRef.current) {
      prevFileRef.current = selectedFile;
      if (!selectedFile) {
        setContent('');
        setIsDirty(false);
        return;
      }

      const draft = workingDraftByFile[selectedFile];
      if (typeof draft === 'string') {
        setContent(draft);
        setIsDirty(draft !== loadedContent);
      } else {
        setContent(loadedContent);
        setIsDirty(false);
      }
    }
  }, [loadedContent, selectedFile, workingDraftByFile]);

  const { isSaving, saveNow } = useAutoSave({
    content,
    filename: selectedFile,
    isDirty,
    saveWorkingCopyFn: saveWorkingCopy,
    saveCheckpointFn: async (checkpointContent) => {
      if (!selectedFile) return;
      await saveContent(checkpointContent);
      setWorkingDraftByFile((prev) => {
        const next = { ...prev };
        delete next[selectedFile];
        return next;
      });
      setLastCheckpointAtByFile((prev) => ({
        ...prev,
        [selectedFile]: new Date().toISOString(),
      }));
      setIsDirty(false);
    },
  });

  function handleContentChange(val: string) {
    setContent(val);
    setIsDirty(true);
  }

  const handleSaveCheckpoint = useCallback(async () => {
    if (!selectedFile || !isDirty) return;
    await saveNow(content);
  }, [content, isDirty, selectedFile, saveNow]);

  const handleContinueWorkingDraft = useCallback(async () => {
    await saveWorkingCopy(content);
  }, [content, saveWorkingCopy]);

  // Ctrl+S to save checkpoint revision
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveCheckpoint();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveCheckpoint]);

  async function handleFileSelect(filename: string) {
    // Persist current edits to working buffer before switching files.
    if (selectedFile && isDirty) {
      await saveWorkingCopy(content);
    }
    setSelectedFile(filename);
    setSidebarOpen(false);
  }

  function handleFileDeleted(filename: string) {
    if (selectedFile === filename) {
      setSelectedFile(null);
      setContent('');
      setIsDirty(false);
    }

    setWorkingDraftByFile((prev) => {
      if (!(filename in prev)) return prev;
      const next = { ...prev };
      delete next[filename];
      return next;
    });

    setLastCheckpointAtByFile((prev) => {
      if (!(filename in prev)) return prev;
      const next = { ...prev };
      delete next[filename];
      return next;
    });
  }

  function handleFileRenamed(oldName: string, newName: string) {
    if (selectedFile === oldName) {
      setSelectedFile(newName);
    }

    setWorkingDraftByFile((prev) => {
      if (!(oldName in prev)) return prev;
      const next = { ...prev, [newName]: prev[oldName] };
      delete next[oldName];
      return next;
    });

    setLastCheckpointAtByFile((prev) => {
      if (!(oldName in prev)) return prev;
      const next = { ...prev, [newName]: prev[oldName] };
      delete next[oldName];
      return next;
    });
  }

  const lastCheckpointAt = selectedFile ? lastCheckpointAtByFile[selectedFile] ?? null : null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-10 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
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

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Toolbar
          filename={selectedFile}
          isDirty={isDirty}
          isSaving={isSaving}
          lastCheckpointAt={lastCheckpointAt}
          mobileView={mobileView}
          compareMode={compareMode}
          onMobileViewChange={setMobileView}
          onSaveCheckpoint={handleSaveCheckpoint}
          onContinueWorkingDraft={handleContinueWorkingDraft}
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
            {/* Editor — always shown on desktop, toggled on mobile */}
            <div className={`flex-1 flex overflow-hidden ${mobileView === 'preview' ? 'hidden md:flex' : 'flex'}`}>
              <EditorPane value={content} onChange={handleContentChange} />
            </div>

            {/* Divider — desktop only */}
            <div className="hidden md:block w-px bg-gray-700 shrink-0" />

            {/* Preview — always shown on desktop, toggled on mobile */}
            <div className={`flex-1 flex overflow-hidden ${mobileView === 'edit' ? 'hidden md:flex' : 'flex'}`}>
              <PreviewPane content={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
