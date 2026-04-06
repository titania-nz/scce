import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth-token')?.value;
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    // No secret configured — block access with a clear message
    return new NextResponse('AUTH_SECRET environment variable is not set.', { status: 503 });
  }

  if (token !== secret) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
