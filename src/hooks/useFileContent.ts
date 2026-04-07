'use client';

import useSWR from 'swr';
import { FileContentResponse, Revision, RevisionInlineNote, RevisionStatus } from '@/types';
import { buildFileApiPath, buildFileDraftApiPath, buildFileRevisionsApiPath } from '@/lib/fileApiPath';

const EMPTY_REVISIONS: Revision[] = [];

class FileRequestError extends Error {
  status: number;

  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'FileRequestError';
    this.status = status;
  }
}

// Load one file record, including its current content and saved revisions.
const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        message = payload.error;
      }
    } catch {
      // Ignore invalid error payloads and fall back to the HTTP status text.
    }
    throw new FileRequestError(response.status, message);
  }
  return response.json();
};

interface SaveContentOptions {
  note?: string;
  tags?: string[];
  status?: RevisionStatus;
}

// Keep all "open file" data loading and save actions in one reusable hook.
export function useFileContent(
  filename: string | null,
  revisionId?: string | null,
  allowMissing = false,
  skipFetch = false,
) {
  const key = filename && !skipFetch
    ? `${buildFileApiPath(filename)}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<FileContentResponse>(
    key,
    async (url: string) => {
      try {
        return await fetcher(url);
      } catch (error) {
        if (allowMissing && filename && error instanceof FileRequestError && error.status === 404) {
          return {
            name: filename,
            content: '',
            revisions: [],
            revisionId: null,
            currentDraftRevisionId: null,
          } satisfies FileContentResponse;
        }
        throw error;
      }
    },
    {
    revalidateOnFocus: false,
    shouldRetryOnError: (err) => !(err instanceof FileRequestError && err.status >= 400 && err.status < 500),
    },
  );

  // Save the current editor text as the newest revision for this file.
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
    await mutate({ name: filename, content, revisions: response.revisions ?? data?.revisions ?? EMPTY_REVISIONS }, { revalidate: false });
  }

  // Switch the live draft back to a previously saved revision.
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

  // Save inline review notes that belong to one revision snapshot.
  async function updateRevisionInlineNotes(revisionId: string, inlineNotes: RevisionInlineNote[]): Promise<void> {
    if (!filename) return;
    const res = await fetch(buildFileRevisionsApiPath(filename), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId, inlineNotes }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not update revision notes');
    }
    await mutate();
  }

  return {
    content: data?.content ?? '',
    revisions: data?.revisions ?? EMPTY_REVISIONS,
    revisionId: data?.revisionId ?? null,
    currentDraftRevisionId: data?.currentDraftRevisionId ?? data?.revisionId ?? null,
    isLoading,
    error,
    saveContent,
    promoteRevisionAsDraft,
    updateRevisionInlineNotes,
    mutate,
  };
}
