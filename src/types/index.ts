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

export interface ApiError {
  error: string;
}
