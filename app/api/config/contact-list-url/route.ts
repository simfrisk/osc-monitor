import { NextResponse } from 'next/server';

const DEFAULT_CONTACT_LIST_URL =
  'https://simonsteam-oscusers.eyevinn-web-runner.auto.prod.osaas.io';

export async function GET() {
  const url = process.env.CONTACT_LIST_URL || DEFAULT_CONTACT_LIST_URL;
  return NextResponse.json({ url });
}
