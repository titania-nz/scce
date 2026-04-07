// Rebuild the full file path from the URL pieces captured by the route.
export function parseFilename(segments: string[]): string {
  const filename = segments.join('/');
  if (!filename) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return filename;
}
