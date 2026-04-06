import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { getStore } from '@netlify/blobs';
import { isNetlifyRuntime } from '@/lib/netlifyRuntime';

interface ThrottleBucket {
  count: number;
  resetAt: number;
}

interface PrincipalThrottleStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

const THROTTLE_STORE = 'auth-throttle';
const DEFAULT_WINDOW_SECONDS = 5 * 60;
const DEFAULT_MAX_ATTEMPTS = 8;
const MEMORY_BUCKETS = new Map<string, ThrottleBucket>();

function nowMs(): number {
  return Date.now();
}

function throttleWindowMs(): number {
  const configured = Number(process.env.AUTH_THROTTLE_WINDOW_SECONDS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured * 1_000;
  }
  return DEFAULT_WINDOW_SECONDS * 1_000;
}

function maxAttempts(): number {
  const configured = Number(process.env.AUTH_THROTTLE_MAX_ATTEMPTS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_MAX_ATTEMPTS;
}

function shouldIncludeUserAgentDimension(): boolean {
  return process.env.AUTH_THROTTLE_INCLUDE_IP_UA !== 'false';
}

function throttleKeyForIp(ip: string): string {
  return `ip:${ip}`;
}

function throttleKeyForIpAndUa(ip: string, userAgent: string): string {
  const digest = createHash('sha256').update(userAgent).digest('hex').slice(0, 16);
  return `ipua:${ip}:${digest}`;
}

function normalizeBucket(bucket: ThrottleBucket | null, timestamp: number): ThrottleBucket {
  const windowMs = throttleWindowMs();
  if (!bucket || timestamp >= bucket.resetAt) {
    return {
      count: 0,
      resetAt: timestamp + windowMs,
    };
  }
  return bucket;
}

async function readStoreBucket(key: string): Promise<ThrottleBucket | null> {
  const store = getStore(THROTTLE_STORE);
  const data = await store.get(key, { type: 'json' });
  if (!data || typeof data !== 'object') return null;

  const parsed = data as Partial<ThrottleBucket>;
  if (!Number.isFinite(parsed.count) || !Number.isFinite(parsed.resetAt)) return null;

  return {
    count: parsed.count,
    resetAt: parsed.resetAt,
  };
}

async function writeStoreBucket(key: string, bucket: ThrottleBucket): Promise<void> {
  const store = getStore(THROTTLE_STORE);
  await store.setJSON(key, bucket);
}

async function readBucket(key: string): Promise<ThrottleBucket | null> {
  if (isNetlifyRuntime) {
    return readStoreBucket(key);
  }
  return MEMORY_BUCKETS.get(key) ?? null;
}

async function writeBucket(key: string, bucket: ThrottleBucket): Promise<void> {
  if (isNetlifyRuntime) {
    await writeStoreBucket(key, bucket);
    return;
  }
  MEMORY_BUCKETS.set(key, bucket);
}

async function inspectPrincipalThrottle(key: string): Promise<PrincipalThrottleStatus> {
  const current = normalizeBucket(await readBucket(key), nowMs());
  const allowedAttempts = maxAttempts();

  if (current.count >= allowedAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - nowMs()) / 1_000));
    return {
      blocked: true,
      retryAfterSeconds,
    };
  }

  return {
    blocked: false,
    retryAfterSeconds: 0,
  };
}

async function incrementPrincipalThrottle(key: string): Promise<void> {
  const timestamp = nowMs();
  const current = normalizeBucket(await readBucket(key), timestamp);
  current.count += 1;
  await writeBucket(key, current);
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  }

  const forwardedIpHeaders = ['x-real-ip', 'cf-connecting-ip', 'x-nf-client-connection-ip'];
  for (const header of forwardedIpHeaders) {
    const value = request.headers.get(header);
    if (value) return value.trim();
  }

  return 'unknown';
}

function getThrottleKeys(request: NextRequest): string[] {
  const ip = getClientIp(request);
  const keys = [throttleKeyForIp(ip)];

  if (shouldIncludeUserAgentDimension()) {
    const userAgent = request.headers.get('user-agent');
    if (userAgent) {
      keys.push(throttleKeyForIpAndUa(ip, userAgent));
    }
  }

  return keys;
}

export async function getAuthThrottleStatus(request: NextRequest): Promise<PrincipalThrottleStatus> {
  const keys = getThrottleKeys(request);
  const statuses = await Promise.all(keys.map((key) => inspectPrincipalThrottle(key)));

  for (const status of statuses) {
    if (status.blocked) {
      return status;
    }
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

export async function recordAuthFailure(request: NextRequest): Promise<void> {
  const keys = getThrottleKeys(request);
  await Promise.all(keys.map((key) => incrementPrincipalThrottle(key)));
}
