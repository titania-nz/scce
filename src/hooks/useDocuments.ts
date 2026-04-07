'use client';

import useSWR from 'swr';
import { DocumentBranchName, DocumentDashboardEntry, RevisionNote } from '@/types';
import { fetchJson } from '@/lib/fetchJson';

// Load the document dashboard list used by the review view.
const fetcher = (url: string) => fetchJson<{ documents: DocumentDashboardEntry[] }>(url, 'Could not load documents');

// Give React components one place to load document-review data and trigger related actions.
export function useDocuments() {
  const { data, error, isLoading, mutate } = useSWR('/api/files/documents', fetcher, {
    revalidateOnFocus: false,
  });

  // Move a revision into one of the review branches, such as draft or accepted.
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

  // Add a discussion comment to a specific immutable document revision.
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

  // Fetch the threaded comments for a single revision when the UI opens a discussion view.
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
