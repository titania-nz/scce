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
