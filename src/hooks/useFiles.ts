'use client';

import useSWR from 'swr';
import { FileEntry, FileListResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useFiles() {
  const { data, error, isLoading, mutate } = useSWR<FileListResponse>('/api/files', fetcher);

  async function createFile(name: string, content = ''): Promise<FileEntry | null> {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not create file');
    }
    const created = await res.json();
    await mutate();
    return created;
  }

  async function deleteFile(filename: string): Promise<void> {
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not delete file');
    }
    await mutate();
  }

  async function renameFile(oldName: string, newName: string): Promise<void> {
    const res = await fetch(`/api/files/${encodeURIComponent(oldName)}`, {
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

  return {
    files: data?.files ?? [],
    isLoading,
    error,
    createFile,
    deleteFile,
    renameFile,
    mutate,
  };
}
