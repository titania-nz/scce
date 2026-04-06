export function buildFileApiPath(filename: string, suffix = ''): string {
  const encoded = filename
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const normalizedSuffix = suffix.startsWith('/') || suffix.length === 0 ? suffix : `/${suffix}`;
  return `/api/files/${encoded}${normalizedSuffix}`;
}
