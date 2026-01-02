import { fetchAuthSession } from '@aws-amplify/auth';
import { API_URL, SIGNER_API_URL } from '../config/env';

type SignedUrlResponse = { url?: string; expires?: number };

function signerBaseUrl(): string {
  // Prefer dedicated signer service, otherwise use the existing API base.
  return (SIGNER_API_URL || API_URL || '').trim().replace(/\/$/, '');
}

export async function getDmMediaSignedUrl(path: string, ttlSeconds = 300): Promise<string> {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  if (!cleanPath.startsWith('uploads/dm/')) {
    throw new Error('Invalid DM media path');
  }

  const base = signerBaseUrl();
  if (!base) throw new Error('Signer API base URL not configured');

  const { tokens } = await fetchAuthSession();
  const idToken = tokens?.idToken?.toString();
  if (!idToken) throw new Error('Not authenticated');

  const res = await fetch(`${base}/media/dm/signed-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: cleanPath, ttlSeconds }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DM signed URL failed (${res.status}): ${text || 'no body'}`);
  }

  const json = (await res.json().catch(() => ({}))) as SignedUrlResponse;
  const u = typeof json.url === 'string' ? json.url : '';
  if (!u) throw new Error('Signer returned no url');
  // If the signer ever returns a URL with a fragment, CloudFront won't receive the query params.
  // DM conversationIds include '#', so the signer MUST encode them as %23 in the pathname.
  try {
    const parsed = new URL(u);
    if (parsed.hash) throw new Error('Signer returned URL with fragment (#); DM paths must encode # as %23');
  } catch (e: any) {
    // If URL parsing fails, fall through to query checks; fetch will likely fail anyway.
    if (String(e?.message || '').includes('fragment')) throw e;
  }
  // CloudFront DM behavior requires signed URL (or signed cookies). We use signed URLs.
  if (!u.includes('Key-Pair-Id=') || !u.includes('Signature=') || !u.includes('Expires=')) {
    throw new Error('Signer returned an unsigned URL (missing CloudFront signature query params)');
  }
  return u;
}

