import { NextRequest, NextResponse } from 'next/server';
import { deleteFileCategory, renameFileCategory } from '@/lib/fileCategoryStorage';
import { createFolder, deleteFolderEntries, readFolders, renameFolderEntries } from '@/lib/folderStorage';
import {
  deleteNoteFile,
  noteFileExists,
  renameNoteFile,
} from '@/lib/noteContentStorage';
import { listNoteFiles } from '@/lib/noteIndexStorage';
import { deletePublishHistory, renamePublishHistory } from '@/lib/publishStorage';
import { deleteRevisions, renameRevisions } from '@/lib/revisionStorage';
import {
  isWithinFolder,
  normalizeFolderPath,
  replaceFolderPrefix,
} from '@/lib/folderPaths';

function parseFolderPath(input: unknown, fieldName = 'path'): string {
  if (typeof input !== 'string') {
    throw Object.assign(new Error(`Invalid ${fieldName}`), { status: 400 });
  }

  return normalizeFolderPath(input);
}

export async function GET() {
  try {
    const folders = await readFolders();
    return NextResponse.json({ folders });
  } catch {
    return NextResponse.json({ error: 'Could not read folders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const path = parseFolderPath(body.path);
    const folders = await createFolder(path);
    return NextResponse.json({ path, folders }, { status: 201 });
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status === 400) {
      return NextResponse.json({ error: error.message ?? 'Invalid folder path' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not create folder' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const path = parseFolderPath(body.path);
    const newPath = parseFolderPath(body.newPath, 'newPath');

    if (path === newPath) {
      return NextResponse.json({ path, newPath, renamed: [], folders: await readFolders() });
    }
    if (newPath.startsWith(`${path}/`)) {
      return NextResponse.json({ error: 'Cannot move a folder inside itself' }, { status: 400 });
    }

    const files = await listNoteFiles();
    const affectedFiles = files.filter((file) => isWithinFolder(file.name, path));
    const unaffectedFiles = new Set(files.filter((file) => !isWithinFolder(file.name, path)).map((file) => file.name));
    const renamed = affectedFiles.map((file) => ({
      oldName: file.name,
      newName: replaceFolderPrefix(file.name, path, newPath),
    }));

    const seenTargets = new Set<string>();
    for (const entry of renamed) {
      if (seenTargets.has(entry.newName) || unaffectedFiles.has(entry.newName) || await noteFileExists(entry.newName)) {
        return NextResponse.json({ error: `File already exists: ${entry.newName}` }, { status: 409 });
      }
      seenTargets.add(entry.newName);
    }

    for (const entry of renamed) {
      await renameNoteFile(entry.oldName, entry.newName);
      await renameRevisions(entry.oldName, entry.newName);
      await renamePublishHistory(entry.oldName, entry.newName);
      await renameFileCategory(entry.oldName, entry.newName);
    }

    const folders = await renameFolderEntries(path, newPath);
    return NextResponse.json({ path, newPath, renamed, folders });
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status === 400) {
      return NextResponse.json({ error: error.message ?? 'Invalid folder request' }, { status: 400 });
    }
    if (error.status === 404) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }
    if (error.status === 409) {
      return NextResponse.json({ error: error.message ?? 'Folder rename conflict' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not rename folder' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const path = parseFolderPath(body.path);
    const files = await listNoteFiles();
    const deleted = files.filter((file) => isWithinFolder(file.name, path)).map((file) => file.name);

    for (const filename of deleted) {
      await deleteNoteFile(filename);
      await deleteRevisions(filename);
      await deletePublishHistory(filename);
      await deleteFileCategory(filename);
    }

    const folders = await deleteFolderEntries(path);
    return NextResponse.json({ path, deleted, folders });
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status === 400) {
      return NextResponse.json({ error: error.message ?? 'Invalid folder path' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not delete folder' }, { status: 500 });
  }
}
