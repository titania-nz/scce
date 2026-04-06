import { NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_OPTIONS } from '../cookie';

function createLogoutResponse() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}

export async function POST() {
  return createLogoutResponse();
}

export async function GET() {
  return createLogoutResponse();
}
