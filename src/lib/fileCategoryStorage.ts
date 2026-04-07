import fs from 'fs';
import path from 'path';
import type { FileCategory } from '@/types';
import { isMissingBlobValue, readBlobText } from '@/lib/blobValue';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { listNoteFiles } from '@/lib/noteIndexStorage';
import { getNotesDir } from '@/lib/notesPath';

const FILE_CATEGORIES_DIR = '.file-categories';

function encodeFilenameForPath(filename: string): string {
  return encodeURIComponent(filename);
}

function getBlobFileCategoryKey(filename: string): string {
  return `__categories__/${encodeFilenameForPath(filename)}.json`;
}

function getLocalFileCategoryPath(filename: string): string {
  return path.join(getNotesDir(), FILE_CATEGORIES_DIR, `${encodeFilenameForPath(filename)}.json`);
}

function normalizeFileCategory(input: Partial<FileCategory> | null | undefined): FileCategory | null {
  const document = typeof input?.document === 'string' ? input.document.trim() : '';
  const chapter = typeof input?.chapter === 'string' ? input.chapter.trim() : '';
  const isPrimary = input?.isPrimary === true;

  if (!document && !chapter) return null;

  return {
    document: document || 'Ungrouped',
    chapter: chapter || 'General',
    isPrimary,
  };
}

async function clearPrimaryInCategoryGroup(filename: string, category: FileCategory): Promise<void> {
  const files = await listNoteFiles();

  await Promise.all(
    files.map(async (file) => {
      if (file.name === filename) return;

      const existing = await readFileCategory(file.name);
      if (!existing?.isPrimary) return;
      if (existing.document !== category.document || existing.chapter !== category.chapter) return;

      await writeFileCategory(file.name, { ...existing, isPrimary: false });
    }),
  );
}

export async function readFileCategory(filename: string): Promise<FileCategory | null> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return null;

    try {
      const buffer = await store.get(getBlobFileCategoryKey(filename));
      if (isMissingBlobValue(buffer)) return null;
      const parsed = JSON.parse(await readBlobText(buffer)) as Partial<FileCategory>;
      return normalizeFileCategory(parsed);
    } catch {
      return null;
    }
  }

  const categoryPath = getLocalFileCategoryPath(filename);
  if (!fs.existsSync(categoryPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(categoryPath, 'utf-8')) as Partial<FileCategory>;
    return normalizeFileCategory(parsed);
  } catch {
    return null;
  }
}

export async function writeFileCategory(filename: string, category: Partial<FileCategory> | null): Promise<FileCategory | null> {
  const normalized = normalizeFileCategory(category);

  if (!normalized) {
    await deleteFileCategory(filename);
    return null;
  }

  if (normalized.isPrimary) {
    await clearPrimaryInCategoryGroup(filename, normalized);
  }

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not write file category');
    await store.set(getBlobFileCategoryKey(filename), JSON.stringify(normalized));
    return normalized;
  }

  const categoryPath = getLocalFileCategoryPath(filename);
  fs.mkdirSync(path.dirname(categoryPath), { recursive: true });
  fs.writeFileSync(categoryPath, JSON.stringify(normalized), 'utf-8');
  return normalized;
}

export async function deleteFileCategory(filename: string): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    await store.delete(getBlobFileCategoryKey(filename)).catch(() => {});
    return;
  }

  const categoryPath = getLocalFileCategoryPath(filename);
  if (fs.existsSync(categoryPath)) {
    fs.unlinkSync(categoryPath);
  }
}

export async function renameFileCategory(oldName: string, newName: string): Promise<void> {
  const existing = await readFileCategory(oldName);
  if (!existing) return;

  await writeFileCategory(newName, existing);
  await deleteFileCategory(oldName);
}
