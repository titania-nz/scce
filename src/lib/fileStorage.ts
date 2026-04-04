import fs from 'fs';
import path from 'path';
import { FileEntry } from '@/types';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. ]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

export function getNotesDir(): string {
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
  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, filename);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}

export function listFiles(): FileEntry[] {
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

export function readFile(filename: string): string {
  const filePath = resolveSafePath(filename);
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeFile(filename: string, content: string): void {
  const filePath = resolveSafePath(filename);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function deleteFile(filename: string): void {
  const filePath = resolveSafePath(filename);
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  fs.unlinkSync(filePath);
}

export function renameFile(oldName: string, newName: string): void {
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

export function fileExists(filename: string): boolean {
  try {
    const filePath = resolveSafePath(filename);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}
