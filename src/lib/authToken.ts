import { createHmac, timingSafeEqual } from 'crypto';

// Create the cryptographic signature that proves a token came from this app.
function signTokenPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// Build a signed login token that can be stored in the browser cookie.
export function createAuthToken(secret: string): string {
  const issuedAt = String(Date.now());
  const payload = Buffer.from(issuedAt, 'utf8').toString('base64url');
  const signature = signTokenPayload(payload, secret);
  return `${payload}.${signature}`;
}

// Confirm that an incoming login cookie was signed with the expected secret.
export function verifyAuthToken(token: string, secret: string): boolean {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) {
    return false;
  }

  const expectedSignature = signTokenPayload(payload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}
