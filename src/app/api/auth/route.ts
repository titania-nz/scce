import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_OPTIONS } from './cookie';
import { createAuthToken, getAuthThrottleStatus, recordAuthFailure } from '@/lib/authThrottle';

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest) {
  const throttle = getAuthThrottleStatus(request);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${throttle.retryAfterSeconds}s.` },
      { status: 429 },
    );
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
    recordAuthFailure(request);
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const token = createAuthToken(authSecret);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return response;
}
