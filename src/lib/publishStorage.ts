import fs from 'fs';
import path from 'path';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { getNotesDir, resolveSafePath } from '@/lib/notesPath';
import { PublishHistoryEntry } from '@/types';

interface PublishMeta {
  history: PublishHistoryEntry[];
}

const EMPTY_META: PublishMeta = { history: [] };

// Return the local folder used to store publish history records.
function getPublishDir(): string {
  const dir = path.join(getNotesDir(), '.published');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Build the local file path for one note's publish-history record.
function getPublishPath(filename: string): string {
  resolveSafePath(filename);
  return path.join(getPublishDir(), `${encodeURIComponent(filename)}.json`);
}

// Build the Blob-storage key for one note's publish-history record.
function getPublishBlobKey(filename: string): string {
  resolveSafePath(filename);
  return `${filename}.publish-history.json`;
}

// Clean and sort publish-history entries so the newest item always appears first.
function normalizeHistory(history: PublishHistoryEntry[]): PublishHistoryEntry[] {
  return history
    .filter((entry) => Boolean(entry.id && entry.createdAt && entry.profileId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Read the publish-history list for a file, regardless of which storage backend is active.
export async function readPublishHistory(filename: string): Promise<PublishHistoryEntry[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];

    try {
      const buffer = await store.get(getPublishBlobKey(filename));
      if (!buffer) return [];
      const parsed = JSON.parse(new TextDecoder().decode(buffer)) as PublishMeta;
      return normalizeHistory(parsed.history ?? []);
    } catch {
      return [];
    }
  }

  const publishPath = getPublishPath(filename);
  if (!fs.existsSync(publishPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(publishPath, 'utf-8')) as PublishMeta;
    return normalizeHistory(parsed.history ?? []);
  } catch {
    return [];
  }
}

// Save the full publish-history list for a file.
export async function writePublishHistory(filename: string, history: PublishHistoryEntry[]): Promise<void> {
  const payload: PublishMeta = {
    history: normalizeHistory(history),
  };

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not save publish history');
    await store.set(getPublishBlobKey(filename), JSON.stringify(payload));
    return;
  }

  const publishPath = getPublishPath(filename);
  const tmpPath = `${publishPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, publishPath);
}

// Move publish history to a new filename after a rename.
export async function renamePublishHistory(oldName: string, newName: string): Promise<void> {
  const history = await readPublishHistory(oldName);
  if (!history.length) {
    return;
  }
  await writePublishHistory(newName, history);
  await deletePublishHistory(oldName);
}

// Remove stored publish history when a file is deleted.
export async function deletePublishHistory(filename: string): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    try {
      await store.delete(getPublishBlobKey(filename));
    } catch {
      return;
    }
    return;
  }

  const publishPath = getPublishPath(filename);
  if (fs.existsSync(publishPath)) {
    fs.unlinkSync(publishPath);
  }
}
