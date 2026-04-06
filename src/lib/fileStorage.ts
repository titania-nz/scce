import fs from 'fs';
import path from 'path';
import { getStore } from '@netlify/blobs';
import { FileEntry } from '@/types';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. ]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

const isNetlify = process.env.NETLIFY === 'true';

let blobStore: ReturnType<typeof getStore> | null = null;

function getBlobStore() {
  if (!blobStore && isNetlify) {
    blobStore = getStore('files');
  }
  return blobStore;
}

export function getNotesDir(): string {
  if (isNetlify) {
    return ''; // Not used
  }
  const dir = process.env.NOTES_DIR ?? path.join(process.cwd(), 'notes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSafePath(filename: string): string {
  if (!filename || filename.length > MAX_FILENAME_LENGTH) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  if (!VALID_FILENAME.test(filename)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  if (isNetlify) {
    return filename; // Just return the filename for blob store
  }
  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, filename);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}

export async function listFiles(): Promise<FileEntry[]> {
  if (isNetlify) {
    const store = getBlobStore();
    if (!store) return [];
    const { blobs } = await store.list();
    return blobs
      .filter((blob) => blob.key.endsWith('.md') && VALID_FILENAME.test(blob.key))
      .map((blob) => ({
        name: blob.key,
        mtime: new Date().toISOString(),
        size: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
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
  const key = resolveSafePath(filename);
  if (isNetlify) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(key);
      return new TextDecoder().decode(buffer);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
  }
  const filePath = key;
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export async function writeFile(filename: string, content: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlify) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create file');
    await store.set(key, content);
    return;
  }
  const filePath = key;
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export async function deleteFile(filename: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlify) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      await store.delete(key);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
    return;
  }
  const filePath = key;
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  fs.unlinkSync(filePath);
}

export async function renameFile(oldName: string, newName: string): Promise<void> {
  const oldKey = resolveSafePath(oldName);
  const newKey = resolveSafePath(newName);
  if (isNetlify) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(oldKey);
      const content = new TextDecoder().decode(buffer);
      await store.set(newKey, content);
      await store.delete(oldKey);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
    return;
  }
  const oldPath = oldKey;
  const newPath = newKey;
  if (!fs.existsSync(oldPath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  if (fs.existsSync(newPath)) {
    throw Object.assign(new Error('File already exists'), { status: 409 });
  }
  fs.renameSync(oldPath, newPath);
}

export async function fileExists(filename: string): Promise<boolean> {
  try {
    const key = resolveSafePath(filename);
    if (isNetlify) {
      const store = getBlobStore();
      if (!store) return false;
      try {
        await store.get(key);
        return true;
      } catch {
        return false;
      }
    }
    const filePath = key;
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}
