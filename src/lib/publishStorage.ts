import fs from 'fs';
import path from 'path';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { getNotesDir, resolveSafePath } from '@/lib/notesPath';
import { PublishHistoryEntry } from '@/types';

interface PublishMeta {
  history: PublishHistoryEntry[];
}

const EMPTY_META: PublishMeta = { history: [] };

function getPublishDir(): string {
  const dir = path.join(getNotesDir(), '.published');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getPublishPath(filename: string): string {
  resolveSafePath(filename);
  return path.join(getPublishDir(), `${encodeURIComponent(filename)}.json`);
}

function getPublishBlobKey(filename: string): string {
  resolveSafePath(filename);
  return `${filename}.publish-history.json`;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function normalizeHistory(history: PublishHistoryEntry[]): PublishHistoryEntry[] {
  return history
    .filter((entry) => Boolean(entry.id && entry.createdAt && entry.profileId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function renamePublishHistory(oldName: string, newName: string): Promise<void> {
  const history = await readPublishHistory(oldName);
  if (!history.length) {
    return;
  }
  await writePublishHistory(newName, history);
  await deletePublishHistory(oldName);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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
