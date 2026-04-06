'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from './Sidebar';
import PreviewPane from './PreviewPane';
import Toolbar from './Toolbar';
import CompareView from './CompareView';
import DocumentDashboard from './DocumentDashboard';
import { useFileContent } from '@/hooks/useFileContent';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useDocuments } from '@/hooks/useDocuments';
import type { PublishHistoryEntry, PublishTargetProfile, Revision, RevisionInlineNote } from '@/types';
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

interface CommandItem {
  id: string;
  title: string;
  keywords?: string[];
  run: () => void | Promise<void>;
}

type ShortcutMap = Record<string, string>;

const DEFAULT_SHORTCUTS: ShortcutMap = {
  saveCheckpoint: 'Mod+S',
  commandPalette: 'Mod+K',
  createFile: 'Mod+N',
  openFilePalette: 'Mod+O',
  renameFile: 'Shift+Mod+R',
  createDailyNote: 'Shift+Mod+D',
};

const SHORTCUT_STORAGE_KEY = 'editor-shortcuts-v1';
const SHORTCUT_LABELS: Record<string, string> = {
  saveCheckpoint: 'Save checkpoint',
  commandPalette: 'Open command palette',
  createFile: 'Create file',
  openFilePalette: 'Find file',
  renameFile: 'Rename current file',
  createDailyNote: 'Create daily note',
};

const TEMPLATE_SNIPPETS: Array<{ id: string; title: string; content: (date: string) => string }> = [
  {
    id: 'meeting-notes',
    title: 'Meeting notes',
    content: (date) => `# Meeting Notes\n\n- Date: ${date}\n- Attendees:\n- Topic:\n\n## Agenda\n- \n\n## Notes\n- \n\n## Action Items\n- [ ] `,
  },
  {
    id: 'rfc',
    title: 'RFC',
    content: (date) => `# RFC: \n\n- Status: Draft\n- Owner:\n- Date: ${date}\n\n## Context\n\n## Proposal\n\n## Alternatives\n\n## Risks\n\n## Rollout plan`,
  },
  {
    id: 'changelog',
    title: 'Changelog',
    content: (date) => `# Changelog (${date})\n\n## Added\n- \n\n## Changed\n- \n\n## Fixed\n- `,
  },
];

function toDateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function parseShortcut(shortcut: string): { key: string; shift: boolean; alt: boolean; mod: boolean } | null {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1].toLowerCase();
  return {
    key,
    shift: parts.some((part) => part.toLowerCase() === 'shift'),
    alt: parts.some((part) => part.toLowerCase() === 'alt'),
    mod: parts.some((part) => part.toLowerCase() === 'mod'),
  };
}

function eventToShortcut(event: KeyboardEvent): string {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts: string[] = [];
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  parts.push(key);
  return parts.join('+');
}

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
  const { files, createFile, renameFile } = useFiles();
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
  const [workingDraftByFile, setWorkingDraftByFile] = useState<Record<string, string>>({});
  const [lastCheckpointAtByFile, setLastCheckpointAtByFile] = useState<Record<string, string>>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);
  const [capturingShortcutFor, setCapturingShortcutFor] = useState<string | null>(null);
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const [isOffline, setIsOffline] = useState(false);
  const [queuedCheckpoints, setQueuedCheckpoints] = useState<QueuedCheckpoint[]>([]);
  const [recoverableDrafts, setRecoverableDrafts] = useState<Record<string, string>>({});
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showStorageHealth, setShowStorageHealth] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const hasLoadedLocalStateRef = useRef(false);

  const [publishProfiles, setPublishProfiles] = useState<PublishTargetProfile[]>([]);
  const [publishProfileId, setPublishProfileId] = useState('docs-site');
  const [publishHistory, setPublishHistory] = useState<PublishHistoryEntry[]>([]);
  const [latestRevisionStatus, setLatestRevisionStatus] = useState<RevisionStatus | ''>('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string>('');
  const [jumpToHeadingToken, setJumpToHeadingToken] = useState<string>('');
  const [fileFilter, setFileFilter] = useState({ chapterSearch: '', metaSearch: '', dateFrom: '', dateTo: '' });

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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as ShortcutMap;
      setShortcuts((prev) => ({ ...prev, ...parsed }));
    } catch {
      // ignore malformed local settings
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    commandInputRef.current?.focus();
  }, [commandPaletteOpen]);

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

  useEffect(() => {
    async function loadPublishMetadata() {
      if (!selectedFile) {
        setPublishProfiles([]);
        setPublishHistory([]);
        setPublishMessage('');
        setLatestRevisionStatus('');
        return;
      }
      try {
        const res = await fetch(buildFilePublishApiPath(selectedFile));
        const payload = await res.json() as {
          profiles?: PublishTargetProfile[];
          history?: PublishHistoryEntry[];
          latestRevisionStatus?: RevisionStatus;
        };
        if (!res.ok) {
          throw new Error(payload && 'error' in payload ? String((payload as { error?: string }).error) : 'Could not load publish profiles');
        }
        setPublishProfiles(payload.profiles ?? []);
        setPublishHistory(payload.history ?? []);
        setLatestRevisionStatus(payload.latestRevisionStatus ?? '');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Could not load publish profiles';
        setPublishMessage(message);
      }
    }

    loadPublishMetadata();
  }, [selectedFile, revisions]);

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
  const canSaveCheckpoint = isDirty && !isSaving && missingRequiredFields.length === 0;

  const createNewFile = useCallback(async () => {
    const rawName = window.prompt('New file name', 'untitled');
    if (!rawName) return;
    const nextName = rawName.endsWith('.md') ? rawName : `${rawName}.md`;
    await createFile(nextName, '');
    setSelectedFile(nextName);
    setCommandPaletteOpen(false);
  }, [createFile]);

  const renameCurrentFile = useCallback(async () => {
    if (!selectedFile) return;
    const currentStem = selectedFile.replace(/\.md$/, '');
    const rawName = window.prompt('Rename file to', currentStem);
    if (!rawName) return;
    const nextName = rawName.endsWith('.md') ? rawName : `${rawName}.md`;
    await renameFile(selectedFile, nextName);
    handleFileRenamed(selectedFile, nextName);
    setCommandPaletteOpen(false);
  }, [renameFile, selectedFile]);

  const applyTemplate = useCallback((templateId: string) => {
    const template = TEMPLATE_SNIPPETS.find((item) => item.id === templateId);
    if (!template) return;
    setContent(template.content(toDateStamp()));
    setIsDirty(true);
    setCommandPaletteOpen(false);
  }, []);

  const createDailyNote = useCallback(async () => {
    const today = toDateStamp();
    const yesterday = toDateStamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const tomorrow = toDateStamp(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const filename = `daily/${today}.md`;
    const dailyTemplate = `# Daily note — ${today}\n\nPrev: [[daily/${yesterday}]]\nNext: [[daily/${tomorrow}]]\n\n## Priorities\n- \n\n## Journal\n- \n`;
    await createFile(filename, dailyTemplate);
    setSelectedFile(filename);
    setCommandPaletteOpen(false);
  }, [createFile]);

  const openFilePickerFromCommand = useCallback(() => {
    setCommandQuery('open ');
    setCommandPaletteOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function computeBacklinks() {
      if (!selectedFile || files.length === 0) {
        setBacklinks([]);
        return;
      }

      const exactLink = `[[${selectedFile}]]`;
      const noExtLink = `[[${selectedFile.replace(/\.md$/, '')}]]`;
      const found: string[] = [];

      await Promise.all(
        files.map(async (file) => {
          if (file.name === selectedFile) return;
          try {
            const res = await fetch(buildFileApiPath(file.name));
            if (!res.ok) return;
            const payload = (await res.json()) as { content?: string };
            const text = payload.content ?? '';
            if (text.includes(exactLink) || text.includes(noExtLink)) {
              found.push(file.name);
            }
          } catch {
            // ignore failed backlink fetch
          }
        }),
      );

      if (!cancelled) {
        found.sort((a, b) => a.localeCompare(b));
        setBacklinks(found);
      }
    }

    void computeBacklinks();
    return () => {
      cancelled = true;
    };
  }, [files, selectedFile]);
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

  // Keyboard shortcuts
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
      if (capturingShortcutFor) {
        e.preventDefault();
        if (e.key === 'Escape') {
          setCapturingShortcutFor(null);
          return;
        }
        const nextShortcut = eventToShortcut(e);
        setShortcuts((prev) => ({ ...prev, [capturingShortcutFor]: nextShortcut }));
        setCapturingShortcutFor(null);
        return;
      }

      if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
        return;
      }

      const entries = Object.entries(shortcuts);
      const matched = entries.find(([, shortcut]) => {
        const parsed = parseShortcut(shortcut);
        if (!parsed) return false;
        const keyMatches = e.key.toLowerCase() === parsed.key.toLowerCase();
        const modMatches = parsed.mod ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        return keyMatches
          && modMatches
          && e.shiftKey === parsed.shift
          && e.altKey === parsed.alt;
      });
      if (!matched) return;

      const [action] = matched;
      e.preventDefault();
      if (action === 'saveCheckpoint' && !isSaving) handleSaveCheckpoint();
      if (action === 'commandPalette') setCommandPaletteOpen(true);
      if (action === 'createFile') void createNewFile();
      if (action === 'openFilePalette') openFilePickerFromCommand();
      if (action === 'renameFile') void renameCurrentFile();
      if (action === 'createDailyNote') void createDailyNote();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    capturingShortcutFor,
    commandPaletteOpen,
    createDailyNote,
    createNewFile,
    handleSaveCheckpoint,
    isSaving,
    openFilePickerFromCommand,
    renameCurrentFile,
    shortcuts,
  ]);

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
      setPublishHistory([]);
      setPublishProfiles([]);
      setPublishMessage('');
      setLatestRevisionStatus('');
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
  const normalizedQuery = commandQuery.trim().toLowerCase();
  const openPrefix = normalizedQuery.startsWith('open ');
  const openTerm = openPrefix ? normalizedQuery.slice(5).trim() : '';
  const fileMatches = files
    .filter((file) => {
      if (!openPrefix) return true;
      return file.name.toLowerCase().includes(openTerm);
    })
    .slice(0, 10);

  const commandItems = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      {
        id: 'save',
        title: 'Save checkpoint',
        keywords: ['save'],
        run: () => handleSaveCheckpoint(),
      },
      {
        id: 'create',
        title: 'Create file',
        keywords: ['new'],
        run: () => createNewFile(),
      },
      {
        id: 'rename',
        title: 'Rename current file',
        keywords: ['rename'],
        run: () => renameCurrentFile(),
      },
      {
        id: 'daily-note',
        title: 'Create daily note',
        keywords: ['journal', 'today'],
        run: () => createDailyNote(),
      },
      {
        id: 'shortcuts',
        title: 'Customize keyboard shortcuts',
        keywords: ['hotkeys', 'keys'],
        run: () => {
          setShortcutEditorOpen(true);
          setCommandPaletteOpen(false);
        },
      },
    ];

    TEMPLATE_SNIPPETS.forEach((template) => {
      base.push({
        id: `template-${template.id}`,
        title: `Insert template: ${template.title}`,
        keywords: ['template', 'snippet'],
        run: () => applyTemplate(template.id),
      });
    });

    fileMatches.forEach((file) => {
      base.push({
        id: `open-${file.name}`,
        title: `Open: ${file.name}`,
        keywords: ['open', 'file'],
        run: () => {
          void handleFileSelect(file.name);
          setCommandPaletteOpen(false);
          setCommandQuery('');
        },
      });
    });

    if (!normalizedQuery) return base;
    return base.filter((command) => {
      const haystack = [command.title, ...(command.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [
    applyTemplate,
    createDailyNote,
    createNewFile,
    fileMatches,
    handleFileSelect,
    handleSaveCheckpoint,
    normalizedQuery,
    renameCurrentFile,
  ]);
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
          applyFilter={setFileFilter}
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
          documentMode={documentMode}
          onMobileViewChange={setMobileView}
          onSaveCheckpoint={handleSaveCheckpoint}
          canSaveCheckpoint={canSaveCheckpoint}
          checkpointBlockReason={missingRequiredFields.length > 0 ? `Required: ${missingRequiredFields.join(', ')}` : undefined}
          onContinueWorkingDraft={handleContinueWorkingDraft}
          onOpenRecoveryPanel={() => setShowRecoveryPanel(true)}
          onOpenStorageHealth={() => setShowStorageHealth(true)}
          onExportBackup={handleExportBackup}
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
          <CompareView
            selectedFile={selectedFile}
            onFileSelect={setSelectedFile}
            onDirtyChange={setCompareHasUnsavedChanges}
          />
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

              <div className="p-3 border-b border-gray-700 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Publishing pipeline</h2>
                <div className="grid grid-cols-3 gap-1.5">
                  <button onClick={() => handleExport('html')} className="rounded bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[11px] text-gray-200">Export HTML</button>
                  <button onClick={() => handleExport('pdf')} className="rounded bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[11px] text-gray-200">Export PDF</button>
                  <button onClick={() => handleExport('docx')} className="rounded bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[11px] text-gray-200">Export DOCX</button>
                </div>

                <label className="block text-xs text-gray-300">
                  Publish target
                  <select
                    className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100"
                    value={publishProfileId}
                    onChange={(e) => setPublishProfileId(e.target.value)}
                  >
                    {(publishProfiles.length
                      ? publishProfiles
                      : [{ id: 'docs-site', label: 'Docs site', description: 'Default docs site profile', type: 'docs-site' as const }]).map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.label}</option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={handlePublish}
                  disabled={isPublishing || latestRevisionStatus !== 'accepted'}
                  className="w-full rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 px-2 py-1.5 text-xs text-white"
                  title={latestRevisionStatus !== 'accepted' ? 'Mark latest revision as Accepted to enable one-click publish.' : 'Publish selected target from approved status'}
                >
                  {isPublishing ? 'Publishing…' : 'One-click publish (approved only)'}
                </button>

                <p className="text-[11px] text-gray-400">
                  Latest status: <span className="text-gray-200">{latestRevisionStatus || 'none'}</span>
                </p>
                {publishMessage && <p className="text-[11px] text-blue-300">{publishMessage}</p>}
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

                <div className="mt-4 border-t border-gray-700 pt-3 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Backlinks</h3>
                  {selectedFile ? (
                    backlinks.length === 0 ? (
                      <p className="text-xs text-gray-500">No backlinks yet. Add references like [[{selectedFile.replace(/\.md$/, '')}]].</p>
                    ) : (
                      backlinks.map((file) => (
                        <button
                          key={file}
                          onClick={() => void handleFileSelect(file)}
                          className="w-full text-left text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                        >
                          {file}
                        </button>
                      ))
                    )
                  ) : (
                    <p className="text-xs text-gray-500">Select a file to see backlinks.</p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {commandPaletteOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center pt-24 px-4">
          <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
            <input
              ref={commandInputRef}
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder="Type a command... (try `open foo`)"
              className="w-full bg-gray-900 px-4 py-3 text-sm border-b border-gray-700 outline-none"
            />
            <div className="max-h-80 overflow-y-auto p-2 space-y-1">
              {commandItems.length === 0 ? (
                <p className="text-xs text-gray-500 px-2 py-3">No matching commands.</p>
              ) : (
                commandItems.map((command) => (
                  <button
                    key={command.id}
                    onClick={() => void command.run()}
                    className="w-full text-left text-sm px-3 py-2 rounded hover:bg-gray-800 text-gray-100"
                  >
                    {command.title}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {shortcutEditorOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-100">Keyboard shortcuts</h3>
              <button
                onClick={() => setShortcutEditorOpen(false)}
                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
              >
                Close
              </button>
            </div>
            <div className="space-y-2">
              {Object.entries(SHORTCUT_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3 bg-gray-800/60 rounded px-3 py-2">
                  <span className="text-xs text-gray-200">{label}</span>
                  <button
                    onClick={() => setCapturingShortcutFor(key)}
                    className="text-xs font-mono px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 min-w-28"
                  >
                    {capturingShortcutFor === key ? 'Press keys...' : shortcuts[key]}
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShortcuts(DEFAULT_SHORTCUTS)}
              className="mt-3 text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
            >
              Reset defaults
            </button>
          </div>
        </div>
      )}

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
