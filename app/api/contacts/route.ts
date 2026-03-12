import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
// Cache the email map for 5 minutes
export const revalidate = 300;

const SERVER_URL = process.env.CONTACT_SERVER_URL || '';
const SERVER_PASSWORD = process.env.CONTACT_SERVER_PASSWORD || '';

interface Contact {
  tenantName?: string;
  email?: string;
}

export async function GET() {
  if (!SERVER_URL) {
    return NextResponse.json({ emails: {} });
  }

  try {
    // Login to get session cookie
    const loginRes = await fetch(`${SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: SERVER_PASSWORD }),
      redirect: 'manual',
    });

    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';

    const contactsRes = await fetch(`${SERVER_URL}/api/contacts`, {
      headers: cookie ? { Cookie: cookie } : {},
      next: { revalidate: 300 },
    });

    if (!contactsRes.ok) {
      return NextResponse.json({ emails: {} });
    }

    const data = await contactsRes.json();
    const contacts: Contact[] = data.contacts || [];

    const emails: Record<string, string> = {};
    for (const c of contacts) {
      if (c.tenantName && c.email) {
        emails[c.tenantName] = c.email;
      }
    }

    return NextResponse.json({ emails });
  } catch {
    return NextResponse.json({ emails: {} });
  }
}
