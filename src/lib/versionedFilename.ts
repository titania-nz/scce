function splitExtension(filename: string): { stem: string; extension: string } {
  const slashIndex = filename.lastIndexOf('/');
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= slashIndex) {
    return { stem: filename, extension: '' };
  }
  return {
    stem: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

export function buildVersionedFilename(filename: string, version: number): string {
  const { stem, extension } = splitExtension(filename);
  return `${stem}-v${version}${extension}`;
}

export function getNextVersionedFilename(filename: string): string {
  const { stem, extension } = splitExtension(filename);
  const match = stem.match(/^(.*)-v(\d+)$/);
  if (!match) {
    return buildVersionedFilename(filename, 1);
  }
  return `${match[1]}-v${Number(match[2]) + 1}${extension}`;
}

export function findAvailableVersionedFilename(filename: string, takenNames: Iterable<string>): string {
  const taken = new Set(takenNames);
  if (!taken.has(filename)) {
    return filename;
  }

  let version = 1;
  let candidate = buildVersionedFilename(filename, version);
  while (taken.has(candidate)) {
    version += 1;
    candidate = buildVersionedFilename(filename, version);
  }
  return candidate;
}
