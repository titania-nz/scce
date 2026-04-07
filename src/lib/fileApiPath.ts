// Safely encode every folder segment in a file path before using it in a URL.
function encodeFileSegments(filename: string): string {
  return filename
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

// Build the main API path for reading or updating a file.
export function buildFileApiPath(filename: string): string {
  return `/api/files/${encodeFileSegments(filename)}`;
}

// Build the API path that switches the current draft to a chosen revision.
export function buildFileDraftApiPath(filename: string): string {
  return `/api/files/draft/${encodeFileSegments(filename)}`;
}

// Build the API path for revision-specific actions on a file.
export function buildFileRevisionsApiPath(filename: string): string {
  return `/api/files/revisions/${encodeFileSegments(filename)}`;
}

// Build the API path for document-style immutable revisions used by the dashboard.
export function buildDocumentRevisionApiPath(documentId: string, revisionId?: string): string {
  const base = `/api/files/documents/${encodeURIComponent(documentId)}/revisions`;
  return revisionId ? `${base}/${encodeURIComponent(revisionId)}` : base;
}

// Build the API path for exporting a file in another format.
export function buildFileExportApiPath(filename: string): string {
  return `/api/files/export/${encodeFileSegments(filename)}`;
}

// Build the API path for publish and rollback actions.
export function buildFilePublishApiPath(filename: string): string {
  return `/api/files/publish/${encodeFileSegments(filename)}`;
}
