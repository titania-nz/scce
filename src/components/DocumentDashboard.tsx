'use client';

import { useMemo, useState } from 'react';
import { DocumentDashboardEntry, RevisionNote } from '@/types';

interface DocumentDashboardProps {
  documents: DocumentDashboardEntry[];
  isLoading: boolean;
  onPromote: (documentId: string, revisionId: string) => Promise<void>;
  onSetAccepted: (documentId: string, revisionId: string) => Promise<void>;
  onSetDraft: (documentId: string, revisionId: string) => Promise<void>;
  onAddComment: (documentId: string, revisionId: string, message: string, parentId?: string) => Promise<void>;
  onSelectFile: (filename: string) => void;
}

function buildThread(notes: RevisionNote[]): Map<string, RevisionNote[]> {
  const byParent = new Map<string, RevisionNote[]>();
  for (const note of notes) {
    const key = note.parentId ?? 'root';
    const list = byParent.get(key) ?? [];
    list.push(note);
    byParent.set(key, list);
  }
  return byParent;
}

function Thread({
  tree,
  parentId,
  depth,
}: {
  tree: Map<string, RevisionNote[]>;
  parentId: string;
  depth: number;
}) {
  const items = tree.get(parentId) ?? [];
  if (items.length === 0) return null;

  return (
    <ul className="space-y-1">
      {items.map((note) => (
        <li key={note.id} className="text-xs text-gray-300">
          <div className="rounded border border-gray-700 bg-gray-900/60 p-2" style={{ marginLeft: `${depth * 12}px` }}>
            <div>{note.message}</div>
            <div className="mt-1 text-[10px] text-gray-500">{new Date(note.createdAt).toLocaleString()}</div>
          </div>
          <Thread tree={tree} parentId={note.id} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export default function DocumentDashboard({
  documents,
  isLoading,
  onPromote,
  onSetAccepted,
  onSetDraft,
  onAddComment,
  onSelectFile,
}: DocumentDashboardProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const sortedDocuments = useMemo(
    () => [...documents].sort((a, b) => a.document.name.localeCompare(b.document.name)),
    [documents],
  );

  if (isLoading) {
    return <div className="p-3 text-sm text-gray-400">Loading document dashboard…</div>;
  }

  if (sortedDocuments.length === 0) {
    return <div className="p-3 text-sm text-gray-500">No documents have immutable revisions yet.</div>;
  }

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <h2 className="text-sm font-semibold text-gray-200">Document dashboard</h2>
      {sortedDocuments.map((entry) => {
        const isOpen = expanded[entry.document.id] ?? false;

        return (
          <section key={entry.document.id} className="rounded border border-gray-700 bg-gray-800/60">
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [entry.document.id]: !isOpen }))}
              className="w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-gray-700/60"
            >
              <span className="text-gray-100 font-medium">{entry.document.name}</span>
              <span className="text-gray-400">{entry.revisions.length} revisions</span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 space-y-2">
                <div className="text-[11px] text-gray-400">
                  Review branches: Draft {entry.branches.draftRevisionId ?? '—'} · Accepted {entry.branches.acceptedRevisionId ?? '—'} · Canonical {entry.branches.canonicalRevisionId ?? '—'}
                </div>

                <div className="text-[11px] text-gray-400">
                  Milestones: {entry.branches.milestones.length === 0 ? 'none' : ''}
                  {entry.branches.milestones.map((m) => (
                    <div key={m.id} className="text-gray-500">• {m.label} ({new Date(m.createdAt).toLocaleDateString()})</div>
                  ))}
                </div>

                {[...entry.revisions].reverse().map((revision) => {
                  const comments = revision.notes;
                  const tree = buildThread(comments);
                  const key = `${entry.document.id}:${revision.id}`;
                  return (
                    <article key={revision.id} className="rounded border border-gray-700 bg-gray-900/50 p-2">
                      <div className="flex flex-wrap items-center gap-1 text-[11px]">
                        <button className="text-blue-300 hover:underline" onClick={() => entry.document.sourceFilename && onSelectFile(entry.document.sourceFilename)}>
                          {revision.id}
                        </button>
                        <span className="text-gray-500">{new Date(revision.createdAt).toLocaleString()}</span>
                        {revision.status && (
                          <span className={`px-1 py-0.5 rounded ${
                            revision.status === 'Locked'
                              ? 'bg-amber-900/60 text-amber-200'
                              : revision.status === 'Editing'
                                ? 'bg-blue-900/60 text-blue-200'
                                : 'bg-emerald-900/60 text-emerald-200'
                          }`}>
                            {revision.status}
                          </span>
                        )}
                        {entry.branches.canonicalRevisionId === revision.id && <span className="px-1 py-0.5 rounded bg-emerald-900/60 text-emerald-200">Canonical</span>}
                        {entry.branches.acceptedRevisionId === revision.id && <span className="px-1 py-0.5 rounded bg-indigo-900/60 text-indigo-200">Accepted</span>}
                        {entry.branches.draftRevisionId === revision.id && <span className="px-1 py-0.5 rounded bg-amber-900/60 text-amber-200">Draft</span>}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => onSetDraft(entry.document.id, revision.id)} className="text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Set draft</button>
                        <button onClick={() => onSetAccepted(entry.document.id, revision.id)} className="text-[11px] px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600">Set accepted</button>
                        <button onClick={() => onPromote(entry.document.id, revision.id)} className="text-[11px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600">Promote to canonical version</button>
                      </div>

                      <div className="mt-2 space-y-2">
                        <Thread tree={tree} parentId="root" depth={0} />
                        <div className="flex gap-2">
                          <input
                            className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs"
                            placeholder="Add threaded comment"
                            value={commentDrafts[key] ?? ''}
                            onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                          />
                          <button
                            className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600"
                            onClick={async () => {
                              const message = commentDrafts[key]?.trim();
                              if (!message) return;
                              await onAddComment(entry.document.id, revision.id, message);
                              setCommentDrafts((prev) => ({ ...prev, [key]: '' }));
                            }}
                          >
                            Comment
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
