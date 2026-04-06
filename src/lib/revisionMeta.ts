import { Revision } from '@/types';

export interface RevisionMetaSummary {
  tags: string[];
  note: string;
  status: string;
}

export const DEFAULT_REVISION_META: RevisionMetaSummary = {
  tags: [],
  note: '',
  status: '',
};

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith('---\n')) {
    return { frontmatter: '', body: content };
  }

  const endMarkerIndex = content.indexOf('\n---\n', 4);
  if (endMarkerIndex === -1) {
    return { frontmatter: '', body: content };
  }

  return {
    frontmatter: content.slice(4, endMarkerIndex),
    body: content.slice(endMarkerIndex + 5),
  };
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function parseMetaFromContent(content: string): RevisionMetaSummary {
  if (!content) return DEFAULT_REVISION_META;
  const { frontmatter, body } = splitFrontmatter(content);

  const tags = new Set<string>();
  let note = '';
  let status = '';

  if (frontmatter) {
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const [rawKey, ...valueParts] = line.split(':');
      if (!rawKey || valueParts.length === 0) continue;
      const key = rawKey.trim().toLowerCase();
      const rawValue = valueParts.join(':').trim();
      if (!rawValue) continue;

      if (key === 'status') {
        status = rawValue.replace(/^["']|["']$/g, '').toLowerCase();
      }

      if (key === 'note' || key === 'summary') {
        note = rawValue.replace(/^["']|["']$/g, '');
      }

      if (key === 'tag' || key === 'tags') {
        const cleaned = rawValue.replace(/^\[|\]$/g, '');
        cleaned
          .split(',')
          .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
          .forEach((tag) => tags.add(tag.toLowerCase()));
      }
    }
  }

  if (!note) {
    const firstBodyLine = body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#'));
    note = firstBodyLine ? firstBodyLine.slice(0, 120) : '';
  }

  if (tags.size === 0) {
    const tagMatches = body.match(/(^|\s)#([a-zA-Z0-9_-]+)/g) ?? [];
    tagMatches.forEach((match) => {
      const tag = match.trim().replace(/^#/, '').toLowerCase();
      if (tag) tags.add(tag);
    });
  }

  return {
    tags: Array.from(tags),
    note,
    status,
  };
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function summarizeRevisionMeta(revisions: Revision[]): RevisionMetaSummary {
  const latest = revisions.at(-1);
  if (!latest) return DEFAULT_REVISION_META;
  return {
    tags: latest.tags?.filter(Boolean).map((tag) => tag.toLowerCase()) ?? [],
    note: latest.note?.trim() ?? '',
    status: latest.status ?? '',
  };
}
