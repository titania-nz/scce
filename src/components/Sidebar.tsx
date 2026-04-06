'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { FileContentResponse, FileEntry } from '@/types';
import { buildFileApiPath } from '@/lib/fileApiPath';

interface SidebarProps {
  selectedFile: string | null;
  onFileSelect: (filename: string) => void;
  onFileDeleted: (filename: string) => void;
  onFileRenamed: (oldName: string, newName: string) => void;
  onJumpToHeading: (heading: string) => void;
}

interface RevisionMeta {
  tags: string[];
  note: string;
  status: string;
}

interface RevisionItem {
  file: FileEntry;
  document: string;
  chapter: string;
  revisionOrder: number | null;
  revisionLabel: string;
  meta: RevisionMeta;
  createdAt: Date;
}

interface ChapterGroup {
  chapter: string;
  revisions: RevisionItem[];
}

interface DocumentGroup {
  document: string;
  chapters: ChapterGroup[];
}

interface HeadingItem {
  text: string;
  level: number;
}

interface SearchEntry {
  id: string;
  sourceType: 'current' | 'revision';
  file: FileEntry;
  document: string;
  chapter: string;
  revisionLabel: string;
  createdAt: Date;
  createdAtIso: string;
  tags: string[];
  status: string;
  note: string;
  content: string;
}

interface SearchResult {
  entry: SearchEntry;
  score: number;
  snippet: string;
}

const DEFAULT_META: RevisionMeta = {
  tags: [],
  note: '',
  status: '',
};

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function formatDate(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function makeUploadFilename(originalName: string, takenNames: Set<string>): string {
  const source = originalName.includes('.') ? originalName.replace(/\.[^.]*$/, '') : originalName;
  const sanitizedBase = source.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim() || 'upload';

  let candidate = `${sanitizedBase}.md`;
  let suffix = 1;
  while (takenNames.has(candidate)) {
    candidate = `${sanitizedBase}-${suffix}.md`;
    suffix += 1;
  }
  takenNames.add(candidate);
  return candidate;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith('---\n')) {
    return { frontmatter: '', body: content };
  }

  const endMarkerIndex = content.indexOf('\n---\n', 4);
  if (endMarkerIndex === -1) {
    return { frontmatter: '', body: content };
  }

  return {
    frontmatter: content.slice(4, endMarkerIndex),
    body: content.slice(endMarkerIndex + 5),
  };
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function parseMetaFromContent(content: string): RevisionMeta {
  if (!content) return DEFAULT_META;
  const { frontmatter, body } = splitFrontmatter(content);

  const tags = new Set<string>();
  let note = '';
  let status = '';

  if (frontmatter) {
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const [rawKey, ...valueParts] = line.split(':');
      if (!rawKey || valueParts.length === 0) continue;
      const key = rawKey.trim().toLowerCase();
      const rawValue = valueParts.join(':').trim();
      if (!rawValue) continue;

      if (key === 'status') {
        status = rawValue.replace(/^["']|["']$/g, '').toLowerCase();
      }

      if (key === 'note' || key === 'summary') {
        note = rawValue.replace(/^["']|["']$/g, '');
      }

      if (key === 'tag' || key === 'tags') {
        const cleaned = rawValue.replace(/^\[|\]$/g, '');
        cleaned
          .split(',')
          .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
          .forEach((tag) => tags.add(tag.toLowerCase()));
      }
    }
  }

  if (!note) {
    const firstBodyLine = body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#'));
    note = firstBodyLine ? firstBodyLine.slice(0, 120) : '';
  }

  if (tags.size === 0) {
    const tagMatches = body.match(/(^|\s)#([a-zA-Z0-9_-]+)/g) ?? [];
    tagMatches.forEach((match) => {
      const tag = match.trim().replace(/^#/, '').toLowerCase();
      if (tag) tags.add(tag);
    });
  }

  return {
    tags: Array.from(tags),
    note,
    status,
  };
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function parseFileStructure(fileName: string) {
  const normalized = fileName.replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  const stem = (parts[parts.length - 1] ?? normalized).replace(/\.md$/, '');
  const tokens = stem.split(/[\s._-]+/).filter(Boolean);

  let revisionOrder: number | null = null;
  let revisionLabel = 'Revision';
  let chapterIndex = -1;

  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i].toLowerCase();
    const revisionMatch = token.match(/^(?:r|rev|revision|v)?(\d+)$/i);
    if (revisionMatch) {
      revisionOrder = Number(revisionMatch[1]);
      revisionLabel = `R${revisionMatch[1]}`;
      continue;
    }

    if (token === 'latest') {
      revisionOrder = Number.MAX_SAFE_INTEGER;
      revisionLabel = 'Latest';
      continue;
    }

    const chapterMatch = token.match(/^(?:ch|chapter)(\d+)$/i);
    if (chapterMatch) {
      chapterIndex = i;
      break;
    }
    if (token === 'chapter' && i + 1 < tokens.length) {
      chapterIndex = i;
      break;
    }
  }

  let document = parts.slice(0, -1).join('/') || 'Ungrouped';
  let chapter = 'General';

  if (chapterIndex >= 0) {
    const chapterToken = tokens[chapterIndex].toLowerCase();
    if (chapterToken === 'chapter' && chapterIndex + 1 < tokens.length) {
      chapter = `Chapter ${tokens[chapterIndex + 1]}`;
    } else {
      chapter = tokens[chapterIndex].replace(/^ch/i, 'Chapter ');
    }

    const docTokens = tokens.slice(0, chapterIndex).filter((token) => token.toLowerCase() !== 'chapter');
    if (docTokens.length > 0) {
      document = docTokens.join(' ');
    }
  } else if (tokens.length > 0) {
    chapter = stem;
  }

  return {
    document,
    chapter,
    revisionOrder,
    revisionLabel,
  };
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function parseHeadings(content: string): HeadingItem[] {
  return content
    .split('\n')
    .map((line) => line.match(/^(#{1,6})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      text: match[2].trim(),
    }));
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function getSnippet(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (!query.trim()) return normalized.slice(0, 180);

  const regex = new RegExp(escapeRegExp(query), 'i');
  const match = regex.exec(normalized);
  if (!match) return normalized.slice(0, 180);

  const start = Math.max(0, match.index - 70);
  const end = Math.min(normalized.length, match.index + match[0].length + 90);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function renderHighlightedText(source: string, query: string) {
  if (!query.trim()) return <>{source}</>;
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  const parts = source.split(regex);
  const normalizedQuery = query.toLowerCase();
  return (
    <>
      {parts.map((part, idx) => (
        part.toLowerCase() === normalizedQuery ? (
          <mark key={`${part}-${idx}`} className="bg-yellow-300/30 text-yellow-100 rounded px-0.5">{part}</mark>
        ) : (
          <span key={`${part}-${idx}`}>{part}</span>
        )
      ))}
    </>
  );
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function Sidebar({
  selectedFile,
  onFileSelect,
  onFileDeleted,
  onFileRenamed,
  onJumpToHeading,
}: SidebarProps) {
  const { files, isLoading, createFile, deleteFile, deleteFiles, renameFile } = useFiles();
  const [newFileName, setNewFileName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [clipboardContent, setClipboardContent] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [chapterSearch, setChapterSearch] = useState('');
  const [metaSearch, setMetaSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [collapsedDocuments, setCollapsedDocuments] = useState<Record<string, boolean>>({});
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const [revisionMetaByFile, setRevisionMetaByFile] = useState<Record<string, RevisionMeta>>({});
  const [searchEntries, setSearchEntries] = useState<SearchEntry[]>([]);
  const [headingsByFile, setHeadingsByFile] = useState<Record<string, HeadingItem[]>>({});
  const [globalQuery, setGlobalQuery] = useState('');
  const [facetDocument, setFacetDocument] = useState('');
  const [facetStatus, setFacetStatus] = useState('');
  const [facetTag, setFacetTag] = useState('');
  const [facetDateRange, setFacetDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [selectedHeading, setSelectedHeading] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      const nextMeta: Record<string, RevisionMeta> = {};
      const nextSearchEntries: SearchEntry[] = [];
      const nextHeadingsByFile: Record<string, HeadingItem[]> = {};

      await Promise.all(
        files.map(async (file) => {
          try {
            const res = await fetch(buildFileApiPath(file.name));
            if (!res.ok) return;
            const payload = (await res.json()) as FileContentResponse;
            const structure = parseFileStructure(file.name);
            const currentMeta = parseMetaFromContent(payload.content ?? '');
            nextMeta[file.name] = currentMeta;
            nextHeadingsByFile[file.name] = parseHeadings(payload.content ?? '');

            const currentCreatedAtSource = file.ctime ?? file.mtime;
            const currentCreatedAt = new Date(currentCreatedAtSource);
            nextSearchEntries.push({
              id: `${file.name}::current`,
              sourceType: 'current',
              file,
              document: structure.document,
              chapter: structure.chapter,
              revisionLabel: structure.revisionLabel,
              createdAt: Number.isNaN(currentCreatedAt.getTime()) ? new Date(file.mtime) : currentCreatedAt,
              createdAtIso: currentCreatedAtSource,
              tags: currentMeta.tags,
              status: currentMeta.status,
              note: currentMeta.note,
              content: payload.content ?? '',
            });

            payload.revisions.forEach((revision, index) => {
              const revisionMeta = parseMetaFromContent(revision.content);
              const revisionCreatedAt = new Date(revision.createdAt);
              nextSearchEntries.push({
                id: `${file.name}::${revision.id}`,
                sourceType: 'revision',
                file,
                document: structure.document,
                chapter: structure.chapter,
                revisionLabel: `R${index + 1}`,
                createdAt: Number.isNaN(revisionCreatedAt.getTime()) ? new Date(file.mtime) : revisionCreatedAt,
                createdAtIso: revision.createdAt,
                tags: revision.tags?.length ? revision.tags : revisionMeta.tags,
                status: revision.status ?? revisionMeta.status,
                note: revision.note || revisionMeta.note,
                content: revision.content,
              });
            });
          } catch {
            nextMeta[file.name] = DEFAULT_META;
          }
        }),
      );

      if (!cancelled) {
        setRevisionMetaByFile(nextMeta);
        setSearchEntries(nextSearchEntries);
        setHeadingsByFile(nextHeadingsByFile);
      }
    }

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [files]);

  const availableDocuments = useMemo(
    () => Array.from(new Set(searchEntries.map((entry) => entry.document))).sort((a, b) => a.localeCompare(b)),
    [searchEntries],
  );
  const availableStatuses = useMemo(
    () => Array.from(new Set(searchEntries.map((entry) => entry.status).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [searchEntries],
  );
  const availableTags = useMemo(
    () => Array.from(new Set(searchEntries.flatMap((entry) => entry.tags))).sort((a, b) => a.localeCompare(b)),
    [searchEntries],
  );

  const headingOptions = selectedFile ? headingsByFile[selectedFile] ?? [] : [];

  useEffect(() => {
    setSelectedHeading('');
  }, [selectedFile]);

  const rankedResults = useMemo<SearchResult[]>(() => {
    const query = globalQuery.trim().toLowerCase();
    if (!query) return [];

    const now = Date.now();
    const minDate = facetDateRange === 'all'
      ? null
      : now - (facetDateRange === '7d' ? 7 : facetDateRange === '30d' ? 30 : 90) * 24 * 60 * 60 * 1000;

    return searchEntries
      .filter((entry) => {
        if (facetDocument && entry.document !== facetDocument) return false;
        if (facetStatus && entry.status !== facetStatus) return false;
        if (facetTag && !entry.tags.includes(facetTag)) return false;
        if (minDate && entry.createdAt.getTime() < minDate) return false;
        return true;
      })
      .map((entry) => {
        const haystack = [
          entry.file.name,
          entry.document,
          entry.chapter,
          entry.status,
          entry.note,
          entry.tags.join(' '),
          entry.content,
        ].join(' ').toLowerCase();

        if (!haystack.includes(query)) {
          return null;
        }

        let score = 0;
        if (entry.file.name.toLowerCase().includes(query)) score += 12;
        if (entry.document.toLowerCase().includes(query)) score += 8;
        if (entry.chapter.toLowerCase().includes(query)) score += 7;
        if (entry.status.toLowerCase().includes(query)) score += 6;
        if (entry.tags.some((tag) => tag.toLowerCase().includes(query))) score += 5;
        if (entry.note.toLowerCase().includes(query)) score += 4;
        if (entry.content.toLowerCase().includes(query)) score += 3;
        if (entry.sourceType === 'current') score += 1;

        return {
          entry,
          score,
          snippet: getSnippet(entry.content || entry.note || entry.file.name, query),
        } satisfies SearchResult;
      })
      .filter((result): result is SearchResult => Boolean(result))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.entry.createdAt.getTime() - a.entry.createdAt.getTime();
      })
      .slice(0, 60);
  }, [facetDateRange, facetDocument, facetStatus, facetTag, globalQuery, searchEntries]);

  const grouped = useMemo<DocumentGroup[]>(() => {
    const items: RevisionItem[] = files.map((file) => {
      const structure = parseFileStructure(file.name);
      const createdAtSource = file.ctime ?? file.mtime;
      const createdAt = new Date(createdAtSource);
      return {
        file,
        ...structure,
        meta: revisionMetaByFile[file.name] ?? DEFAULT_META,
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date(file.mtime) : createdAt,
      };
    });

    const chapterFilter = chapterSearch.trim().toLowerCase();
    const metaFilter = metaSearch.trim().toLowerCase();
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    const filtered = items.filter((item) => {
      const chapterMatches = !chapterFilter || item.chapter.toLowerCase().includes(chapterFilter);
      const sourceText = [item.meta.note, item.meta.status, item.meta.tags.join(' ')].join(' ').toLowerCase();
      const metaMatches = !metaFilter || sourceText.includes(metaFilter);
      const fromMatches = !fromDate || item.createdAt >= fromDate;
      const toMatches = !toDate || item.createdAt <= toDate;
      return chapterMatches && metaMatches && fromMatches && toMatches;
    });

    const documentMap = new Map<string, Map<string, RevisionItem[]>>();

    filtered.forEach((item) => {
      if (!documentMap.has(item.document)) {
        documentMap.set(item.document, new Map<string, RevisionItem[]>());
      }
      const chapterMap = documentMap.get(item.document)!;
      if (!chapterMap.has(item.chapter)) {
        chapterMap.set(item.chapter, []);
      }
      chapterMap.get(item.chapter)!.push(item);
    });

    const output: DocumentGroup[] = [];

    documentMap.forEach((chapterMap, document) => {
      const chapters: ChapterGroup[] = [];
      chapterMap.forEach((revisions, chapter) => {
        const orderedRevisions = [...revisions].sort((a, b) => {
          const revA = a.revisionOrder ?? -1;
          const revB = b.revisionOrder ?? -1;
          if (revA !== revB) return revB - revA;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        chapters.push({ chapter, revisions: orderedRevisions });
      });

      chapters.sort((a, b) => a.chapter.localeCompare(b.chapter));
      output.push({ document, chapters });
    });

    output.sort((a, b) => a.document.localeCompare(b.document));
    return output;
  }, [chapterSearch, dateFrom, dateTo, files, metaSearch, revisionMetaByFile]);

  async function importFilesFromList(inputFiles: FileList | File[]) {
    const list = Array.from(inputFiles);
    if (list.length === 0) return;

    setError(null);
    let lastCreated: string | null = null;
    const takenNames = new Set(files.map((file) => file.name));

    for (const file of list) {
      try {
        const content = await file.text();
        const name = makeUploadFilename(file.name, takenNames);
        await createFile(name, content);
        lastCreated = name;
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? `Could not import ${file.name}`);
      }
    }

    if (lastCreated) {
      onFileSelect(lastCreated);
    }
  }

  useEffect(() => {
    if (selectedFile) {
      return;
    }

    function hasDropFiles(event: DragEvent): boolean {
      const types = event.dataTransfer?.types;
      if (!types) return false;
      return Array.from(types).includes('Files');
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasDropFiles(event)) return;
      event.preventDefault();
    };

    const onDrop = (event: DragEvent) => {
      if (!hasDropFiles(event)) return;
      event.preventDefault();
      void importFilesFromList(event.dataTransfer?.files ?? []);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  // importFilesFromList is defined in the same render scope; including it would
  // require useCallback which adds noise without benefit here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFile, files, onFileSelect, selectedFile]);

  function resetNewInput() {
    setShowNewInput(false);
    setNewFileName('');
    setClipboardContent(null);
  }

  async function handleCreate() {
    let name = newFileName.trim();
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
    if (selectedFile) {
      setError('Upload is only available when no file is selected.');
      e.target.value = '';
      return;
    }

    const picked = e.target.files;
    e.target.value = '';
    if (!picked || picked.length === 0) return;
    await importFilesFromList(picked);
  }

  async function handleDelete(file: FileEntry) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    setError(null);
    try {
      await deleteFile(file.name);
      onFileDeleted(file.name);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not delete file');
    }
  }

  function toggleFileSelection(filename: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedFiles(new Set());
  }

  async function handleBulkDelete() {
    if (selectedFiles.size === 0) return;
    if (!confirm(`Delete ${selectedFiles.size} file(s)?`)) return;
    setError(null);
    try {
      const toDelete = Array.from(selectedFiles);
      await deleteFiles(toDelete);
      toDelete.forEach((filename) => onFileDeleted(filename));
      exitSelectionMode();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not delete files');
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

  function toggleDocument(document: string) {
    setCollapsedDocuments((prev) => ({ ...prev, [document]: !prev[document] }));
  }

  function toggleChapter(key: string) {
    setCollapsedChapters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleJumpToHeading() {
    if (!selectedHeading) return;
    onJumpToHeading(selectedHeading);
  }

  return (
    <aside className="flex flex-col h-full bg-gray-900 text-gray-100 w-80 shrink-0 border-r border-gray-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (selectionMode) {
                exitSelectionMode();
              } else {
                setSelectionMode(true);
              }
            }}
            className={`transition-colors ${selectionMode ? 'text-blue-400 hover:text-blue-300' : 'text-gray-400 hover:text-white'}`}
            title={selectionMode ? 'Cancel selection' : 'Select files'}
            aria-label={selectionMode ? 'Cancel selection' : 'Select files'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
          <button
            onClick={handlePasteFromClipboard}
            className="text-gray-400 hover:text-white transition-colors"
            title="Paste from clipboard"
            aria-label="Paste from clipboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            title={selectedFile ? 'Clear the current selection to upload files' : 'Upload file'}
            aria-label="Upload file"
            disabled={Boolean(selectedFile)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
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
            onClick={() => {
              setShowNewInput(true);
              setClipboardContent(null);
              setError(null);
            }}
            className="text-gray-400 hover:text-white transition-colors"
            title="New file"
            aria-label="New file"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-gray-700 space-y-2">
        <input
          type="text"
          value={globalQuery}
          onChange={(e) => setGlobalQuery(e.target.value)}
          placeholder="Search all files + revisions"
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        />
        {globalQuery.trim() && (
          <div className="grid grid-cols-2 gap-2">
            <select
              value={facetDocument}
              onChange={(e) => setFacetDocument(e.target.value)}
              className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600"
              aria-label="Filter by document"
            >
              <option value="">All documents</option>
              {availableDocuments.map((document) => (
                <option key={document} value={document}>{document}</option>
              ))}
            </select>
            <select
              value={facetStatus}
              onChange={(e) => setFacetStatus(e.target.value)}
              className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {availableStatuses.map((statusOption) => (
                <option key={statusOption} value={statusOption}>{statusOption}</option>
              ))}
            </select>
            <select
              value={facetTag}
              onChange={(e) => setFacetTag(e.target.value)}
              className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600"
              aria-label="Filter by tag"
            >
              <option value="">All tags</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>#{tag}</option>
              ))}
            </select>
            <select
              value={facetDateRange}
              onChange={(e) => setFacetDateRange(e.target.value as 'all' | '7d' | '30d' | '90d')}
              className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600"
              aria-label="Filter by date range"
            >
              <option value="all">All dates</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>
        )}
        <input
          type="text"
          value={chapterSearch}
          onChange={(e) => setChapterSearch(e.target.value)}
          placeholder="Filter by chapter name"
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            aria-label="Created from date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            aria-label="Created to date"
          />
        </div>
        <input
          type="text"
          value={metaSearch}
          onChange={(e) => setMetaSearch(e.target.value)}
          placeholder="Filter by note / tag / status"
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        />
        {selectedFile && headingOptions.length > 0 && (
          <div className="flex gap-2">
            <select
              value={selectedHeading}
              onChange={(e) => setSelectedHeading(e.target.value)}
              className="flex-1 bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600"
              aria-label="Jump to heading"
            >
              <option value="">Jump to heading…</option>
              {headingOptions.map((heading) => (
                <option key={`${heading.level}-${heading.text}`} value={heading.text}>
                  {'  '.repeat(Math.max(0, heading.level - 1))}
                  {heading.text}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleJumpToHeading}
              disabled={!selectedHeading}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded transition-colors"
            >
              Go
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {showNewInput && (
        <div className="px-3 py-2 border-b border-gray-700">
          {clipboardContent !== null && (
            <div className="flex items-center gap-1 text-xs text-blue-400 mb-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Clipboard content ready
            </div>
          )}
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') resetNewInput();
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
              onClick={resetNewInput}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {globalQuery.trim() && (
          <div className="border-b border-gray-700/60">
            <div className="px-3 py-2 text-[11px] text-gray-400">
              {rankedResults.length} result{rankedResults.length === 1 ? '' : 's'}
            </div>
            {rankedResults.map((result) => (
              <button
                key={result.entry.id}
                onClick={() => onFileSelect(result.entry.file.name)}
                className="w-full text-left px-3 py-2 border-t border-gray-800 hover:bg-gray-800/70 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-gray-200 truncate">{result.entry.file.name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{result.entry.sourceType}</span>
                  <span className="ml-auto text-[10px] text-gray-500">{formatDate(result.entry.createdAtIso)}</span>
                </div>
                <div className="text-[11px] text-gray-400 truncate mt-0.5">
                  {result.entry.document} / {result.entry.chapter}
                </div>
                <div className="text-[11px] text-gray-300 mt-1 leading-relaxed">
                  {renderHighlightedText(result.snippet, globalQuery.trim())}
                </div>
              </button>
            ))}
            {rankedResults.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-500">No search matches</div>
            )}
          </div>
        )}
        {isLoading && <div className="px-4 py-3 text-sm text-gray-500">Loading...</div>}
        {!isLoading && grouped.length === 0 && <div className="px-4 py-3 text-sm text-gray-500">No matching files</div>}

        {grouped.map((documentGroup) => {
          const documentCollapsed = collapsedDocuments[documentGroup.document] ?? false;
          return (
            <div key={documentGroup.document} className="border-b border-gray-800/70">
              <button
                onClick={() => toggleDocument(documentGroup.document)}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-900/80 hover:bg-gray-800 transition-colors"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-300 truncate">{documentGroup.document}</span>
                <span className="text-[10px] text-gray-500">{documentCollapsed ? '+' : '-'}</span>
              </button>

              {!documentCollapsed && documentGroup.chapters.map((chapterGroup) => {
                const chapterKey = `${documentGroup.document}::${chapterGroup.chapter}`;
                const chapterCollapsed = collapsedChapters[chapterKey] ?? false;
                const latestRevision = chapterGroup.revisions[0]?.file.name;

                return (
                  <div key={chapterKey} className="border-t border-gray-800/50">
                    <button
                      onClick={() => toggleChapter(chapterKey)}
                      className="w-full flex items-center justify-between px-4 py-2 bg-gray-900/40 hover:bg-gray-800/70 transition-colors"
                    >
                      <span className="text-xs text-gray-300 truncate">{chapterGroup.chapter}</span>
                      <span className="text-[10px] text-gray-500">{chapterCollapsed ? '+' : '-'}</span>
                    </button>

                    {!chapterCollapsed && (
                      <div>
                        {chapterGroup.revisions.map((revision) => {
                          const status = revision.meta.status.toLowerCase();
                          const isDraft = status.includes('draft') || revision.file.name.toLowerCase().includes('draft');
                          const isCurrent = status.includes('current') || revision.file.name === latestRevision;

                          const isChecked = selectedFiles.has(revision.file.name);

                          return (
                            <div
                              key={revision.file.name}
                              className={`group border-l-2 px-5 py-2 cursor-pointer hover:bg-gray-800/70 transition-colors ${
                                selectionMode && isChecked
                                  ? 'bg-gray-800/50 border-blue-500'
                                  : !selectionMode && selectedFile === revision.file.name
                                  ? 'bg-gray-800 border-blue-500'
                                  : 'border-transparent'
                              }`}
                              onClick={() => {
                                if (selectionMode) {
                                  toggleFileSelection(revision.file.name);
                                } else {
                                  onFileSelect(revision.file.name);
                                }
                              }}
                            >
                              {renamingFile === revision.file.name ? (
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRename(revision.file.name);
                                    if (e.key === 'Escape') setRenamingFile(null);
                                  }}
                                  onBlur={() => handleRename(revision.file.name)}
                                  className="w-full bg-gray-700 text-gray-100 text-sm px-1 py-0.5 rounded border border-gray-500 focus:outline-none focus:border-blue-500"
                                  autoFocus
                                />
                              ) : (
                                <>
                                  <div className="flex items-center gap-2">
                                    {selectionMode && (
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleFileSelection(revision.file.name)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="shrink-0 accent-blue-500"
                                        aria-label={`Select ${revision.file.name}`}
                                      />
                                    )}
                                    <span className="text-sm truncate">{revision.revisionLabel}</span>
                                    {isDraft && (
                                      <span className="text-[10px] font-semibold uppercase bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                                        Draft
                                      </span>
                                    )}
                                    {isCurrent && (
                                      <span className="text-[10px] font-semibold uppercase bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded">
                                        Current
                                      </span>
                                    )}
                                    {!selectionMode && (
                                      <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            startRename(revision.file);
                                          }}
                                          className="text-gray-400 hover:text-white p-0.5"
                                          title="Rename"
                                          aria-label={`Rename ${revision.file.name}`}
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            void handleDelete(revision.file);
                                          }}
                                          className="text-gray-400 hover:text-red-400 p-0.5"
                                          title="Delete"
                                          aria-label={`Delete ${revision.file.name}`}
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  <div className="mt-1 text-[11px] text-gray-400 space-y-0.5">
                                    <div className="flex gap-2">
                                      <span>Created: {formatDate(revision.file.ctime ?? revision.file.mtime)}</span>
                                    </div>
                                    {revision.meta.note && <div className="truncate">{revision.meta.note}</div>}
                                    {revision.meta.tags.length > 0 && (
                                      <div className="truncate text-blue-300/90">#{revision.meta.tags.join(' #')}</div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {selectionMode && (
        <div className="border-t border-gray-700 px-3 py-2 flex items-center gap-2 bg-gray-900">
          <span className="text-xs text-gray-400 flex-1">
            {selectedFiles.size} selected
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={selectedFiles.size === 0}
            className="text-xs px-2 py-1 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded transition-colors"
          >
            Delete
          </button>
          <button
            onClick={exitSelectionMode}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </aside>
  );
}
