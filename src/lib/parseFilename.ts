// Rebuild the full file path from route params, even when a catch-all param
// arrives as one encoded string instead of clean path segments.
export function parseFilename(segments: string[] | string | undefined): string {
  const normalizedSegments = (Array.isArray(segments) ? segments : [segments])
    .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
    .flatMap((segment) => decodeURIComponent(segment).split('/'))
    .filter(Boolean);

  const filename = normalizedSegments.join('/');
  if (!filename) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return filename;
}
