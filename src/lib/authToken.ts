import { createHmac, timingSafeEqual } from 'crypto';

function signTokenPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAuthToken(secret: string): string {
  const issuedAt = String(Date.now());
  const payload = Buffer.from(issuedAt, 'utf8').toString('base64url');
  const signature = signTokenPayload(payload, secret);
  return `${payload}.${signature}`;
}

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
