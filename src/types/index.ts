export interface FileEntry {
  name: string;
  mtime: string;
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
}

export interface ApiError {
  error: string;
}
