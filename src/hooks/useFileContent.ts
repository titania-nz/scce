'use client';

import useSWR from 'swr';
import { FileContentResponse, Revision, RevisionStatus } from '@/types';
import { buildFileApiPath, buildFileDraftApiPath } from '@/lib/fileApiPath';
import { fetchJson } from '@/lib/fetchJson';

const fetcher = (url: string) => fetchJson<FileContentResponse>(url, 'Could not load file content');

interface SaveContentOptions {
  note?: string;
  tags?: string[];
  status?: RevisionStatus;
}

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export function useFileContent(filename: string | null, revisionId?: string | null) {
  const key = filename
    ? `${buildFileApiPath(filename)}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<FileContentResponse>(key, fetcher, {
    revalidateOnFocus: false,
  });

  async function saveContent(content: string, options: SaveContentOptions = {}): Promise<void> {
    if (!filename) return;
    const res = await fetch(buildFileApiPath(filename), {
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

  async function promoteRevisionAsDraft(nextRevisionId: string): Promise<void> {
    if (!filename) return;
    const res = await fetch(buildFileDraftApiPath(filename), {
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
    revisions: data?.revisions ?? [],
    revisionId: data?.revisionId ?? null,
    currentDraftRevisionId: data?.currentDraftRevisionId ?? data?.revisionId ?? null,
    isLoading,
    error,
    saveContent,
    promoteRevisionAsDraft,
    mutate,
  };
}
