import fs from 'fs';
import path from 'path';
import { FileEntry } from '@/types';
import { isMissingBlobValue } from '@/lib/blobValue';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { getNotesDir } from '@/lib/notesPath';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. /]+\.md$/;

interface BlobFileMetaRecord {
  createdAt: string;
  updatedAt: string;
  size: number;
}

// Return a timestamp string for fallback metadata values.
function nowIso(): string {
  return new Date().toISOString();
}

// Turn a file path into a storage-safe string for metadata keys.
function encodeFilenameForPath(filename: string): string {
  return encodeURIComponent(filename);
}

// Build the metadata key used to look up file timestamps and size.
function getBlobFileMetaKey(filename: string): string {
  return `__filemeta__/${encodeFilenameForPath(filename)}.json`;
}

// Read one file's metadata record from Netlify Blobs if it exists.
async function readBlobFileMeta(filename: string): Promise<BlobFileMetaRecord | null> {
  const store = getBlobStore();
  if (!store) return null;

  try {
    const buffer = await store.get(getBlobFileMetaKey(filename));
    if (isMissingBlobValue(buffer)) return null;
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

// List every markdown file that should appear in the app's file picker.
export async function listNoteFiles(): Promise<FileEntry[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const { blobs } = await store.list();
    const files: Array<FileEntry | null> = await Promise.all(
      blobs
        .filter(
          (blob) =>
            blob.key.endsWith('.md') &&
            !blob.key.startsWith('__revisions__/') &&
            !blob.key.startsWith('__filemeta__/') &&
            !blob.key.startsWith('documents/') &&
            VALID_FILENAME.test(blob.key),
        )
        .map(async (blob) => {
          // Netlify Blob listings can outlive a missing content record briefly.
          // Verify the note still exists so the UI does not surface ghost files
          // that would immediately 404 when opened.
          const content = await store.get(blob.key).catch(() => null);
          if (isMissingBlobValue(content)) {
            return null;
          }

          const meta = await readBlobFileMeta(blob.key);
          const fallback = nowIso();
          return {
            name: blob.key,
            mtime: meta?.updatedAt ?? fallback,
            ctime: meta?.createdAt ?? fallback,
            size: meta?.size ?? 0,
          };
        }),
    );

    return files
      .filter((file): file is FileEntry => file !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const dir = getNotesDir();
  const files: FileEntry[] = [];

  const walk = (relativeDir = ''): void => {
    const currentDir = path.join(dir, /*turbopackIgnore: true*/ relativeDir);
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelative = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        walk(nextRelative);
        continue;
      }

      if (!entry.isFile() || !nextRelative.endsWith('.md') || !VALID_FILENAME.test(nextRelative)) {
        continue;
      }

      const stat = fs.statSync(path.join(dir, /*turbopackIgnore: true*/ nextRelative));
      files.push({
        name: nextRelative,
        mtime: stat.mtime.toISOString(),
        ctime: stat.birthtime.toISOString(),
        size: stat.size,
      });
    }
  };

  walk();

  return files.sort((a, b) => a.name.localeCompare(b.name));
}
