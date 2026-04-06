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

const LOCAL_DRAFT_KEY = 'scce:working-drafts:v1';
const LOCAL_QUEUE_KEY = 'scce:checkpoint-queue:v1';

interface QueuedCheckpoint {
  id: string;
  filename: string;
  content: string;
  note: string;
  tags: string[];
  status?: RevisionStatus;
  queuedAt: string;
}

function readLocalJson<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(storageKey: string, value: T): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

// Main component export: this is the entry point rendered by parent routes/components.
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
  const [workingDraftByFile, setWorkingDraftByFile] = useState<Record<string, string>>({});
  const [lastCheckpointAtByFile, setLastCheckpointAtByFile] = useState<Record<string, string>>({});
  const [isOffline, setIsOffline] = useState(false);
  const [queuedCheckpoints, setQueuedCheckpoints] = useState<QueuedCheckpoint[]>([]);
  const [recoverableDrafts, setRecoverableDrafts] = useState<Record<string, string>>({});
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showStorageHealth, setShowStorageHealth] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const hasLoadedLocalStateRef = useRef(false);

  const { content: loadedContent, revisions, isLoading, saveContent } = useFileContent(selectedFile);
  const prevFileRef = useRef<string | null>(null);

  const parsedTags = useMemo(
    () => tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tagsInput],
  );

  useEffect(() => {
    const initialOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
    setIsOffline(initialOffline);
    setQueuedCheckpoints(readLocalJson<QueuedCheckpoint[]>(LOCAL_QUEUE_KEY, []));
    const drafts = readLocalJson<Record<string, string>>(LOCAL_DRAFT_KEY, {});
    setWorkingDraftByFile(drafts);
    setRecoverableDrafts(drafts);
    setShowRecoveryPanel(Object.keys(drafts).length > 0);
    hasLoadedLocalStateRef.current = true;

    function handleOnline() {
      setIsOffline(false);
    }

    function handleOffline() {
      setIsOffline(true);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedLocalStateRef.current) return;
    writeLocalJson(LOCAL_DRAFT_KEY, workingDraftByFile);
  }, [workingDraftByFile]);

  useEffect(() => {
    if (!hasLoadedLocalStateRef.current) return;
    writeLocalJson(LOCAL_QUEUE_KEY, queuedCheckpoints);
  }, [queuedCheckpoints]);

  const saveWorkingCopy = useCallback(async (draftContent: string) => {
    if (!selectedFile) return;
    setWorkingDraftByFile((prev) => {
      if (prev[selectedFile] === draftContent) {
        return prev;
      }
      return { ...prev, [selectedFile]: draftContent };
    });
  }, [selectedFile]);

  const queueCheckpoint = useCallback((checkpointContent: string) => {
    if (!selectedFile) return;
    const queued: QueuedCheckpoint = {
      id: crypto.randomUUID(),
      filename: selectedFile,
      content: checkpointContent,
      note: revisionNote,
      tags: parsedTags,
      status: status || undefined,
      queuedAt: new Date().toISOString(),
    };
    setQueuedCheckpoints((prev) => [...prev, queued]);
    setLastCheckpointAtByFile((prev) => ({
      ...prev,
      [selectedFile]: queued.queuedAt,
    }));
    setIsDirty(false);
  }, [parsedTags, revisionNote, selectedFile, status]);

  // When file selection changes, update editor from working draft if present and sync revision metadata.
  useEffect(() => {
    if (selectedFile !== prevFileRef.current) {
      prevFileRef.current = selectedFile;
      const latestRevision = revisions.at(-1);
      setRevisionNote(latestRevision?.note ?? '');
      setStatus(latestRevision?.status ?? '');
      setTagsInput((latestRevision?.tags ?? []).join(', '));

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
  }, [loadedContent, revisions, selectedFile, workingDraftByFile]);

  // Keep editor content in sync once async file content loads, but never clobber unsaved edits.
  useEffect(() => {
    if (!selectedFile) return;
    if (isDirty) return;

    const draft = workingDraftByFile[selectedFile];
    if (typeof draft === 'string') return;

    setContent(loadedContent);
  }, [isDirty, loadedContent, selectedFile, workingDraftByFile]);

  const { isSaving, saveNow } = useAutoSave({
    content,
    filename: selectedFile,
    isDirty,
    saveWorkingCopyFn: saveWorkingCopy,
    saveCheckpointFn: async (checkpointContent) => {
      if (!selectedFile) return;
      if (isOffline) {
        queueCheckpoint(checkpointContent);
        return;
      }

      try {
        await saveContent(checkpointContent, {
          note: revisionNote,
          tags: parsedTags,
          status: status || undefined,
        });
      } catch (err: unknown) {
        const maybeNetworkError = err as { message?: string };
        if (maybeNetworkError?.message?.toLowerCase().includes('fetch')) {
          queueCheckpoint(checkpointContent);
          setIsOffline(true);
          return;
        }
        throw err;
      }
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

  useEffect(() => {
    if (isOffline || queuedCheckpoints.length === 0) return;
    let cancelled = false;

    async function flushQueue() {
      setOpsError(null);
      for (const item of queuedCheckpoints) {
        if (cancelled) return;
        try {
          await saveContent(item.content, {
            note: item.note,
            tags: item.tags,
            status: item.status,
          });
          setQueuedCheckpoints((prev) => prev.filter((queued) => queued.id !== item.id));
        } catch (err: unknown) {
          const e = err as { message?: string };
          setOpsError(e.message ?? 'Could not sync queued checkpoints');
          if (e.message?.toLowerCase().includes('fetch')) {
            setIsOffline(true);
          }
          return;
        }
      }
    }

    flushQueue();
    return () => {
      cancelled = true;
    };
  }, [isOffline, queuedCheckpoints, saveContent]);

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

  const handleRestoreDraft = useCallback((filename: string) => {
    const nextDraft = recoverableDrafts[filename];
    if (typeof nextDraft !== 'string') return;
    setWorkingDraftByFile((prev) => ({ ...prev, [filename]: nextDraft }));
    if (selectedFile === filename) {
      setContent(nextDraft);
      setIsDirty(true);
    }
  }, [recoverableDrafts, selectedFile]);

  const handleDismissRecoveredDraft = useCallback((filename: string) => {
    setRecoverableDrafts((prev) => {
      if (!(filename in prev)) return prev;
      const next = { ...prev };
      delete next[filename];
      writeLocalJson(LOCAL_DRAFT_KEY, next);
      return next;
    });
  }, []);

  const handleExportBackup = useCallback(async () => {
    setIsExporting(true);
    setOpsError(null);
    try {
      const filesRes = await fetch('/api/files');
      if (!filesRes.ok) throw new Error('Could not load files for backup');
      const payload = (await filesRes.json()) as { files?: Array<{ name: string }> };
      const files = payload.files ?? [];

      const items = await Promise.all(
        files.map(async (file) => {
          const res = await fetch(`/api/files/${file.name.split('/').map(encodeURIComponent).join('/')}`);
          if (!res.ok) {
            return { name: file.name, error: 'Could not load this file' };
          }
          const data = (await res.json()) as {
            content?: string;
            revisions?: Array<{
              id: string;
              createdAt: string;
              content: string;
              note: string;
              tags?: string[];
              status?: RevisionStatus;
            }>;
          };
          return {
            name: file.name,
            content: data.content ?? '',
            revisions: data.revisions ?? [],
          };
        }),
      );

      const backup = {
        exportedAt: new Date().toISOString(),
        queuedCheckpoints,
        workingDraftByFile,
        files: items,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scce-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setOpsError(e.message ?? 'Backup export failed');
    } finally {
      setIsExporting(false);
    }
  }, [queuedCheckpoints, workingDraftByFile]);

  const storageHealth = useMemo(() => {
    const notesCount = Object.keys(workingDraftByFile).length;
    const staleRevisions = queuedCheckpoints.filter((item) => {
      const ageMs = Date.now() - new Date(item.queuedAt).getTime();
      return ageMs > 1000 * 60 * 60 * 24;
    }).length;

    let draftBytes = 0;
    Object.values(workingDraftByFile).forEach((draft) => {
      draftBytes += new Blob([draft]).size;
    });
    const queueBytes = new Blob([JSON.stringify(queuedCheckpoints)]).size;

    return {
      notesCount,
      queuedCount: queuedCheckpoints.length,
      staleRevisions,
      blobCount: Object.keys(workingDraftByFile).length + queuedCheckpoints.length,
      approximateBytes: draftBytes + queueBytes,
    };
  }, [queuedCheckpoints, workingDraftByFile]);

  // Ctrl+S to save checkpoint revision
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!isSaving) handleSaveCheckpoint();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveCheckpoint, isSaving]);

  async function handleFileSelect(filename: string) {
    // Persist current edits to local working-draft buffer before switching files.
    // Do not create a backend revision on switch; checkpoint saves are explicit.
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
      setRevisionNote('');
      setTagsInput('');
      setStatus('');
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
          lastCheckpointAt={lastCheckpointAt}
          isOffline={isOffline}
          queuedSyncCount={queuedCheckpoints.length}
          mobileView={mobileView}
          compareMode={compareMode}
          onMobileViewChange={setMobileView}
          onSaveCheckpoint={handleSaveCheckpoint}
          onContinueWorkingDraft={handleContinueWorkingDraft}
          onOpenRecoveryPanel={() => setShowRecoveryPanel(true)}
          onOpenStorageHealth={() => setShowStorageHealth(true)}
          onExportBackup={handleExportBackup}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onToggleCompare={() => setCompareMode((m) => !m)}
        />

        {opsError && (
          <div className="mx-3 mt-2 px-3 py-2 rounded border border-red-700 bg-red-950/40 text-xs text-red-200">
            {opsError}
          </div>
        )}
        {isExporting && (
          <div className="mx-3 mt-2 px-3 py-2 rounded border border-blue-700 bg-blue-950/40 text-xs text-blue-200">
            Building backup export…
          </div>
        )}

        {compareMode ? (
          <CompareView selectedFile={selectedFile} onFileSelect={setSelectedFile} />
        ) : !selectedFile ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Select a file or create a new one</p>
            <p className="text-xs text-gray-600">You can also upload or drag files in when no file is selected.</p>
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

      {showRecoveryPanel && (
        <div className="fixed inset-0 z-40 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-lg shadow-xl">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-100">Restore unsaved drafts</h2>
              <button
                className="text-xs text-gray-400 hover:text-gray-200"
                onClick={() => setShowRecoveryPanel(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
              {Object.keys(recoverableDrafts).length === 0 ? (
                <p className="text-xs text-gray-400">No recoverable drafts found from previous sessions.</p>
              ) : (
                Object.entries(recoverableDrafts).map(([filename, draft]) => (
                  <div key={filename} className="border border-gray-700 rounded p-3 bg-gray-950">
                    <p className="text-xs text-gray-200">{filename}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">
                      {draft.slice(0, 180) || 'Empty draft'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500"
                        onClick={() => handleRestoreDraft(filename)}
                      >
                        Restore
                      </button>
                      <button
                        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
                        onClick={() => handleDismissRecoveredDraft(filename)}
                      >
                        Dismiss
                      </button>
                      <button
                        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
                        onClick={() => setSelectedFile(filename)}
                      >
                        Open file
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showStorageHealth && (
        <div className="fixed inset-0 z-40 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-lg shadow-xl">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-100">Storage health</h2>
              <button
                className="text-xs text-gray-400 hover:text-gray-200"
                onClick={() => setShowStorageHealth(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-xs">
              <div className="border border-gray-700 rounded p-3">
                <p className="text-gray-400">Blobs</p>
                <p className="text-lg text-gray-100">{storageHealth.blobCount}</p>
              </div>
              <div className="border border-gray-700 rounded p-3">
                <p className="text-gray-400">Notes</p>
                <p className="text-lg text-gray-100">{storageHealth.notesCount}</p>
              </div>
              <div className="border border-gray-700 rounded p-3">
                <p className="text-gray-400">Queued sync items</p>
                <p className="text-lg text-gray-100">{storageHealth.queuedCount}</p>
              </div>
              <div className="border border-gray-700 rounded p-3">
                <p className="text-gray-400">Stale revisions (&gt;24h)</p>
                <p className="text-lg text-gray-100">{storageHealth.staleRevisions}</p>
              </div>
              <div className="col-span-2 border border-gray-700 rounded p-3">
                <p className="text-gray-400">Approximate local storage bytes</p>
                <p className="text-lg text-gray-100">{storageHealth.approximateBytes.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
