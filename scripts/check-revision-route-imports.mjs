import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routePath = resolve('src/app/api/files/revisions/[...filename]/route.ts');
const source = readFileSync(routePath, 'utf8');

const readRevisionsImports = source.match(/import\s*\{[^}]*\breadRevisions\b[^}]*\}\s*from\s*['"]@\/lib\/revisionStorage['"];?/g) ?? [];

if (readRevisionsImports.length !== 1) {
  console.error(
    `Expected exactly 1 readRevisions import from @/lib/revisionStorage in ${routePath}, found ${readRevisionsImports.length}.`,
  );
  process.exit(1);
}

console.log(`Import check passed for ${routePath}.`);
