'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from './Sidebar';
import PreviewPane from './PreviewPane';
import Toolbar from './Toolbar';
import CompareView from './CompareView';
import DiffView from './DiffView';
import DocumentDashboard from './DocumentDashboard';
import { useFileContent } from '@/hooks/useFileContent';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useDocuments } from '@/hooks/useDocuments';
import type { Revision, RevisionInlineNote } from '@/types';
import { RevisionStatus } from '@/types';
import { useFiles } from '@/hooks/useFiles';
import { buildFileApiPath } from '@/lib/fileApiPath';

// CodeMirror accesses browser APIs — must be dynamically imported with ssr:false
const EditorPane = dynamic(() => import('./EditorPane'), { ssr: false });

const DEFAULT_STATUS_PIPELINE = ['Draft', 'In Review', 'Approved', 'Published'];
const DEFAULT_REQUIRED_FIELDS = {
  note: true,
  status: true,
  tags: false,
};
const PIPELINE_STORAGE_KEY = 'scce.statusPipeline';
const REQUIRED_FIELDS_STORAGE_KEY = 'scce.requiredMetaFields';

interface RevisionSummary {
  addedChars: number;
  removedChars: number;
  addedHeadings: number;
  removedHeadings: number;
}

function computeCharChanges(previousContent: string, nextContent: string): Pick<RevisionSummary, 'addedChars' | 'removedChars'> {
  let i = 0;
  const minLen = Math.min(previousContent.length, nextContent.length);
  while (i < minLen && previousContent[i] === nextContent[i]) {
    i += 1;
  }

  let j = 0;
  while (
    j < minLen - i &&
    previousContent[previousContent.length - 1 - j] === nextContent[nextContent.length - 1 - j]
  ) {
    j += 1;
  }

  return {
    removedChars: Math.max(0, previousContent.length - i - j),
    addedChars: Math.max(0, nextContent.length - i - j),
  };
}

function extractHeadings(content: string): Set<string> {
  const matches = content.match(/^#{1,6}\s+(.+)$/gm) ?? [];
  return new Set(matches.map((value) => value.trim().toLowerCase()));
}

function computeRevisionSummary(previous: Revision | undefined, current: Revision): RevisionSummary {
  const previousContent = previous?.content ?? '';
  const { addedChars, removedChars } = computeCharChanges(previousContent, current.content);
  const previousHeadings = extractHeadings(previousContent);
  const currentHeadings = extractHeadings(current.content);

  let addedHeadings = 0;
  let removedHeadings = 0;

  currentHeadings.forEach((heading) => {
    if (!previousHeadings.has(heading)) {
      addedHeadings += 1;
    }
  });
  previousHeadings.forEach((heading) => {
    if (!currentHeadings.has(heading)) {
      removedHeadings += 1;
    }
  });

  return { addedChars, removedChars, addedHeadings, removedHeadings };
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function EditorPage() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [documentMode, setDocumentMode] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [status, setStatus] = useState<RevisionStatus | ''>('');
  const [statusPipeline, setStatusPipeline] = useState<string[]>(DEFAULT_STATUS_PIPELINE);
  const [statusPipelineInput, setStatusPipelineInput] = useState(DEFAULT_STATUS_PIPELINE.join(' → '));
  const [requiredFields, setRequiredFields] = useState(DEFAULT_REQUIRED_FIELDS);
  const [checkpointWarning, setCheckpointWarning] = useState<string | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<string[]>([]);
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [inlineNoteMessage, setInlineNoteMessage] = useState('');
  const [inlineNoteLine, setInlineNoteLine] = useState('');
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const { files } = useFiles();
  const [workingDraftByFile, setWorkingDraftByFile] = useState<Record<string, string>>({});
  const [lastCheckpointAtByFile, setLastCheckpointAtByFile] = useState<Record<string, string>>({});
  const [jumpToHeadingToken, setJumpToHeadingToken] = useState('');

  const { content: loadedContent, revisions, isLoading, saveContent, updateRevisionInlineNotes } = useFileContent(selectedFile);
  const {
    documents,
    isLoading: isDocumentsLoading,
    promoteRevision,
    addComment,
  } = useDocuments();
  const prevFileRef = useRef<string | null>(null);

  const parsedTags = useMemo(
    () => tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tagsInput],
  );
  const statusOptions = useMemo(
    () => statusPipeline.map((value) => ({ value, label: value })),
    [statusPipeline],
  );
  const missingRequiredFields = useMemo(() => {
    const missing: string[] = [];
    if (requiredFields.note && revisionNote.trim().length === 0) missing.push('Note');
    if (requiredFields.status && status.trim().length === 0) missing.push('Status');
    if (requiredFields.tags && parsedTags.length === 0) missing.push('At least one tag');
    return missing;
  }, [parsedTags.length, requiredFields.note, requiredFields.status, requiredFields.tags, revisionNote, status]);

  useEffect(() => {
    const rawPipeline = window.localStorage.getItem(PIPELINE_STORAGE_KEY);
    if (rawPipeline) {
      try {
        const parsed = JSON.parse(rawPipeline) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.map((item) => item.trim()).filter(Boolean).slice(0, 12);
          if (cleaned.length > 0) {
            setStatusPipeline(cleaned);
            setStatusPipelineInput(cleaned.join(' → '));
          }
        }
      } catch {
        // noop
      }
    }

    const rawRequired = window.localStorage.getItem(REQUIRED_FIELDS_STORAGE_KEY);
    if (rawRequired) {
      try {
        const parsed = JSON.parse(rawRequired) as Partial<typeof DEFAULT_REQUIRED_FIELDS>;
        setRequiredFields((prev) => ({
          note: typeof parsed.note === 'boolean' ? parsed.note : prev.note,
          status: typeof parsed.status === 'boolean' ? parsed.status : prev.status,
          tags: typeof parsed.tags === 'boolean' ? parsed.tags : prev.tags,
        }));
      } catch {
        // noop
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(statusPipeline));
  }, [statusPipeline]);

  useEffect(() => {
    window.localStorage.setItem(REQUIRED_FIELDS_STORAGE_KEY, JSON.stringify(requiredFields));
  }, [requiredFields]);

  useEffect(() => {
    let cancelled = false;

    async function loadKnownTags() {
      if (files.length === 0) {
        if (!cancelled) setKnownTags([]);
        return;
      }

      const tagSet = new Set<string>();
      await Promise.all(
        files.map(async (file) => {
          try {
            const res = await fetch(buildFileApiPath(file.name));
            if (!res.ok) return;
            const payload = (await res.json()) as { revisions?: Array<{ tags?: string[] }> };
            payload.revisions?.forEach((revision) => {
              revision.tags?.forEach((tag) => {
                const cleaned = tag.trim().toLowerCase();
                if (cleaned) tagSet.add(cleaned);
              });
            });
          } catch {
            // noop
          }
        }),
      );

      if (!cancelled) {
        setKnownTags(Array.from(tagSet).sort((a, b) => a.localeCompare(b)));
      }
    }

    void loadKnownTags();

    return () => {
      cancelled = true;
    };
  }, [files]);

  const saveWorkingCopy = useCallback(async (draftContent: string) => {
    if (!selectedFile) return;
    setWorkingDraftByFile((prev) => {
      if (prev[selectedFile] === draftContent) {
        return prev;
      }
      return { ...prev, [selectedFile]: draftContent };
    });
  }, [selectedFile]);

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
        setSelectedRevisionIds([]);
        setActiveRevisionId(null);
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

  useEffect(() => {
    setSelectedRevisionIds((prev) => prev.filter((id) => revisions.some((revision) => revision.id === id)).slice(-2));
    setActiveRevisionId((prev) => (prev && revisions.some((revision) => revision.id === prev) ? prev : null));
  }, [revisions]);

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
      await saveContent(checkpointContent, {
        note: revisionNote,
        tags: parsedTags,
        status: status || undefined,
      });
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
  const canSaveCheckpoint = isDirty && !isSaving && missingRequiredFields.length === 0;

  function handleContentChange(val: string) {
    setContent(val);
    setIsDirty(true);
  }

  const handleSaveCheckpoint = useCallback(async () => {
    if (!selectedFile || !isDirty) return;
    if (missingRequiredFields.length > 0) {
      setCheckpointWarning(`Complete required fields: ${missingRequiredFields.join(', ')}`);
      return;
    }
    setCheckpointWarning(null);
    await saveNow(content);
  }, [content, isDirty, missingRequiredFields, saveNow, selectedFile]);

  const handleContinueWorkingDraft = useCallback(async () => {
    await saveWorkingCopy(content);
  }, [content, saveWorkingCopy]);

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
      setCheckpointWarning(null);
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
  const revisionSummaries = useMemo(() => {
    const summaries: Record<string, RevisionSummary> = {};
    revisions.forEach((revision, idx) => {
      summaries[revision.id] = computeRevisionSummary(revisions[idx - 1], revision);
    });
    return summaries;
  }, [revisions]);
  const selectedRevisions = useMemo(
    () => selectedRevisionIds.map((id) => revisions.find((revision) => revision.id === id)).filter(Boolean) as Revision[],
    [revisions, selectedRevisionIds],
  );
  const comparisonA = selectedRevisions[0] ?? null;
  const comparisonB = selectedRevisions[1] ?? null;
  const activeRevision = useMemo(
    () => (activeRevisionId ? revisions.find((revision) => revision.id === activeRevisionId) ?? null : null),
    [activeRevisionId, revisions],
  );

  const restoreAsDraft = useCallback((revision: Revision) => {
    if (!selectedFile) return;
    setContent(revision.content);
    setRevisionNote(revision.note ?? '');
    setStatus(revision.status ?? '');
    setTagsInput((revision.tags ?? []).join(', '));
    setWorkingDraftByFile((prev) => ({ ...prev, [selectedFile]: revision.content }));
    setIsDirty(true);
  }, [selectedFile]);

  const restoreAsCheckpoint = useCallback(async (revision: Revision) => {
    if (!selectedFile) return;
    const restoredAt = new Date().toLocaleString();
    await saveContent(revision.content, {
      note: `Restored checkpoint from ${new Date(revision.createdAt).toLocaleString()} at ${restoredAt}`,
      tags: revision.tags ?? [],
      status: revision.status,
    });
    setTimelineError(null);
    setLastCheckpointAtByFile((prev) => ({
      ...prev,
      [selectedFile]: new Date().toISOString(),
    }));
    setIsDirty(false);
  }, [saveContent, selectedFile]);

  const handleAddInlineNote = useCallback(async () => {
    if (!activeRevision || !inlineNoteMessage.trim()) return;
    try {
      const nextNotes: RevisionInlineNote[] = [
        ...(activeRevision.inlineNotes ?? []),
        {
          id: crypto.randomUUID(),
          message: inlineNoteMessage.trim(),
          lineNumber: inlineNoteLine ? Number(inlineNoteLine) : null,
          createdAt: new Date().toISOString(),
        },
      ];
      await updateRevisionInlineNotes(activeRevision.id, nextNotes);
      setInlineNoteMessage('');
      setInlineNoteLine('');
      setTimelineError(null);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : 'Could not add inline note');
    }
  }, [activeRevision, inlineNoteLine, inlineNoteMessage, updateRevisionInlineNotes]);

  function toggleRevisionSelection(revisionId: string) {
    setSelectedRevisionIds((prev) => {
      if (prev.includes(revisionId)) {
        return prev.filter((id) => id !== revisionId);
      }
      return [...prev, revisionId].slice(-2);
    });
    setActiveRevisionId(revisionId);
  }

  function applyStatusPipelineInput() {
    const next = statusPipelineInput
      .split(/->|→/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (next.length === 0) return;
    setStatusPipeline(next);
    if (status && !next.includes(status)) {
      setStatus(next[0]);
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
          onJumpToHeading={(heading) => setJumpToHeadingToken(`${Date.now()}::${heading}`)}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Toolbar
          filename={selectedFile}
          isDirty={isDirty}
          isSaving={isSaving}
          lastCheckpointAt={lastCheckpointAt}
          mobileView={mobileView}
          compareMode={compareMode}
          documentMode={documentMode}
          onMobileViewChange={setMobileView}
          onSaveCheckpoint={handleSaveCheckpoint}
          canSaveCheckpoint={canSaveCheckpoint}
          checkpointBlockReason={missingRequiredFields.length > 0 ? `Required: ${missingRequiredFields.join(', ')}` : undefined}
          onContinueWorkingDraft={handleContinueWorkingDraft}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onToggleCompare={() => {
            setCompareMode((m) => !m);
            setDocumentMode(false);
          }}
          onToggleDocumentDashboard={() => {
            setDocumentMode((mode) => !mode);
            setCompareMode(false);
          }}
        />

        {documentMode ? (
          <DocumentDashboard
            documents={documents}
            isLoading={isDocumentsLoading}
            onPromote={(documentId, revisionId) => promoteRevision(documentId, revisionId, 'canonical')}
            onSetAccepted={(documentId, revisionId) => promoteRevision(documentId, revisionId, 'accepted')}
            onSetDraft={(documentId, revisionId) => promoteRevision(documentId, revisionId, 'draft')}
            onAddComment={addComment}
            onSelectFile={setSelectedFile}
          />
        ) : compareMode ? (
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
                <PreviewPane content={content} jumpToHeadingToken={jumpToHeadingToken} />
              </div>
            </div>

            <aside className="hidden lg:flex w-80 border-l border-gray-700 bg-gray-900/70 flex-col overflow-hidden">
              <div className="p-3 border-b border-gray-700 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Revision details</h2>

                <label className="block text-xs text-gray-300">
                  Status pipeline
                  <div className="mt-1 flex gap-1.5">
                    <input
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100"
                      value={statusPipelineInput}
                      onChange={(e) => setStatusPipelineInput(e.target.value)}
                      placeholder="Draft → In Review → Approved → Published"
                    />
                    <button
                      type="button"
                      className="px-2 py-1 text-[11px] rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
                      onClick={applyStatusPipelineInput}
                    >
                      Apply
                    </button>
                  </div>
                </label>

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
                    {statusOptions.map((option) => (
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
                    list="known-tags"
                  />
                  <datalist id="known-tags">
                    {knownTags.map((tag) => (
                      <option key={tag} value={tag} />
                    ))}
                  </datalist>
                </label>

                <fieldset className="border border-gray-700 rounded p-2">
                  <legend className="px-1 text-[11px] uppercase tracking-wide text-gray-400">Required before checkpoint</legend>
                  <div className="mt-1 space-y-1.5 text-xs text-gray-200">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={requiredFields.note} onChange={(e) => setRequiredFields((prev) => ({ ...prev, note: e.target.checked }))} />
                      Note
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={requiredFields.status} onChange={(e) => setRequiredFields((prev) => ({ ...prev, status: e.target.checked }))} />
                      Status
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={requiredFields.tags} onChange={(e) => setRequiredFields((prev) => ({ ...prev, tags: e.target.checked }))} />
                      At least one tag
                    </label>
                  </div>
                </fieldset>

                {checkpointWarning && (
                  <p className="text-[11px] text-amber-300 bg-amber-900/30 border border-amber-700 rounded px-2 py-1.5">
                    {checkpointWarning}
                  </p>
                )}
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
                      className={`w-full text-left p-2 rounded border hover:bg-gray-800 ${
                        selectedRevisionIds.includes(revision.id)
                          ? 'border-blue-500 bg-blue-950/30'
                          : 'border-gray-700 bg-gray-900'
                      }`}
                      onClick={() => {
                        setRevisionNote(revision.note ?? '');
                        setStatus(revision.status ?? '');
                        setTagsInput((revision.tags ?? []).join(', '));
                        toggleRevisionSelection(revision.id);
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
                      <p className="mt-1 text-[10px] text-gray-400">
                        +{revisionSummaries[revision.id]?.addedChars ?? 0} / -{revisionSummaries[revision.id]?.removedChars ?? 0} chars
                        {' · '}
                        H+{revisionSummaries[revision.id]?.addedHeadings ?? 0} / H-{revisionSummaries[revision.id]?.removedHeadings ?? 0}
                      </p>
                    </button>
                  ))
                )}

                <p className="text-[11px] text-gray-500 pt-1">
                  Select exactly two revisions to inspect a side-by-side diff.
                </p>

                {activeRevision && (
                  <div className="mt-2 p-2 rounded border border-gray-700 bg-gray-900/60 space-y-2">
                    <h4 className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
                      Inline notes ({activeRevision.inlineNotes?.length ?? 0})
                    </h4>

                    {(activeRevision.inlineNotes ?? []).length === 0 ? (
                      <p className="text-[11px] text-gray-500">No inline notes for this revision.</p>
                    ) : (
                      <div className="space-y-1">
                        {(activeRevision.inlineNotes ?? []).map((note) => (
                          <div key={note.id} className="text-[11px] rounded bg-gray-800 px-2 py-1 text-gray-300">
                            <p className="text-gray-200">{note.message}</p>
                            <p className="text-gray-500">
                              {note.lineNumber ? `Line ${note.lineNumber}` : 'General'} · {new Date(note.createdAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    <label className="block text-[11px] text-gray-300">
                      Line number (optional)
                      <input
                        className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100"
                        value={inlineNoteLine}
                        onChange={(e) => setInlineNoteLine(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="e.g. 18"
                      />
                    </label>

                    <label className="block text-[11px] text-gray-300">
                      Note
                      <textarea
                        className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 resize-y min-h-16"
                        value={inlineNoteMessage}
                        onChange={(e) => setInlineNoteMessage(e.target.value)}
                        placeholder="Comment tied to this revision..."
                      />
                    </label>

                    <button
                      className="w-full text-xs rounded bg-gray-700 hover:bg-gray-600 px-2 py-1 text-gray-100 disabled:opacity-40"
                      disabled={!inlineNoteMessage.trim()}
                      onClick={handleAddInlineNote}
                    >
                      Add inline note
                    </button>

                    {timelineError && <p className="text-[11px] text-red-400">{timelineError}</p>}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>

      {comparisonA && comparisonB && (
        <div className="fixed inset-6 z-40 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl overflow-hidden flex flex-col">
          <div className="px-3 h-12 shrink-0 border-b border-gray-700 bg-gray-900 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-200 flex-1">Revision diff</h3>
            <button
              className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
              onClick={() => restoreAsDraft(comparisonB)}
            >
              Restore this revision as draft
            </button>
            <button
              className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
              onClick={() => restoreAsCheckpoint(comparisonB)}
            >
              Restore as new checkpoint
            </button>
            <button
              className="px-2 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
              onClick={() => setSelectedRevisionIds([])}
            >
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <DiffView
              contentA={comparisonA.content}
              contentB={comparisonB.content}
              filenameA={`A · ${new Date(comparisonA.createdAt).toLocaleString()}`}
              filenameB={`B · ${new Date(comparisonB.createdAt).toLocaleString()}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
