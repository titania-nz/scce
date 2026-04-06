export function getFileApiPath(filename: string): string {
  const segments = filename.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment));
  return `/api/files/${segments.join('/')}`;
}
