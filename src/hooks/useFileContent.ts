'use client';

import useSWR from 'swr';
import { FileContentResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useFileContent(filename: string | null, revisionId?: string | null) {
  const key = filename
    ? `/api/files/${encodeURIComponent(filename)}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<FileContentResponse>(key, fetcher, {
    revalidateOnFocus: false,
  });

  async function saveContent(content: string): Promise<void> {
    if (!filename) return;
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not save file');
    }
    await mutate({ name: filename, content }, { revalidate: false });
  }

  async function promoteRevisionAsDraft(nextRevisionId: string): Promise<void> {
    if (!filename) return;
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId: nextRevisionId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not promote revision');
    }
    await mutate();
  }

  return {
    content: data?.content ?? '',
    revisionId: data?.revisionId ?? null,
    currentDraftRevisionId: data?.currentDraftRevisionId ?? data?.revisionId ?? null,
    isLoading,
    error,
    saveContent,
    promoteRevisionAsDraft,
    mutate,
  };
}
