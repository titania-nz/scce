interface AuthThrottleStatus {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface AuthAttemptState {
  failedAttempts: number;
  blockedUntil: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_WINDOW_MS = 5 * 60 * 1000;

const attemptsByIp = new Map<string, AuthAttemptState>();

// Return the current time in milliseconds so the throttle logic is easy to test.
function now(): number {
  return Date.now();
}

// Identify the caller as best we can so repeated failed logins can be rate-limited.
function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}

// Check whether this request should still be allowed to attempt a login.
export function getAuthThrottleStatus(request: Request): AuthThrottleStatus {
  const ip = getClientIp(request);
  const state = attemptsByIp.get(ip);
  if (!state) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const currentTime = now();
  if (state.blockedUntil <= currentTime) {
    attemptsByIp.delete(ip);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((state.blockedUntil - currentTime) / 1000),
  };
}

// Record one failed login and start a temporary block after too many misses.
export function recordAuthFailure(request: Request): void {
  const ip = getClientIp(request);
  const state = attemptsByIp.get(ip) ?? { failedAttempts: 0, blockedUntil: 0 };

  const failedAttempts = state.failedAttempts + 1;
  const shouldBlock = failedAttempts >= MAX_FAILED_ATTEMPTS;

  attemptsByIp.set(ip, {
    failedAttempts: shouldBlock ? 0 : failedAttempts,
    blockedUntil: shouldBlock ? now() + BLOCK_WINDOW_MS : 0,
  });
}

// Return the current auth token payload used by the login route.
export function createAuthToken(secret: string): string {
  return secret;
}
