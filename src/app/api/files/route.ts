import { NextRequest, NextResponse } from 'next/server';
import { createRevision, fileExists, listFiles, writeFile } from '@/lib/fileStorage';

export async function GET() {
  try {
    const files = await listFiles();
    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ error: 'Could not read notes directory' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, content = '' } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }
    if (!name.endsWith('.md')) {
      return NextResponse.json({ error: 'Filename must end with .md' }, { status: 400 });
    }
    if (await fileExists(name)) {
      return NextResponse.json({ error: 'File already exists' }, { status: 409 });
    }

    await writeFile(name, content);
    await createRevision(name, content, { setAsDraft: true });
    return NextResponse.json({ name }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid filename' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not create file' }, { status: 500 });
  }
}
