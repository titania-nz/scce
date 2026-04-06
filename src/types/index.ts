export interface FileEntry {
  name: string;
  mtime: string;
  ctime?: string;
  size: number;
}

export interface FileListResponse {
  files: FileEntry[];
}

export type RevisionStatus = 'accepted' | 'rejected' | 'needs-review';

export interface Revision {
  id: string;
  createdAt: string;
  content: string;
  note: string;
  tags?: string[];
  status?: RevisionStatus;
}

export interface FileContentResponse {
  name: string;
  content: string;
  revisions: Revision[];
}

export interface SaveFileRequest {
  content: string;
  note?: string;
  tags?: string[];
  status?: RevisionStatus;
  revisionId?: string | null;
  currentDraftRevisionId?: string | null;
}

export interface RevisionNote {
  id: string;
  message: string;
  createdAt: string;
}

export interface Document {
  id: string;
  name: string;
  createdAt: string;
  sourceFilename?: string;
}

export interface Revision {
  id: string;
  documentId: string;
  createdAt: string;
  content: string;
  notes: RevisionNote[];
}

export interface CreateDocumentInput {
  id: string;
  name: string;
  sourceFilename?: string;
  createdAt?: string;
}

export interface CreateRevisionInput {
  content: string;
  createdAt?: string;
  notes?: RevisionNote[];
}

export interface ApiError {
  error: string;
}

export interface RevisionEntry {
  id: string;
  createdAt: string;
  size: number;
}

export interface FileRevisionsResponse {
  name: string;
  currentDraftRevisionId: string | null;
  revisions: RevisionEntry[];
}
