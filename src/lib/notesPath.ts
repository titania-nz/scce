import fs from 'fs';
import path from 'path';
import { isNetlifyRuntime } from '@/lib/netlifyRuntime';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. /]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

export function getNotesDir(): string {
  if (isNetlifyRuntime) {
    return '';
  }

  const defaultDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'notes');
  const envDir = /*turbopackIgnore: true*/ process.env.NOTES_DIR?.trim();
  const dir = envDir ? /*turbopackIgnore: true*/ path.resolve(envDir) : defaultDir;
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
  if (filename.includes('\\')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }

  const segments = filename.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }

  if (isNetlifyRuntime) {
    return filename;
  }

  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, /*turbopackIgnore: true*/ filename);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}
