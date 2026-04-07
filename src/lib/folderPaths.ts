const VALID_FOLDER_PATH = /^[a-zA-Z0-9_\-. /]+$/;
const MAX_FOLDER_PATH_LENGTH = 255;

export function normalizeFolderPath(input: string): string {
  const value = input.trim();
  if (!value || value.length > MAX_FOLDER_PATH_LENGTH) {
    throw Object.assign(new Error('Invalid folder path'), { status: 400 });
  }
  if (value.includes('\\') || !VALID_FOLDER_PATH.test(value)) {
    throw Object.assign(new Error('Invalid folder path'), { status: 400 });
  }

  const segments = value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw Object.assign(new Error('Invalid folder path'), { status: 400 });
  }

  return segments.join('/');
}

export function getFolderName(folderPath: string): string {
  const normalized = normalizeFolderPath(folderPath);
  const segments = normalized.split('/');
  return segments[segments.length - 1];
}

export function getParentFolderPath(folderPath: string): string | null {
  const normalized = normalizeFolderPath(folderPath);
  const segments = normalized.split('/');
  if (segments.length <= 1) return null;
  return segments.slice(0, -1).join('/');
}

export function joinFolderPath(parentPath: string | null, childName: string): string {
  const trimmedChild = childName.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmedChild) {
    throw Object.assign(new Error('Invalid folder path'), { status: 400 });
  }

  return normalizeFolderPath(parentPath ? `${parentPath}/${trimmedChild}` : trimmedChild);
}

export function isWithinFolder(filePath: string, folderPath: string): boolean {
  const normalizedFolder = normalizeFolderPath(folderPath);
  return filePath.startsWith(`${normalizedFolder}/`);
}

export function replaceFolderPrefix(targetPath: string, oldFolderPath: string, newFolderPath: string): string {
  const normalizedOld = normalizeFolderPath(oldFolderPath);
  const normalizedNew = normalizeFolderPath(newFolderPath);

  if (targetPath === normalizedOld) {
    return normalizedNew;
  }
  if (!targetPath.startsWith(`${normalizedOld}/`)) {
    return targetPath;
  }

  return `${normalizedNew}/${targetPath.slice(normalizedOld.length + 1)}`;
}

export function collectFolderPrefixes(filename: string): string[] {
  const segments = filename.split('/').filter(Boolean);
  const prefixes: string[] = [];

  for (let index = 1; index < segments.length - 1; index += 1) {
    prefixes.push(segments.slice(0, index).join('/'));
  }

  return prefixes;
}
