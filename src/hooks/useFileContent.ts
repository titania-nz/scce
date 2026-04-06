'use client';

import useSWR from 'swr';
import { FileContentResponse, Revision, RevisionStatus } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SaveContentOptions {
  note?: string;
  tags?: string[];
  status?: RevisionStatus;
}

export function useFileContent(filename: string | null) {
  const key = filename ? `/api/files/${encodeURIComponent(filename)}` : null;
  const { data, error, isLoading, mutate } = useSWR<FileContentResponse>(key, fetcher, {
    revalidateOnFocus: false,
  });

  async function saveContent(content: string, options: SaveContentOptions = {}): Promise<void> {
    if (!filename) return;
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        note: options.note ?? '',
        tags: options.tags ?? [],
        status: options.status,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not save file');
    }

    const response = (await res.json()) as { revisions?: Revision[] };
    await mutate({ name: filename, content, revisions: response.revisions ?? data?.revisions ?? [] }, { revalidate: false });
  }

  return {
    content: data?.content ?? '',
    revisions: data?.revisions ?? [],
    isLoading,
    error,
    saveContent,
    mutate,
  };
}
