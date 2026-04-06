function encodeFileSegments(filename: string): string {
  return filename
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildFileApiPath(filename: string): string {
  return `/api/files/${encodeFileSegments(filename)}`;
}

export function buildFileDraftApiPath(filename: string): string {
  return `/api/files/draft/${encodeFileSegments(filename)}`;
}

export function buildFileRevisionsApiPath(filename: string): string {
  return `/api/files/revisions/${encodeFileSegments(filename)}`;
}

export function buildDocumentRevisionApiPath(documentId: string, revisionId?: string): string {
  const base = `/api/files/documents/${encodeURIComponent(documentId)}/revisions`;
  return revisionId ? `${base}/${encodeURIComponent(revisionId)}` : base;
}

export function buildFileExportApiPath(filename: string): string {
  return `/api/files/export/${encodeFileSegments(filename)}`;
}

export function buildFilePublishApiPath(filename: string): string {
  return `/api/files/publish/${encodeFileSegments(filename)}`;
}
