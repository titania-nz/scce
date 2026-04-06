import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_OPTIONS } from './cookie';
import {
  createAuthToken,
  getAuthThrottleStatus,
  recordAuthFailure,
  resetAuthFailures,
} from '@/lib/authThrottle';

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest) {
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const throttle = getAuthThrottleStatus(clientIp);
  if (throttle.blocked) {
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
    recordAuthFailure(clientIp);
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  resetAuthFailures(clientIp);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, createAuthToken(authSecret), COOKIE_OPTIONS);
  return response;
}
