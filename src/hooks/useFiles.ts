'use client';

import useSWR from 'swr';
import {
  FileCategory,
  FileEntry,
  FileListResponse,
  FolderDeleteResponse,
  FolderRenameResponse,
} from '@/types';
import { buildFileApiPath } from '@/lib/fileApiPath';
import { findAvailableVersionedFilename, getNextVersionedFilename } from '@/lib/versionedFilename';

const EMPTY_FILES: FileEntry[] = [];
const EMPTY_FOLDERS: string[] = [];

// Load the sidebar file list from the API.
const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function sortFiles(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

function sortFolders(folders: string[]): string[] {
  return [...folders].sort((a, b) => a.localeCompare(b));
}

function makeOptimisticFile(name: string, content = ''): FileEntry {
  const now = new Date().toISOString();
  return {
    name,
    size: content.length,
    mtime: now,
    ctime: now,
    category: null,
  };
}

// Centralize the basic file-management actions used across the editor UI.
export function useFiles() {
  const { data, error, isLoading, mutate } = useSWR<FileListResponse>('/api/files', fetcher);

  // Create a brand-new markdown file.
  async function createFile(name: string, content = ''): Promise<FileEntry | null> {
    let createdFile: FileEntry | null = null;

    await mutate(
      async (current) => {
        const existingNames = current?.files?.map((file) => file.name) ?? [];
        let candidateName = findAvailableVersionedFilename(name, existingNames);

        while (true) {
          const res = await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: candidateName, content }),
          });
          if (res.ok) {
            const created = (await res.json()) as Partial<FileEntry> & { name: string };
            createdFile = {
              ...makeOptimisticFile(candidateName, content),
              ...created,
              name: created.name,
            };

            return {
              files: sortFiles([
                ...(current?.files ?? []).filter((file) => file.name !== createdFile?.name),
                createdFile,
              ]),
              folders: current?.folders ?? EMPTY_FOLDERS,
            };
          }

          const err = await res.json().catch(() => ({})) as { error?: string };
          if (res.status !== 409) {
            throw new Error(err.error ?? 'Could not create file');
          }

          candidateName = getNextVersionedFilename(candidateName);
        }
      },
      {
        optimisticData: (current) => {
          const optimisticName = findAvailableVersionedFilename(name, current?.files?.map((file) => file.name) ?? []);
          const optimisticFile = makeOptimisticFile(optimisticName, content);
          return {
            files: sortFiles([...(current?.files ?? []).filter((file) => file.name !== optimisticName), optimisticFile]),
            folders: current?.folders ?? EMPTY_FOLDERS,
          };
        },
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      },
    );

    void mutate();
    return createdFile;
  }

  // Remove one markdown file from storage.
  async function deleteFile(filename: string): Promise<void> {
    await mutate(
      async (current) => {
        const res = await fetch(buildFileApiPath(filename), { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Could not delete file');
        }

        return {
          files: (current?.files ?? []).filter((file) => file.name !== filename),
        };
      },
      {
        optimisticData: (current) => ({
          files: (current?.files ?? []).filter((file) => file.name !== filename),
        }),
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      },
    );

    void mutate();
  }

  // Remove several files in one action, then refresh the sidebar list once.
  async function deleteFiles(filenames: string[]): Promise<void> {
    const pendingDeletes = new Set(filenames);

    await mutate(
      async (current) => {
        await Promise.all(
          filenames.map(async (filename) => {
            const res = await fetch(buildFileApiPath(filename), { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error ?? `Could not delete ${filename}`);
            }
          }),
        );

        return {
          files: (current?.files ?? []).filter((file) => !pendingDeletes.has(file.name)),
        };
      },
      {
        optimisticData: (current) => ({
          files: (current?.files ?? []).filter((file) => !pendingDeletes.has(file.name)),
        }),
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      },
    );

    void mutate();
  }

  // Change a file's name while keeping the sidebar in sync.
  async function renameFile(oldName: string, newName: string): Promise<void> {
    const res = await fetch(buildFileApiPath(oldName), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not rename file');
    }
    await mutate();
  }

  // Save or clear a file's explicit document/chapter category.
  async function updateFileCategory(filename: string, category: FileCategory | null): Promise<FileCategory | null> {
    const res = await fetch(buildFileApiPath(filename), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not update file category');
    }
    const updated = (await res.json()) as { category?: FileCategory | null };
    await mutate();
    return updated.category ?? null;
  }

  async function createFolder(path: string): Promise<string[]> {
    const res = await fetch('/api/files/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not create folder');
    }

    const payload = (await res.json()) as { folders?: string[] };
    await mutate((current) => ({
      files: current?.files ?? [],
      folders: sortFolders(payload.folders ?? current?.folders ?? []),
    }), { revalidate: false });
    void mutate();
    return payload.folders ?? [];
  }

  async function renameFolder(path: string, newPath: string): Promise<FolderRenameResponse> {
    const res = await fetch('/api/files/folders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, newPath }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not rename folder');
    }

    const payload = (await res.json()) as FolderRenameResponse;
    await mutate();
    return payload;
  }

  async function deleteFolder(path: string): Promise<FolderDeleteResponse> {
    const res = await fetch('/api/files/folders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not delete folder');
    }

    const payload = (await res.json()) as FolderDeleteResponse;
    await mutate();
    return payload;
  }

  return {
    files: data?.files ?? EMPTY_FILES,
    folders: data?.folders ? sortFolders(data.folders) : EMPTY_FOLDERS,
    isLoading,
    error,
    createFile,
    createFolder,
    deleteFile,
    deleteFiles,
    deleteFolder,
    renameFile,
    renameFolder,
    updateFileCategory,
    mutate,
  };
}
