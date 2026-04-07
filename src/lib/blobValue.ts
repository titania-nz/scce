// Treat only absent blob values as missing so empty files remain addressable.
export function isMissingBlobValue(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}
