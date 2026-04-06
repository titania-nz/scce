import fs from 'fs';
import path from 'path';
import { FileEntry } from '@/types';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. ]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

function validateFilename(filename: string): void {
  if (!filename || filename.length > MAX_FILENAME_LENGTH) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  if (!VALID_FILENAME.test(filename)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
}

// ── Netlify Blobs (production / netlify dev) ─────────────────────────────────

type BlobMeta = { mtime: string; size: number };

async function getNotesStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('notes');
}

async function listFilesBlobs(): Promise<FileEntry[]> {
  const store = await getNotesStore();
  const { blobs } = await store.list();
  const validBlobs = blobs.filter((b) => VALID_FILENAME.test(b.key));

  const entries = await Promise.all(
    validBlobs.map(async (b) => {
      const result = await store.getWithMetadata(b.key);
      const meta = (result?.metadata ?? {}) as Partial<BlobMeta>;
      return {
        name: b.key,
        mtime: meta.mtime ?? new Date().toISOString(),
        size: meta.size ?? 0,
      };
    }),
  );

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function readFileBlobs(filename: string): Promise<string> {
  validateFilename(filename);
  const store = await getNotesStore();
  const content = await store.get(filename, { type: 'text' });
  if (content === null) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return content;
}

async function writeFileBlobs(filename: string, content: string): Promise<void> {
  validateFilename(filename);
  const store = await getNotesStore();
  const mtime = new Date().toISOString();
  const size = Buffer.byteLength(content, 'utf-8');
  await store.set(filename, content, { metadata: { mtime, size } });
}

async function deleteFileBlobs(filename: string): Promise<void> {
  validateFilename(filename);
  const store = await getNotesStore();
  const exists = await store.get(filename, { type: 'text' });
  if (exists === null) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  await store.delete(filename);
}

async function renameFileBlobs(oldName: string, newName: string): Promise<void> {
  validateFilename(oldName);
  validateFilename(newName);
  const store = await getNotesStore();
  const content = await store.get(oldName, { type: 'text' });
  if (content === null) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  const newExists = await store.get(newName, { type: 'text' });
  if (newExists !== null) {
    throw Object.assign(new Error('File already exists'), { status: 409 });
  }
  const mtime = new Date().toISOString();
  const size = Buffer.byteLength(content, 'utf-8');
  await store.set(newName, content, { metadata: { mtime, size } });
  await store.delete(oldName);
}

async function fileExistsBlobs(filename: string): Promise<boolean> {
  try {
    validateFilename(filename);
    const store = await getNotesStore();
    const result = await store.get(filename, { type: 'text' });
    return result !== null;
  } catch {
    return false;
  }
}

// ── Filesystem (local next dev) ───────────────────────────────────────────────

function getNotesDir(): string {
  const dir = process.env.NOTES_DIR ?? path.join(process.cwd(), 'notes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveSafePath(filename: string): string {
  validateFilename(filename);
  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, filename);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}

// ── Public API (always async) ─────────────────────────────────────────────────

const useBlobs = !!process.env.NETLIFY;

export async function listFiles(): Promise<FileEntry[]> {
  if (useBlobs) return listFilesBlobs();
  const dir = getNotesDir();
  const entries = fs.readdirSync(dir);
  return entries
    .filter((name) => name.endsWith('.md') && VALID_FILENAME.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readFile(filename: string): Promise<string> {
  if (useBlobs) return readFileBlobs(filename);
  const filePath = resolveSafePath(filename);
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export async function writeFile(filename: string, content: string): Promise<void> {
  if (useBlobs) return writeFileBlobs(filename, content);
  const filePath = resolveSafePath(filename);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export async function deleteFile(filename: string): Promise<void> {
  if (useBlobs) return deleteFileBlobs(filename);
  const filePath = resolveSafePath(filename);
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  fs.unlinkSync(filePath);
}

export async function renameFile(oldName: string, newName: string): Promise<void> {
  if (useBlobs) return renameFileBlobs(oldName, newName);
  const oldPath = resolveSafePath(oldName);
  const newPath = resolveSafePath(newName);
  if (!fs.existsSync(oldPath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  if (fs.existsSync(newPath)) {
    throw Object.assign(new Error('File already exists'), { status: 409 });
  }
  fs.renameSync(oldPath, newPath);
}

export async function fileExists(filename: string): Promise<boolean> {
  if (useBlobs) return fileExistsBlobs(filename);
  try {
    const filePath = resolveSafePath(filename);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}
