import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, deleteFile, renameFile } from '@/lib/fileStorage';

type Params = { params: Promise<{ filename: string[] }> };

function getFilename(parts: string[]): string {
  return parts.join('/');
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { filename } = await params;
  const resolvedName = getFilename(filename);
  try {
    const content = await readFile(resolvedName);
    return NextResponse.json({ name: resolvedName, content });
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not read file' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { filename } = await params;
  const resolvedName = getFilename(filename);
  try {
    const body = await request.json();

    if ('newName' in body) {
      const { newName } = body;
      if (!newName || typeof newName !== 'string') {
        return NextResponse.json({ error: 'Invalid new filename' }, { status: 400 });
      }
      await renameFile(resolvedName, newName);
      return NextResponse.json({ name: newName });
    }

    if ('content' in body) {
      const { content } = body;
      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
      }
      await writeFile(resolvedName, content);
      return NextResponse.json({ name: resolvedName });
    }

    return NextResponse.json({ error: 'Missing content or newName' }, { status: 400 });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 409) return NextResponse.json({ error: 'File already exists' }, { status: 409 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not update file' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { filename } = await params;
  const resolvedName = getFilename(filename);
  try {
    await deleteFile(resolvedName);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not delete file' }, { status: 500 });
  }
}
