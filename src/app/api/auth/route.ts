import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_OPTIONS } from './cookie';
import { getAuthThrottleStatus, recordAuthFailure } from '@/lib/authThrottle';

const GENERIC_AUTH_ERROR = 'Invalid credentials';

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest) {
  // Login
  const body = await request.json().catch(() => ({}));
  const { password } = body as { password?: string };

  const authPassword = process.env.AUTH_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;

  if (!authPassword || !authSecret) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
  }

  const throttleStatus = await getAuthThrottleStatus(request);
  if (throttleStatus.blocked) {
    return NextResponse.json(
      {
        error: GENERIC_AUTH_ERROR,
        retryAfterSeconds: throttleStatus.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(throttleStatus.retryAfterSeconds),
        },
      },
    );
  }

  if (!password || password !== authPassword) {
    await recordAuthFailure(request);
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, authSecret, COOKIE_OPTIONS);
  return response;
}
