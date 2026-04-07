import fs from 'fs';
import path from 'path';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { normalizeFolderPath, replaceFolderPrefix, isWithinFolder } from '@/lib/folderPaths';
import { getNotesDir } from '@/lib/notesPath';

const LOCAL_FOLDER_INDEX = '.folders.json';
const BLOB_FOLDER_INDEX = '__folders__.json';

function normalizeFolderList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  return Array.from(
    new Set(
      input
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => {
          try {
            return normalizeFolderPath(entry);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function getLocalFolderIndexPath(): string {
  return path.join(getNotesDir(), LOCAL_FOLDER_INDEX);
}

export async function readFolders(): Promise<string[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];

    try {
      const buffer = await store.get(BLOB_FOLDER_INDEX);
      if (!buffer) return [];
      return normalizeFolderList(JSON.parse(new TextDecoder().decode(buffer)));
    } catch {
      return [];
    }
  }

  const folderIndexPath = getLocalFolderIndexPath();
  if (!fs.existsSync(folderIndexPath)) return [];

  try {
    return normalizeFolderList(JSON.parse(fs.readFileSync(folderIndexPath, 'utf-8')));
  } catch {
    return [];
  }
}

export async function writeFolders(folders: string[]): Promise<string[]> {
  const normalized = normalizeFolderList(folders);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not save folders');
    await store.set(BLOB_FOLDER_INDEX, JSON.stringify(normalized));
    return normalized;
  }

  const folderIndexPath = getLocalFolderIndexPath();
  fs.writeFileSync(folderIndexPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

export async function createFolder(folderPath: string): Promise<string[]> {
  const normalized = normalizeFolderPath(folderPath);
  const existing = await readFolders();
  if (existing.includes(normalized)) {
    return existing;
  }

  return writeFolders([...existing, normalized]);
}

export async function renameFolderEntries(oldFolderPath: string, newFolderPath: string): Promise<string[]> {
  const normalizedOld = normalizeFolderPath(oldFolderPath);
  const normalizedNew = normalizeFolderPath(newFolderPath);
  const existing = await readFolders();

  const renamed = existing.map((folderPath) =>
    folderPath === normalizedOld || isWithinFolder(folderPath, normalizedOld)
      ? replaceFolderPrefix(folderPath, normalizedOld, normalizedNew)
      : folderPath,
  );

  if (!renamed.includes(normalizedNew)) {
    renamed.push(normalizedNew);
  }

  return writeFolders(renamed);
}

export async function deleteFolderEntries(folderPath: string): Promise<string[]> {
  const normalized = normalizeFolderPath(folderPath);
  const existing = await readFolders();
  return writeFolders(existing.filter((entry) => entry !== normalized && !isWithinFolder(entry, normalized)));
}
