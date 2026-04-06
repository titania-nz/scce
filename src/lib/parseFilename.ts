export function parseFilename(segments: string[]): string {
  const filename = segments.join('/');
  if (!filename) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return filename;
}
