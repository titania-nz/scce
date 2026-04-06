import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'auth-token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  // 30 days
  maxAge: 60 * 60 * 24 * 30,
};

export async function POST(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.endsWith('/logout')) {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }

  // Login
  const body = await request.json().catch(() => ({}));
  const { password } = body as { password?: string };

  const authPassword = process.env.AUTH_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;

  if (!authPassword || !authSecret) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
  }

  if (!password || password !== authPassword) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, authSecret, COOKIE_OPTIONS);
  return response;
}
