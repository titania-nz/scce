interface AttemptState {
  count: number;
  firstFailureAt: number;
  blockedUntil: number;
}

interface AuthThrottleStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const BLOCK_MS = 2 * 60 * 1000;

const attemptsByIp = new Map<string, AttemptState>();

function now(): number {
  return Date.now();
}

function getClientKey(ip: string | null): string {
  return ip?.trim() || 'unknown';
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function createAuthToken(secret: string): string {
  return secret;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function getAuthThrottleStatus(ip: string | null): AuthThrottleStatus {
  const key = getClientKey(ip);
  const state = attemptsByIp.get(key);
  if (!state) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const nowTs = now();

  if (state.blockedUntil > nowTs) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - nowTs) / 1000)),
    };
  }

  if (nowTs - state.firstFailureAt > WINDOW_MS) {
    attemptsByIp.delete(key);
    return { blocked: false, retryAfterSeconds: 0 };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export function recordAuthFailure(ip: string | null): AuthThrottleStatus {
  const key = getClientKey(ip);
  const nowTs = now();
  const existing = attemptsByIp.get(key);

  if (!existing || nowTs - existing.firstFailureAt > WINDOW_MS) {
    attemptsByIp.set(key, {
      count: 1,
      firstFailureAt: nowTs,
      blockedUntil: 0,
    });
    return { blocked: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count >= MAX_FAILURES) {
    existing.blockedUntil = nowTs + BLOCK_MS;
  }
  attemptsByIp.set(key, existing);

  return getAuthThrottleStatus(ip);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export function resetAuthFailures(ip: string | null): void {
  attemptsByIp.delete(getClientKey(ip));
}
