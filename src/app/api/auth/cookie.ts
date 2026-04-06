export const COOKIE_NAME = 'auth-token';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  // 30 days
  maxAge: 60 * 60 * 24 * 30,
};
