import fs from 'fs';
import path from 'path';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { resolveSafePath } from '@/lib/notesPath';

interface BlobFileMetaRecord {
  createdAt: string;
  updatedAt: string;
  size: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function encodeFilenameForPath(filename: string): string {
  return encodeURIComponent(filename);
}

function getBlobFileMetaKey(filename: string): string {
  return `__filemeta__/${encodeFilenameForPath(filename)}.json`;
}

function buildBlobFileMetaRecord(existing: BlobFileMetaRecord | null, size: number): BlobFileMetaRecord {
  const timestamp = nowIso();
  return {
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    size,
  };
}

async function readBlobFileMeta(filename: string): Promise<BlobFileMetaRecord | null> {
  const store = getBlobStore();
  if (!store) return null;

  try {
    const buffer = await store.get(getBlobFileMetaKey(filename));
    if (!buffer) return null;
    const parsed = JSON.parse(new TextDecoder().decode(buffer)) as Partial<BlobFileMetaRecord>;
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

async function writeBlobFileMeta(filename: string, meta: BlobFileMetaRecord): Promise<void> {
  const store = getBlobStore();
  if (!store) throw new Error('Could not write file metadata');
  await store.set(getBlobFileMetaKey(filename), JSON.stringify(meta));
}

export async function readNoteFile(filename: string): Promise<string> {
  const key = resolveSafePath(filename);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(key);
      if (!buffer) throw new Error('missing');
      return new TextDecoder().decode(buffer);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
  }

  if (!fs.existsSync(key)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return fs.readFileSync(key, 'utf-8');
}

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
