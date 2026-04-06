export interface FileEntry {
  name: string;
  mtime: string;
  size: number;
}

export interface FileListResponse {
  files: FileEntry[];
}

export interface FileContentResponse {
  name: string;
  content: string;
  revisionId?: string | null;
  currentDraftRevisionId?: string | null;
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
