'use client';

import useSWR from 'swr';
import { FileContentResponse } from '@/types';
import { getFileApiPath } from '@/lib/apiPath';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useFileContent(filename: string | null) {
  const key = filename ? getFileApiPath(filename) : null;
  const { data, error, isLoading, mutate } = useSWR<FileContentResponse>(key, fetcher, {
    revalidateOnFocus: false,
  });

  async function saveContent(content: string): Promise<void> {
    if (!filename) return;
    const res = await fetch(getFileApiPath(filename), {
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

  return {
    content: data?.content ?? '',
    isLoading,
    error,
    saveContent,
    mutate,
  };
}
