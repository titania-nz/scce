import fs from 'fs';
import path from 'path';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { isMissingBlobValue, readBlobText } from '@/lib/blobValue';
import { resolveSafePath } from '@/lib/notesPath';

interface BlobFileMetaRecord {
  createdAt: string;
  updatedAt: string;
  size: number;
}

// Return a timestamp string in the format used throughout stored records.
function nowIso(): string {
  return new Date().toISOString();
}

// Turn a file path into a storage-safe string for metadata keys.
function encodeFilenameForPath(filename: string): string {
  return encodeURIComponent(filename);
}

// Build the metadata key that stores created/updated timestamps for a note file.
function getBlobFileMetaKey(filename: string): string {
  return `__filemeta__/${encodeFilenameForPath(filename)}.json`;
}

// Preserve created time when possible while updating size and modified time.
function buildBlobFileMetaRecord(existing: BlobFileMetaRecord | null, size: number): BlobFileMetaRecord {
  const timestamp = nowIso();
  return {
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    size,
  };
}

// Read file metadata from Netlify Blobs when the app is running in hosted mode.
async function readBlobFileMeta(filename: string): Promise<BlobFileMetaRecord | null> {
  const store = getBlobStore();
  if (!store) return null;

  try {
    const buffer = await store.get(getBlobFileMetaKey(filename));
    if (isMissingBlobValue(buffer)) return null;
    const parsed = JSON.parse(await readBlobText(buffer)) as Partial<BlobFileMetaRecord>;
    if (!parsed.updatedAt && !parsed.createdAt) return null;
    return {
      createdAt: parsed.createdAt ?? parsed.updatedAt ?? nowIso(),
      updatedAt: parsed.updatedAt ?? parsed.createdAt ?? nowIso(),
      size: Number.isFinite(parsed.size) ? Number(parsed.size) : 0,
    };
  } catch {
    return null;
  }
}

// Save file metadata next to the note contents in Netlify Blobs.
async function writeBlobFileMeta(filename: string, meta: BlobFileMetaRecord): Promise<void> {
  const store = getBlobStore();
  if (!store) throw new Error('Could not write file metadata');
  await store.set(getBlobFileMetaKey(filename), JSON.stringify(meta));
}

// Read one markdown note from either local disk or Netlify Blob storage.
export async function readNoteFile(filename: string): Promise<string> {
  const key = resolveSafePath(filename);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(key);
      if (isMissingBlobValue(buffer)) throw new Error('missing');
      return await readBlobText(buffer);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
  }

  if (!fs.existsSync(key)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return fs.readFileSync(key, 'utf-8');
}

// Save one markdown note and update its metadata record when needed.
export async function writeNoteFile(filename: string, content: string): Promise<void> {
  const key = resolveSafePath(filename);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create file');
    await store.set(key, content);
    const previousMeta = await readBlobFileMeta(filename);
    const size = Buffer.byteLength(content, 'utf-8');
    await writeBlobFileMeta(filename, buildBlobFileMetaRecord(previousMeta, size));
    return;
  }

  fs.mkdirSync(path.dirname(key), { recursive: true });
  const tmpPath = `${key}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, key);
}

// Check whether a note file already exists before creating or renaming.
export async function noteFileExists(filename: string): Promise<boolean> {
  const key = resolveSafePath(filename);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return false;
    try {
      return (await store.get(key)) !== null;
    } catch {
      return false;
    }
  }

  return fs.existsSync(key);
}

// Delete the stored note content and its metadata record.
export async function deleteNoteFile(filename: string): Promise<void> {
  const key = resolveSafePath(filename);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    await store.delete(key).catch(() => {});
    await store.delete(getBlobFileMetaKey(filename)).catch(() => {});
    return;
  }

  if (!fs.existsSync(key)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  fs.unlinkSync(key);
}

// Rename a note file without losing its existing content or metadata.
export async function renameNoteFile(oldName: string, newName: string): Promise<void> {
  const oldKey = resolveSafePath(oldName);
  const newKey = resolveSafePath(newName);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not rename file');
    const buffer = await store.get(oldKey);
    if (isMissingBlobValue(buffer)) {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
    const existing = await store.get(newKey);
    if (existing) {
      throw Object.assign(new Error('File already exists'), { status: 409 });
    }
    await store.set(newKey, buffer);
    await store.delete(oldKey).catch(() => {});

    const meta = await readBlobFileMeta(oldName);
    if (meta) {
      await writeBlobFileMeta(newName, meta);
      await store.delete(getBlobFileMetaKey(oldName)).catch(() => {});
    }
    return;
  }

  if (!fs.existsSync(oldKey)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  if (fs.existsSync(newKey)) {
    throw Object.assign(new Error('File already exists'), { status: 409 });
  }

  fs.mkdirSync(path.dirname(newKey), { recursive: true });
  fs.renameSync(oldKey, newKey);
}
