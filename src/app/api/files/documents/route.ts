import { NextResponse } from 'next/server';
import { listDocumentDashboardEntries } from '@/lib/fileStorage';

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET() {
  try {
    const documents = await listDocumentDashboardEntries();
    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json({ error: 'Could not list documents' }, { status: 500 });
  }
}
