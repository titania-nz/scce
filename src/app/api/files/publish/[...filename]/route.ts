import { NextRequest, NextResponse } from 'next/server';
import { parseFilename } from '@/lib/parseFilename';
import { readFile, writeFile } from '@/lib/fileStorage';
import { readRevisions, writeRevisions } from '@/lib/revisionStorage';
import { readPublishHistory, writePublishHistory } from '@/lib/publishStorage';
import { PublishHistoryEntry, PublishTargetProfile, Revision } from '@/types';

type Params = { params: Promise<{ filename: string[] }> };

const PROFILES: PublishTargetProfile[] = [
  {
    id: 'docs-site',
    label: 'Docs site',
    type: 'docs-site',
    description: 'Publishes to generated docs output path.',
  },
  {
    id: 'cms-webhook',
    label: 'CMS webhook',
    type: 'cms-webhook',
    description: 'Publishes through CMS integration webhook payload.',
  },
  {
    id: 'git-commit',
    label: 'Git commit',
    type: 'git-commit',
    description: 'Creates a git-ready publish commit payload.',
  },
];

function findProfile(profileId: unknown): PublishTargetProfile {
  if (typeof profileId !== 'string') {
    throw Object.assign(new Error('Invalid publish profile'), { status: 400 });
  }
  const profile = PROFILES.find((item) => item.id === profileId);
  if (!profile) {
    throw Object.assign(new Error('Unknown publish profile'), { status: 400 });
  }
  return profile;
}

function buildOutcome(profile: PublishTargetProfile, filename: string, revisionId: string): string {
  if (profile.type === 'docs-site') {
    return `Published to /docs/${filename.replace(/\.md$/i, '.html')} from revision ${revisionId}`;
  }
  if (profile.type === 'cms-webhook') {
    const endpoint = process.env.CMS_PUBLISH_WEBHOOK_URL ?? 'https://cms.example.invalid/publish';
    return `Webhook payload queued for ${endpoint} (revision ${revisionId})`;
  }
  return `Prepared git commit for ${filename} at revision ${revisionId}`;
}

function getLatestRevision(revisions: Revision[]): Revision | null {
  return revisions.at(-1) ?? null;
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: NextRequest, { params }: Params) {
  const { filename: rawFilename } = await params;

  try {
    const filename = parseFilename(rawFilename);
    const [revisions, history] = await Promise.all([
      readRevisions(filename),
      readPublishHistory(filename),
    ]);

    const latest = getLatestRevision(revisions);

    return NextResponse.json({
      name: filename,
      canPublish: latest?.status === 'accepted',
      latestRevisionId: latest?.id ?? null,
      latestRevisionStatus: latest?.status,
      profiles: PROFILES,
      history,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not load publish metadata' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest, { params }: Params) {
  const { filename: rawFilename } = await params;

  try {
    const filename = parseFilename(rawFilename);
    const body = await request.json() as { action?: string; profileId?: unknown; entryId?: unknown };

    const revisions = await readRevisions(filename);
    const latest = getLatestRevision(revisions);
    const history = await readPublishHistory(filename);

    if (body.action === 'rollback') {
      if (typeof body.entryId !== 'string') {
        return NextResponse.json({ error: 'Invalid history entry' }, { status: 400 });
      }
      const target = history.find((entry) => entry.id === body.entryId);
      if (!target) {
        return NextResponse.json({ error: 'Publish history entry not found' }, { status: 404 });
      }

      await writeFile(filename, target.contentSnapshot);
      const rollbackRevision: Revision = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        content: target.contentSnapshot,
        note: `Rollback to publish ${target.id}`,
        status: 'needs-review',
        tags: ['rollback', 'published-history'],
      };
      await writeRevisions(filename, [...revisions, rollbackRevision]);

      const rollbackHistory: PublishHistoryEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        profileId: target.profileId,
        profileType: target.profileType,
        revisionId: rollbackRevision.id,
        outcome: `Rollback restored content from publish ${target.id}`,
        contentSnapshot: target.contentSnapshot,
      };

      const nextHistory = [rollbackHistory, ...history];
      await writePublishHistory(filename, nextHistory);
      return NextResponse.json({
        ok: true,
        action: 'rollback',
        history: nextHistory,
        latestRevisionStatus: rollbackRevision.status,
      });
    }

    if (!latest) {
      return NextResponse.json({ error: 'No revisions available for publishing' }, { status: 400 });
    }

    if (latest.status !== 'accepted') {
      return NextResponse.json({ error: 'Only accepted revisions can be published' }, { status: 409 });
    }

    const profile = findProfile(body.profileId);
    const snapshot = await readFile(filename);

    const entry: PublishHistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      profileId: profile.id,
      profileType: profile.type,
      revisionId: latest.id,
      outcome: buildOutcome(profile, filename, latest.id),
      contentSnapshot: snapshot,
    };

    const nextHistory = [entry, ...history];
    await writePublishHistory(filename, nextHistory);

    return NextResponse.json({
      ok: true,
      action: 'publish',
      history: nextHistory,
      published: entry,
      latestRevisionStatus: latest.status,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not run publish action' }, { status: 500 });
  }
}
