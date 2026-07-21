import { NextRequest, NextResponse } from 'next/server';
import { checkBasicAuth } from './lib/auth/checkBasicAuth';

export function middleware(request: NextRequest): NextResponse {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    // Skip the gate when no credentials are configured (e.g. local dev).
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization');
  if (checkBasicAuth(authHeader, expectedUser, expectedPassword)) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Alt Text Generator"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
