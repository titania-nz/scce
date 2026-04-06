'use client';

import useSWR from 'swr';
import { DocumentBranchName, DocumentDashboardEntry, RevisionNote } from '@/types';
import { fetchJson } from '@/lib/fetchJson';

const fetcher = (url: string) => fetchJson<{ documents: DocumentDashboardEntry[] }>(url, 'Could not load documents');

export function useDocuments() {
  const { data, error, isLoading, mutate } = useSWR('/api/files/documents', fetcher, {
    revalidateOnFocus: false,
  });

  async function promoteRevision(documentId: string, revisionId: string, branch: DocumentBranchName): Promise<void> {
    const res = await fetch(`/api/files/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not promote revision');
    }
    await mutate();
  }

  async function addComment(documentId: string, revisionId: string, message: string, parentId?: string): Promise<void> {
    const res = await fetch(`/api/files/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, parentId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Could not add comment');
    }
    await mutate();
  }

  async function getComments(documentId: string, revisionId: string): Promise<RevisionNote[]> {
    const payload = await fetchJson<{ comments: RevisionNote[] }>(
      `/api/files/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}/comments`,
      'Could not load comments',
    );
    return payload.comments;
  }

  return {
    documents: data?.documents ?? [],
    isLoading,
    error,
    mutate,
    promoteRevision,
    addComment,
    getComments,
  };
}
