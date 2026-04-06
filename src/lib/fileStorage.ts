import fs from 'fs';
import path from 'path';
import { getStore } from '@netlify/blobs';
import { FileEntry } from '@/types';

const VALID_SEGMENT = /^[a-zA-Z0-9_. -]+$/;
const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

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

export function getNotesDir(): string {
  if (isNetlifyRuntime) {
    return ''; // Not used
  }
  const dir = process.env.NOTES_DIR ?? path.join(process.cwd(), 'notes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function validateFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').trim();

  if (!normalized || normalized.length > MAX_PATH_LENGTH) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }

  if (normalized.startsWith('/') || normalized.endsWith('/')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment.length > MAX_SEGMENT_LENGTH || segment === '.' || segment === '..' || !VALID_SEGMENT.test(segment))) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }

  const lastSegment = segments[segments.length - 1];
  if (!lastSegment.endsWith('.md')) {
    throw Object.assign(new Error('Filename must end with .md'), { status: 400 });
  }

  return segments.join('/');
}

function removeEmptyParentDirs(filePath: string, rootDir: string) {
  let currentDir = path.dirname(filePath);
  const resolvedRoot = path.resolve(rootDir);

  while (currentDir.startsWith(resolvedRoot) && currentDir !== resolvedRoot) {
    if (fs.readdirSync(currentDir).length > 0) {
      break;
    }
    fs.rmdirSync(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

export function resolveSafePath(filename: string): string {
  const safeName = validateFilename(filename);

  if (isNetlifyRuntime) {
    return safeName; // Just return the filename for blob store
  }

  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, safeName);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}

function walkMarkdownFiles(baseDir: string, currentDir = baseDir): FileEntry[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(baseDir, fullPath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const relativeName = path.relative(baseDir, fullPath).split(path.sep).join('/');
    const stat = fs.statSync(fullPath);
    files.push({
      name: relativeName,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
    });
  }

  return files;
}

export async function listFiles(): Promise<FileEntry[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const { blobs } = await store.list();
    return blobs
      .filter((blob) => blob.key.endsWith('.md'))
      .filter((blob) => {
        try {
          validateFilename(blob.key);
          return true;
        } catch {
          return false;
        }
      })
      .map((blob) => ({
        name: blob.key,
        mtime: new Date().toISOString(),
        size: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const dir = getNotesDir();
  const files = walkMarkdownFiles(dir);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readFile(filename: string): Promise<string> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
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
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create file');
    await store.set(key, content);
    return;
  }

  const filePath = key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export async function deleteFile(filename: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
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
  removeEmptyParentDirs(filePath, getNotesDir());
}

export async function renameFile(oldName: string, newName: string): Promise<void> {
  const oldKey = resolveSafePath(oldName);
  const newKey = resolveSafePath(newName);
  if (isNetlifyRuntime) {
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

  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.renameSync(oldPath, newPath);
  removeEmptyParentDirs(oldPath, getNotesDir());
}

export async function fileExists(filename: string): Promise<boolean> {
  try {
    const key = resolveSafePath(filename);
    if (isNetlifyRuntime) {
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
