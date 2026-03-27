import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'osc-monitor-default-secret';

function generateToken(password: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(password).digest('hex');
}

export async function POST(request: NextRequest) {
  if (!LOGIN_PASSWORD) {
    return NextResponse.json({ error: 'Login not configured' }, { status: 500 });
  }

  const body = await request.json();
  const { password } = body;

  if (password !== LOGIN_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  // Generate token using Node crypto (API routes run in Node runtime)
  // This produces the same hex output as the Web Crypto HMAC-SHA256 in middleware
  const token = generateToken(password);
  const response = NextResponse.json({ ok: true });

  response.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
