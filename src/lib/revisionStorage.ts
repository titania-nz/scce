import fs from 'fs';
import path from 'path';
import { getStore } from '@netlify/blobs';
import { resolveSafePath } from '@/lib/fileStorage';
import { Revision } from '@/types';

const isNetlifyRuntime =
  process.env.NETLIFY === 'true' ||
  process.env.CONTEXT !== undefined ||
  process.env.NETLIFY_BLOBS_CONTEXT !== undefined;

function getBlobStore() {
  if (!isNetlifyRuntime) {
    return null;
  }
  return getStore('files');
}

function getRevisionsDir(): string {
  const filePath = resolveSafePath('placeholder.md');
  const notesDir = path.dirname(filePath);
  const revisionDir = path.join(notesDir, '.revisions');
  fs.mkdirSync(revisionDir, { recursive: true });
  return revisionDir;
}

function getRevisionPath(filename: string): string {
  resolveSafePath(filename);
  const safeName = encodeURIComponent(filename);
  return path.join(getRevisionsDir(), `${safeName}.json`);
}

function getRevisionBlobKey(filename: string): string {
  resolveSafePath(filename);
  return `${filename}.revisions.json`;
}

function normalizeRevision(revision: Revision): Revision {
  return {
    ...revision,
    tags: revision.tags?.filter(Boolean) ?? [],
    note: revision.note?.trim() ?? '',
    status: revision.status,
  };
}

export async function readRevisions(filename: string): Promise<Revision[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    try {
      const buffer = await store.get(getRevisionBlobKey(filename));
      if (!buffer) return [];
      const parsed = JSON.parse(new TextDecoder().decode(buffer));
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => normalizeRevision(item as Revision));
    } catch {
      return [];
    }
  }

  const revisionPath = getRevisionPath(filename);
  if (!fs.existsSync(revisionPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(revisionPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeRevision(item as Revision));
  } catch {
    return [];
  }
}

export async function writeRevisions(filename: string, revisions: Revision[]): Promise<void> {
  const normalized = revisions.map(normalizeRevision);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not save revisions');
    await store.set(getRevisionBlobKey(filename), JSON.stringify(normalized));
    return;
  }

  const revisionPath = getRevisionPath(filename);
  const tmpPath = `${revisionPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf-8');
  fs.renameSync(tmpPath, revisionPath);
}

export async function deleteRevisions(filename: string): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    try {
      await store.delete(getRevisionBlobKey(filename));
    } catch {
      return;
    }
    return;
  }

  const revisionPath = getRevisionPath(filename);
  if (fs.existsSync(revisionPath)) {
    fs.unlinkSync(revisionPath);
  }
}

export async function renameRevisions(oldName: string, newName: string): Promise<void> {
  const revisions = await readRevisions(oldName);
  if (!revisions.length) {
    return;
  }
  await writeRevisions(newName, revisions);
  await deleteRevisions(oldName);
}
