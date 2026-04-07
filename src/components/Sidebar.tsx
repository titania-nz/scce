'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFiles } from '@/hooks/useFiles';
import type { FileContentResponse, FileEntry } from '@/types';
import { buildFileApiPath } from '@/lib/fileApiPath';
import { getFolderName, getParentFolderPath, joinFolderPath } from '@/lib/folderPaths';
import {
  DEFAULT_REVISION_META,
  parseMetaFromContent,
} from '@/lib/revisionMeta';
import type { RevisionMetaSummary } from '@/lib/revisionMeta';

interface SidebarProps {
  selectedFile: string | null;
  onFileSelect: (filename: string) => void;
  onFileDeleted: (filename: string) => void;
  onFileRenamed: (oldName: string, newName: string) => void;
  onJumpToHeading: (heading: string) => void;
  applyFilter: (filter: { chapterSearch: string; metaSearch: string; dateFrom: string; dateTo: string }) => void;
}

type RevisionMeta = RevisionMetaSummary;

interface RevisionItem {
  file: FileEntry;
  document: string;
  chapter: string;
  revisionOrder: number | null;
  revisionLabel: string;
  meta: RevisionMeta;
  createdAt: Date;
}

interface FileTreeNode {
  path: string;
  name: string;
  folders: FileTreeNode[];
  files: VisibleFileItem[];
}

interface HeadingItem {
  level: number;
  text: string;
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

interface ImportCandidate {
  originalPath: string;
  name: string;
  content: string;
  hash: string;
  inferredDocument: string;
  inferredChapter: string;
}

interface ImportWizardState {
  candidates: ImportCandidate[];
  duplicateByHash: Record<string, string[]>;
}

interface SavedFilter {
  id: string;
  name: string;
  chapterSearch: string;
  metaSearch: string;
  dateFrom: string;
  dateTo: string;
}

interface VisibleFileItem extends RevisionItem {
  baseName: string;
  folderPath: string | null;
}

const DEFAULT_META: RevisionMeta = DEFAULT_REVISION_META;
const SAVED_FILTERS_STORAGE_KEY = 'scce.savedSidebarFilters';
const ROOT_FOLDER_SENTINEL = '__ROOT__';

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function getCurrentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return {
    from: startOfWeek.toISOString().slice(0, 10),
    to: endOfWeek.toISOString().slice(0, 10),
  };
}

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
function sanitizeRelativePath(input: string): string {
  const normalized = input
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim())
    .filter(Boolean)
    .join('/');
  return normalized;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function applyRenameTemplate(
  template: string,
  index: number,
  sourceName: string,
  inferredDocument: string,
  inferredChapter: string,
): string {
  const stem = sourceName.replace(/\.[^.]*$/, '');
  const filename = template
    .replaceAll('{n}', String(index + 1))
    .replaceAll('{rev}', '1')
    .replaceAll('{basename}', stem)
    .replaceAll('{document}', inferredDocument.replace(/[^\w\-./ ]/g, '_'))
    .replaceAll('{chapter}', inferredChapter.replace(/[^\w\-./ ]/g, '_'));

  const cleaned = sanitizeRelativePath(filename);
  const withExt = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
  return withExt || `import-${index + 1}.md`;
}

async function inflateRawDeflate(data: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('ZIP import requires a browser with DecompressionStream support.');
  }
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const response = new Response(stream);
  return response.text();
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
async function extractMarkdownFromZip(buffer: ArrayBuffer): Promise<Array<{ name: string; content: string }>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const entries: Array<{ name: string; content: string }> = [];
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (flags & 0x08) {
      throw new Error('ZIP data descriptors are not supported in this importer.');
    }
    if (dataEnd > bytes.length) {
      throw new Error('Corrupt ZIP file.');
    }

    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    const isDirectory = name.endsWith('/');
    if (!isDirectory && /\.(md|txt)$/i.test(name)) {
      const fileBytes = bytes.slice(dataStart, dataEnd);
      const content =
        method === 0
          ? decoder.decode(fileBytes)
          : method === 8
          ? await inflateRawDeflate(fileBytes)
          : '';
      if (content) {
        entries.push({ name, content });
      }
    }
    offset = dataEnd;
  }

  return entries;
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

// Merge saved category overrides with filename-derived revision metadata.
function getResolvedFileStructure(file: FileEntry) {
  const inferred = parseFileStructure(file.name);
  if (!file.category) return inferred;

  return {
    ...inferred,
    document: file.category.document,
    chapter: file.category.chapter,
  };
}

function splitFilePath(fileName: string): { folderPath: string | null; baseName: string } {
  const segments = fileName.split('/').filter(Boolean);
  const baseName = segments[segments.length - 1] ?? fileName;
  const folderPath = segments.length > 1 ? segments.slice(0, -1).join('/') : null;
  return { folderPath, baseName };
}

function joinFilePath(folderPath: string | null, fileName: string): string {
  const trimmed = fileName.trim().replace(/^\/+/, '');
  if (!trimmed) return '';
  return folderPath ? `${folderPath}/${trimmed}` : trimmed;
}

function createFolderTree(items: VisibleFileItem[], explicitFolders: string[]): { folders: FileTreeNode[]; rootFiles: VisibleFileItem[] } {
  const folderMap = new Map<string, FileTreeNode>();
  const rootFolders: FileTreeNode[] = [];

  function ensureFolder(path: string): FileTreeNode {
    const existing = folderMap.get(path);
    if (existing) return existing;

    const parentPath = getParentFolderPath(path);
    const node: FileTreeNode = {
      path,
      name: getFolderName(path),
      folders: [],
      files: [],
    };
    folderMap.set(path, node);

    if (parentPath) {
      ensureFolder(parentPath).folders.push(node);
    } else {
      rootFolders.push(node);
    }

    return node;
  }

  explicitFolders.forEach((folderPath) => ensureFolder(folderPath));

  const rootFiles: VisibleFileItem[] = [];
  items.forEach((item) => {
    if (item.folderPath) {
      ensureFolder(item.folderPath).files.push(item);
    } else {
      rootFiles.push(item);
    }
  });

  function sortNode(node: FileTreeNode) {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.baseName.localeCompare(b.baseName));
    node.folders.forEach(sortNode);
  }

  rootFolders.forEach(sortNode);
  rootFolders.sort((a, b) => a.name.localeCompare(b.name));
  rootFiles.sort((a, b) => a.baseName.localeCompare(b.baseName));

  return { folders: rootFolders, rootFiles };
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
  applyFilter: applyExternalFilter,
}: SidebarProps) {
  const {
    files,
    folders,
    isLoading,
    createFile,
    createFolder,
    deleteFile,
    deleteFiles,
    deleteFolder,
    renameFile,
    renameFolder,
    updateFileCategory,
  } = useFiles();
  const [newFileName, setNewFileName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [newFileParentPath, setNewFileParentPath] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [uploadPopoverOpen, setUploadPopoverOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clipboardContent, setClipboardContent] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [creatingFolderParent, setCreatingFolderParent] = useState<string | null>(null);
  const [newFolderValue, setNewFolderValue] = useState('');
  const [categorizingFile, setCategorizingFile] = useState<string | null>(null);
  const [categoryDocumentValue, setCategoryDocumentValue] = useState('');
  const [categoryChapterValue, setCategoryChapterValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [chapterSearch, setChapterSearch] = useState('');
  const [metaSearch, setMetaSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
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
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const renamingInFlightRef = useRef(false);
  const [importWizard, setImportWizard] = useState<ImportWizardState | null>(null);
  const [importTemplate, setImportTemplate] = useState('chapter-{n}-r{rev}.md');
  const [wizardLoading, setWizardLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_FILTERS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedFilter[];
      if (!Array.isArray(parsed)) return;
      setSavedFilters(
        parsed.filter((item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.chapterSearch === 'string' &&
          typeof item.metaSearch === 'string' &&
          typeof item.dateFrom === 'string' &&
          typeof item.dateTo === 'string'),
      );
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SAVED_FILTERS_STORAGE_KEY, JSON.stringify(savedFilters));
  }, [savedFilters]);

  function applyFilter(filter: Pick<SavedFilter, 'chapterSearch' | 'metaSearch' | 'dateFrom' | 'dateTo'>) {
    setChapterSearch(filter.chapterSearch);
    setMetaSearch(filter.metaSearch);
    setDateFrom(filter.dateFrom);
    setDateTo(filter.dateTo);
    applyExternalFilter(filter);
  }

  function saveCurrentFilter() {
    const name = window.prompt('Name this filter');
    if (!name) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const nextFilter: SavedFilter = {
      id: crypto.randomUUID(),
      name: trimmedName,
      chapterSearch,
      metaSearch,
      dateFrom,
      dateTo,
    };

    setSavedFilters((prev) => [...prev, nextFilter]);
  }

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
            const structure = getResolvedFileStructure(file);
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

  const visibleItems = useMemo<VisibleFileItem[]>(() => {
    const items: VisibleFileItem[] = files.map((file) => {
      const structure = getResolvedFileStructure(file);
      const createdAtSource = file.ctime ?? file.mtime;
      const createdAt = new Date(createdAtSource);
      const pathParts = splitFilePath(file.name);
      return {
        file,
        ...structure,
        meta: revisionMetaByFile[file.name] ?? DEFAULT_META,
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date(file.mtime) : createdAt,
        ...pathParts,
      };
    });

    const chapterFilter = chapterSearch.trim().toLowerCase();
    const metaFilter = metaSearch.trim().toLowerCase();
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    return items.filter((item) => {
      const chapterMatches = !chapterFilter || item.chapter.toLowerCase().includes(chapterFilter);
      const sourceText = [item.meta.note, item.meta.status, item.meta.tags.join(' ')].join(' ').toLowerCase();
      const metaMatches = !metaFilter || sourceText.includes(metaFilter);
      const fromMatches = !fromDate || item.createdAt >= fromDate;
      const toMatches = !toDate || item.createdAt <= toDate;
      return chapterMatches && metaMatches && fromMatches && toMatches;
    });
  }, [chapterSearch, dateFrom, dateTo, files, metaSearch, revisionMetaByFile]);

  const tree = useMemo(() => createFolderTree(visibleItems, folders), [folders, visibleItems]);

  async function buildImportCandidates(entries: Array<{ name: string; content: string }>) {
    const candidates: ImportCandidate[] = [];
    for (const entry of entries) {
      const safePath = sanitizeRelativePath(entry.name);
      if (!safePath) continue;
      const parsed = parseFileStructure(safePath);
      candidates.push({
        originalPath: safePath,
        name: safePath,
        content: entry.content,
        hash: await hashContent(entry.content),
        inferredDocument: parsed.document,
        inferredChapter: parsed.chapter,
      });
    }
    return candidates;
  }

  async function openImportWizard(candidates: ImportCandidate[]) {
    if (candidates.length === 0) return;
    setError(null);
    const hashToFiles = new Map<string, string[]>();
    candidates.forEach((candidate) => {
      const list = hashToFiles.get(candidate.hash) ?? [];
      list.push(candidate.originalPath);
      hashToFiles.set(candidate.hash, list);
    });

    setImportWizard({
      candidates,
      duplicateByHash: Object.fromEntries(hashToFiles),
    });
  }

  async function importFilesFromList(inputFiles: FileList | File[]) {
    const list = Array.from(inputFiles).filter((file) => /\.(md|txt)$/i.test(file.name));
    if (list.length === 0) return;
    setWizardLoading(true);
    try {
      const entries = await Promise.all(
        list.map(async (file) => ({ name: file.name, content: await file.text() })),
      );
      const candidates = await buildImportCandidates(entries);
      await openImportWizard(candidates);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not prepare import');
    } finally {
      setWizardLoading(false);
    }
  }

  async function importZipFile(file: File) {
    setWizardLoading(true);
    try {
      const entries = await extractMarkdownFromZip(await file.arrayBuffer());
      const candidates = await buildImportCandidates(entries);
      await openImportWizard(candidates);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not read ZIP file');
    } finally {
      setWizardLoading(false);
    }
  }

  async function confirmImportFromWizard() {
    if (!importWizard) return;
    setError(null);
    let lastCreated: string | null = null;
    const takenNames = new Set(files.map((file) => file.name));

    for (let index = 0; index < importWizard.candidates.length; index += 1) {
      const candidate = importWizard.candidates[index];
      const templated = applyRenameTemplate(
        importTemplate,
        index,
        candidate.name,
        candidate.inferredDocument,
        candidate.inferredChapter,
      );
      const name = makeUploadFilename(templated, takenNames);
      try {
        await createFile(name, candidate.content);
        lastCreated = name;
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? `Could not import ${candidate.name}`);
      }
    }

    setImportWizard(null);
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
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length === 1 && dropped[0].name.toLowerCase().endsWith('.zip')) {
        void importZipFile(dropped[0]);
        return;
      }
      void importFilesFromList(dropped);
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
    setNewFileParentPath(null);
    setClipboardContent(null);
    setAddMenuOpen(false);
    setUploadPopoverOpen(false);
  }

  async function handleCreate() {
    let name = newFileName.trim();
    if (!name) return;
    if (!name.includes('/') && newFileParentPath) {
      name = joinFilePath(newFileParentPath, name);
    }
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
      setNewFileParentPath(null);
      const today = new Date().toISOString().slice(0, 10);
      setNewFileName(`paste-${today}`);
      setShowNewInput(true);
      setAddMenuOpen(false);
      setUploadPopoverOpen(false);
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

  async function handleZipUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (selectedFile) {
      setError('Import is only available when no file is selected.');
      e.target.value = '';
      return;
    }

    const picked = e.target.files;
    e.target.value = '';
    if (!picked || picked.length === 0) return;
    await importZipFile(picked[0]);
  }

  async function handleFolderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (selectedFile) {
      setError('Import is only available when no file is selected.');
      e.target.value = '';
      return;
    }

    const picked = e.target.files;
    e.target.value = '';
    if (!picked || picked.length === 0) return;
    const entries = Array.from(picked).map((file) => {
      const withRelative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return {
        file,
        relativePath: withRelative && withRelative.trim().length > 0 ? withRelative : file.name,
      };
    });

    setWizardLoading(true);
    try {
      const resolved = await Promise.all(
        entries.map(async ({ file, relativePath }) => ({
          name: relativePath,
          content: await file.text(),
        })),
      );
      const candidates = await buildImportCandidates(resolved);
      await openImportWizard(candidates);
    } catch {
      setError('Could not import folder');
    } finally {
      setWizardLoading(false);
    }
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
    setRenameValue(splitFilePath(file.name).baseName.replace(/\.md$/, ''));
    setCategorizingFile(null);
    setRenamingFolder(null);
  }

  function startFolderRename(folderPath: string) {
    setRenamingFolder(folderPath);
    setFolderRenameValue(getFolderName(folderPath));
    setRenamingFile(null);
    setCategorizingFile(null);
  }

  function startFolderCreate(parentPath: string | null) {
    setShowNewInput(false);
    setCreatingFolderParent(parentPath ?? ROOT_FOLDER_SENTINEL);
    setNewFolderValue('');
    setAddMenuOpen(false);
    setUploadPopoverOpen(false);
    setRenamingFolder(null);
    setRenamingFile(null);
    setCategorizingFile(null);
  }

  function startCategoryEdit(file: FileEntry) {
    const category = getResolvedFileStructure(file);
    setCategorizingFile(file.name);
    setCategoryDocumentValue(file.category?.document ?? category.document);
    setCategoryChapterValue(file.category?.chapter ?? category.chapter);
    setRenamingFile(null);
    setRenamingFolder(null);
  }

  async function handleRename(oldName: string) {
    if (renamingInFlightRef.current) return;
    let newName = renameValue.trim();
    if (!newName) {
      setRenamingFile(null);
      return;
    }
    if (!newName.includes('/')) {
      newName = joinFilePath(splitFilePath(oldName).folderPath, newName);
    }
    if (!newName.endsWith('.md')) newName += '.md';
    if (newName === oldName) {
      setRenamingFile(null);
      return;
    }
    renamingInFlightRef.current = true;
    setError(null);
    try {
      await renameFile(oldName, newName);
      setRenamingFile(null);
      onFileRenamed(oldName, newName);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not rename file');
    } finally {
      renamingInFlightRef.current = false;
    }
  }

  async function handleFolderRename(oldPath: string) {
    const trimmed = folderRenameValue.trim();
    if (!trimmed) {
      setRenamingFolder(null);
      return;
    }

    const parentPath = getParentFolderPath(oldPath);
    const newPath = trimmed.includes('/') ? trimmed : joinFolderPath(parentPath, trimmed);
    if (newPath === oldPath) {
      setRenamingFolder(null);
      return;
    }

    setError(null);
    try {
      const result = await renameFolder(oldPath, newPath);
      result.renamed.forEach((entry) => onFileRenamed(entry.oldName, entry.newName));
      setRenamingFolder(null);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setError(error.message ?? 'Could not rename folder');
    }
  }

  async function handleCreateFolder() {
    const trimmed = newFolderValue.trim();
    if (!trimmed) return;

    setError(null);
    try {
      const parentPath = creatingFolderParent === ROOT_FOLDER_SENTINEL ? null : creatingFolderParent;
      const path = trimmed.includes('/') || !parentPath
        ? trimmed
        : joinFolderPath(parentPath, trimmed);
      await createFolder(path);
      setCreatingFolderParent(null);
      setNewFolderValue('');
      setCollapsedFolders((prev) => ({ ...prev, [path]: false }));
    } catch (err: unknown) {
      const error = err as { message?: string };
      setError(error.message ?? 'Could not create folder');
    }
  }

  async function handleDeleteFolder(folderPath: string) {
    const fileCount = files.filter((file) => file.name.startsWith(`${folderPath}/`)).length;
    const confirmMessage = fileCount > 0
      ? `Delete folder "${folderPath}" and ${fileCount} file(s)?`
      : `Delete empty folder "${folderPath}"?`;
    if (!confirm(confirmMessage)) return;

    setError(null);
    try {
      const result = await deleteFolder(folderPath);
      result.deleted.forEach((filename) => onFileDeleted(filename));
    } catch (err: unknown) {
      const error = err as { message?: string };
      setError(error.message ?? 'Could not delete folder');
    }
  }

  async function handleSaveCategory(filename: string) {
    const document = categoryDocumentValue.trim();
    const chapter = categoryChapterValue.trim();

    setError(null);
    try {
      await updateFileCategory(
        filename,
        !document && !chapter
          ? null
          : {
              document: document || 'Ungrouped',
              chapter: chapter || 'General',
            },
      );
      setCategorizingFile(null);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Could not update file category');
    }
  }

  function toggleFolder(folderPath: string) {
    setCollapsedFolders((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }));
  }

  function handleJumpToHeading() {
    if (!selectedHeading) return;
    onJumpToHeading(selectedHeading);
  }

  function openNewFileInput(parentPath: string | null) {
    setShowNewInput(true);
    setNewFileParentPath(parentPath);
    setNewFileName(parentPath ? 'untitled.md' : '');
    setClipboardContent(null);
    setAddMenuOpen(false);
    setUploadPopoverOpen(false);
    setError(null);
    setCreatingFolderParent(null);
  }

  function renderFileRow(revision: VisibleFileItem) {
    const isChecked = selectedFiles.has(revision.file.name);

    return (
      <div
        key={revision.file.name}
        className={`group border-l-2 px-4 py-2 cursor-pointer hover:bg-gray-800/70 transition-colors ${
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
              if (e.key === 'Enter') void handleRename(revision.file.name);
              if (e.key === 'Escape') setRenamingFile(null);
            }}
            onBlur={() => void handleRename(revision.file.name)}
            className="w-full bg-gray-700 text-gray-100 text-sm px-1 py-0.5 rounded border border-gray-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
        ) : categorizingFile === revision.file.name ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={categoryDocumentValue}
                onChange={(e) => setCategoryDocumentValue(e.target.value)}
                placeholder="Document"
                className="w-full bg-gray-700 text-gray-100 text-xs px-2 py-1 rounded border border-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <input
                type="text"
                value={categoryChapterValue}
                onChange={(e) => setCategoryChapterValue(e.target.value)}
                placeholder="Chapter"
                className="w-full bg-gray-700 text-gray-100 text-xs px-2 py-1 rounded border border-gray-500 focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveCategory(revision.file.name);
                  if (e.key === 'Escape') setCategorizingFile(null);
                }}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleSaveCategory(revision.file.name);
                }}
                className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
              >
                Save category
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void updateFileCategory(revision.file.name, null)
                    .then(() => setCategorizingFile(null))
                    .catch((err: unknown) => {
                      const saveError = err as { message?: string };
                      setError(saveError.message ?? 'Could not update file category');
                    });
                }}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCategorizingFile(null);
                }}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
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
              <span className="text-sm truncate">{revision.baseName}</span>
              {revision.revisionOrder !== null && (
                <span className="text-[10px] uppercase text-gray-500">{revision.revisionLabel}</span>
              )}
              {!selectionMode && (
                <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startCategoryEdit(revision.file);
                    }}
                    className="text-gray-400 hover:text-white p-0.5"
                    title={revision.file.category ? 'Re-categorise' : 'Categorise'}
                    aria-label={`${revision.file.category ? 'Re-categorise' : 'Categorise'} ${revision.file.name}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startRename(revision.file);
                    }}
                    className="text-gray-400 hover:text-white p-0.5"
                    title="Rename / move"
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
              <div className="truncate">
                {revision.file.name}
                {revision.file.category && (
                  <span className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-200">
                    Categorised
                  </span>
                )}
              </div>
              <div className="truncate">{revision.document} / {revision.chapter}</div>
              <div>Created: {formatDate(revision.file.ctime ?? revision.file.mtime)}</div>
              {revision.meta.note && <div className="truncate">{revision.meta.note}</div>}
              {revision.meta.tags.length > 0 && (
                <div className="truncate text-blue-300/90">#{revision.meta.tags.join(' #')}</div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  function renderFolderNode(node: FileTreeNode, depth = 0) {
    const collapsed = collapsedFolders[node.path] ?? false;
    const isRenaming = renamingFolder === node.path;
    const isCreatingChildFolder = creatingFolderParent === node.path;

    return (
      <div key={node.path} className={depth > 0 ? 'border-t border-gray-800/40' : ''}>
        <div
          className="group flex items-center gap-2 px-3 py-2 hover:bg-gray-800/50 transition-colors"
          style={{ paddingLeft: `${12 + depth * 14}px` }}
        >
          <button
            type="button"
            onClick={() => toggleFolder(node.path)}
            className="text-gray-500 hover:text-gray-300"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${node.name}`}
          >
            <span className="text-[10px]">{collapsed ? '+' : '-'}</span>
          </button>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-amber-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          {isRenaming ? (
            <input
              type="text"
              value={folderRenameValue}
              onChange={(e) => setFolderRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleFolderRename(node.path);
                if (e.key === 'Escape') setRenamingFolder(null);
              }}
              onBlur={() => void handleFolderRename(node.path)}
              className="flex-1 bg-gray-700 text-gray-100 text-sm px-2 py-1 rounded border border-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          ) : (
            <span className="text-sm text-gray-200 truncate flex-1">{node.name}</span>
          )}
          {!selectionMode && !isRenaming && (
            <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                type="button"
                onClick={() => openNewFileInput(node.path)}
                className="text-gray-400 hover:text-white p-0.5"
                title="New file in folder"
                aria-label={`New file in ${node.path}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => startFolderCreate(node.path)}
                className="text-gray-400 hover:text-white p-0.5"
                title="New subfolder"
                aria-label={`New subfolder in ${node.path}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h5l2 2h3m4 0h2m-1-1v2m-6 9h7a2 2 0 002-2V9a2 2 0 00-2-2h-7l-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => startFolderRename(node.path)}
                className="text-gray-400 hover:text-white p-0.5"
                title="Rename / move folder"
                aria-label={`Rename ${node.path}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteFolder(node.path)}
                className="text-gray-400 hover:text-red-400 p-0.5"
                title="Delete folder"
                aria-label={`Delete ${node.path}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {isCreatingChildFolder && (
          <div className="px-3 pb-2" style={{ paddingLeft: `${28 + depth * 14}px` }}>
            <input
              type="text"
              value={newFolderValue}
              onChange={(e) => setNewFolderValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateFolder();
                if (e.key === 'Escape') setCreatingFolderParent(null);
              }}
              placeholder="subfolder-name"
              className="w-full bg-gray-800 text-gray-100 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        )}

        {!collapsed && (
          <div>
            {node.folders.map((child) => renderFolderNode(child, depth + 1))}
            {node.files.map(renderFileRow)}
          </div>
        )}
      </div>
    );
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
          <div className="relative">
            <button
              onClick={() => {
                setAddMenuOpen((open) => !open);
                setUploadPopoverOpen(false);
              }}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
            >
              Add
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 top-9 z-30 w-52 rounded border border-gray-700 bg-gray-900 p-1 shadow-xl">
                <button
                  onClick={() => openNewFileInput(null)}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                >
                  New file
                </button>
                <button
                  onClick={() => startFolderCreate(null)}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                >
                  New folder
                </button>
                <button
                  onClick={() => void handlePasteFromClipboard()}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                >
                  Paste from clipboard
                </button>
                <div className="my-1 border-t border-gray-800" />
                <button
                  onClick={() => setUploadPopoverOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                  disabled={Boolean(selectedFile)}
                >
                  <span>Upload or import</span>
                  <span className="text-[10px] text-gray-500">{uploadPopoverOpen ? 'Hide' : 'Show'}</span>
                </button>
                {uploadPopoverOpen && (
                  <div className="mt-1 space-y-1 rounded border border-gray-800 bg-gray-950/60 p-1">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                    >
                      Upload markdown files
                    </button>
                    <button
                      onClick={() => zipInputRef.current?.click()}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                    >
                      Import ZIP
                    </button>
                    <button
                      onClick={() => folderInputRef.current?.click()}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                    >
                      Import folder
                    </button>
                    {selectedFile && (
                      <p className="px-2 py-1 text-[11px] text-gray-500">
                        Clear the current selection before importing.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,text/plain,text/markdown"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={handleZipUpload}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFolderUpload}
            {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        </div>
      </div>

      <div className="border-b border-gray-800 px-3 py-2">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded bg-gray-800/70 px-3 py-2 text-left text-xs font-medium text-gray-200 hover:bg-gray-800"
        >
          <span>Filters</span>
          <span className="text-gray-500">{filtersOpen ? 'Hide' : 'Show'}</span>
        </button>

        {filtersOpen && (
          <div className="mt-2 space-y-3 rounded border border-gray-800 bg-gray-950/40 p-3">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Quick filters</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyFilter({ chapterSearch: '', metaSearch: 'needs review', dateFrom: '', dateTo: '' })}
                  className="text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
                >
                  My review queue
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { from, to } = getCurrentWeekRange();
                    applyFilter({ chapterSearch: '', metaSearch: 'needs review', dateFrom: from, dateTo: to });
                  }}
                  className="text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
                >
                  Needs review this week
                </button>
                <button
                  type="button"
                  onClick={saveCurrentFilter}
                  className="text-[11px] px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white"
                >
                  Save current filter
                </button>
              </div>
            </div>

            {savedFilters.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Saved filters</div>
                <div className="flex flex-wrap gap-1.5">
                  {savedFilters.map((filter) => (
                    <div key={filter.id} className="inline-flex items-center rounded border border-gray-600 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => applyFilter(filter)}
                        className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-100"
                      >
                        {filter.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSavedFilters((prev) => prev.filter((item) => item.id !== filter.id))}
                        className="text-[11px] px-1.5 py-1 bg-gray-700 hover:bg-red-700 text-gray-300"
                        aria-label={`Delete saved filter ${filter.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Search and advanced filters</div>
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
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {wizardLoading && (
        <div className="mx-3 mt-2 px-3 py-2 bg-blue-950/50 border border-blue-800 rounded text-xs text-blue-300">
          Preparing import…
        </div>
      )}

      {importWizard && (
        <div className="mx-3 mt-2 p-3 border border-blue-700/70 bg-blue-950/30 rounded text-xs space-y-2">
          <div className="font-semibold text-blue-200">Import wizard</div>
          <div className="text-blue-100/90">
            {importWizard.candidates.length} file(s) detected. Structure inferred from paths before import.
          </div>
          <input
            type="text"
            value={importTemplate}
            onChange={(e) => setImportTemplate(e.target.value)}
            placeholder="chapter-{n}-r{rev}.md"
            className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
          />
          <div className="text-[11px] text-blue-200/80">
            Template tokens: {'{n}'}, {'{rev}'}, {'{basename}'}, {'{document}'}, {'{chapter}'}
          </div>
          <div className="max-h-24 overflow-y-auto text-[11px] text-gray-300 border border-gray-800 rounded p-2 bg-gray-900/50">
            {importWizard.candidates.slice(0, 8).map((candidate, index) => (
              <div key={`${candidate.originalPath}-${index}`} className="truncate">
                {candidate.originalPath} → {applyRenameTemplate(importTemplate, index, candidate.name, candidate.inferredDocument, candidate.inferredChapter)}
              </div>
            ))}
            {importWizard.candidates.length > 8 && (
              <div className="text-gray-400 mt-1">…and {importWizard.candidates.length - 8} more</div>
            )}
          </div>
          <div className="text-[11px] text-amber-200/90">
            Duplicate groups in batch (by content hash): {Object.values(importWizard.duplicateByHash).filter((group) => group.length > 1).length}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImportFromWizard}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Import now
            </button>
            <button
              onClick={() => setImportWizard(null)}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
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
            placeholder={newFileParentPath ? `${newFileParentPath}/filename.md` : 'filename.md'}
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

      {creatingFolderParent !== null && creatingFolderParent === ROOT_FOLDER_SENTINEL && (
        <div className="px-3 py-2 border-b border-gray-700">
          <input
            type="text"
            value={newFolderValue}
            onChange={(e) => setNewFolderValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateFolder();
              if (e.key === 'Escape') setCreatingFolderParent(null);
            }}
            placeholder="new-folder"
            className="w-full bg-gray-800 text-gray-100 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => void handleCreateFolder()}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Create folder
            </button>
            <button
              onClick={() => setCreatingFolderParent(null)}
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
        {!isLoading && tree.folders.length === 0 && tree.rootFiles.length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-500">No matching files</div>
        )}

        {tree.folders.map((folder) => renderFolderNode(folder))}
        {tree.rootFiles.length > 0 && (
          <div className={tree.folders.length > 0 ? 'border-t border-gray-800/50' : ''}>
            {tree.rootFiles.map(renderFileRow)}
          </div>
        )}
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
