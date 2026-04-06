const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

type AuthTokenPayload = {
  v: number;
  iat: number;
  exp: number;
  sid: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function generateSessionId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function createAuthToken(secret: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    v: TOKEN_VERSION,
    iat: now,
    exp: now + ttlSeconds,
    sid: generateSessionId(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(payloadJson));

  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadEncoded));
  const signatureEncoded = base64UrlEncode(new Uint8Array(signature));

  return `${payloadEncoded}.${signatureEncoded}`;
}

export async function verifyAuthToken(token: string, secret: string): Promise<boolean> {
  const [payloadEncoded, signatureEncoded, ...extraParts] = token.split('.');

  if (!payloadEncoded || !signatureEncoded || extraParts.length > 0) {
    return false;
  }

  const signatureBytes = base64UrlDecode(signatureEncoded);
  const payloadBytes = base64UrlDecode(payloadEncoded);

  if (!signatureBytes || !payloadBytes) {
    return false;
  }

  const key = await importSigningKey(secret);
  const isSignatureValid = await crypto.subtle.verify(
    'HMAC',
    key,
    toArrayBuffer(signatureBytes),
    new TextEncoder().encode(payloadEncoded),
  );

  if (!isSignatureValid) {
    return false;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as AuthTokenPayload;

    if (payload.v !== TOKEN_VERSION) {
      return false;
    }

    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || typeof payload.sid !== 'string') {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return payload.iat <= now && payload.exp > now;
  } catch {
    return false;
  }
}
