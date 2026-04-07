// Treat only absent blob values as missing so empty files remain addressable.
export function isMissingBlobValue(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

// Normalize Netlify Blob payloads so callers can read text regardless of
// whether the SDK returns strings, binary buffers, or Blob instances.
export async function readBlobText(value: unknown): Promise<string> {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.text();
  }

  throw new TypeError('Unsupported blob value');
}
