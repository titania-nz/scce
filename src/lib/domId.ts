function normalizeDomIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function domId(...parts: Array<string | number | null | undefined>): string {
  const normalized = parts
    .map((part) => {
      if (part === null || part === undefined) return '';
      return normalizeDomIdPart(String(part));
    })
    .filter(Boolean);

  return normalized.join('-');
}

export function domIdSuffix(
  value: unknown,
  fallback?: unknown,
): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate = record.id ?? record.name ?? record.path ?? record.label ?? record.title ?? record.key;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      return candidate;
    }
  }

  if (typeof fallback === 'string' || typeof fallback === 'number') {
    return fallback;
  }

  return undefined;
}
