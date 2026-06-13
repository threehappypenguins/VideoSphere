import { connectToDatabase } from '@/lib/mongodb';
import { ConnectedAccountModel } from '@/lib/models/ConnectedAccount';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';

const CANDIDATE_SLUGS = [
  'wedding',
  'events',
  'nature',
  'fashion',
  'technology',
  'education',
  'food',
  'art',
  'news',
  'personal',
  'howto',
  'product',
  'cause',
  'talks',
  'videography',
  'photography',
  'design',
  'business',
  'culture',
  'science',
];

async function main() {
  await connectToDatabase();
  const acct = await ConnectedAccountModel.findOne({ platform: 'vimeo' }).lean();
  if (!acct) return;

  const tokens = await refreshTokenIfNeeded({
    id: String(acct._id),
    userId: String(acct.userId),
    platform: 'vimeo',
    accessToken: decryptToken(String(acct.accessToken)),
    refreshToken: decryptToken(String(acct.refreshToken || '')),
    tokenExpiry: String(acct.tokenExpiry),
    hasRefreshToken: true,
    platformUserId: String(acct.platformUserId),
    platformName: String(acct.platformName),
    $createdAt: '',
    $updatedAt: '',
  });

  const headers = {
    Authorization: `Bearer ${tokens.accessToken}`,
    Accept: 'application/vnd.vimeo.*+json;version=3.4',
  };

  const list = await fetch('https://api.vimeo.com/categories?per_page=100', { headers }).then((r) =>
    r.json()
  );
  const listSlugs = new Set(
    (list.data ?? []).map((r: { uri: string }) => r.uri.replace('/categories/', ''))
  );

  for (const slug of CANDIDATE_SLUGS) {
    if (listSlugs.has(slug)) continue;
    const res = await fetch(`https://api.vimeo.com/categories/${slug}`, { headers });
    if (!res.ok) continue;
    const body = await res.json();
    console.log('FOUND', slug, body.name, 'top_level', body.top_level, 'parent', body.parent?.uri);
  }

  for (const slug of ['comedy', 'brandedcontent', 'travel']) {
    const row = (list.data ?? []).find((r: { uri: string }) => r.uri === `/categories/${slug}`);
    console.log('LIST_META', slug, JSON.stringify(row?.metadata ?? null));
    const detail = await fetch(`https://api.vimeo.com/categories/${slug}`, { headers }).then((r) =>
      r.json()
    );
    console.log('DETAIL_META', slug, JSON.stringify(detail.metadata ?? null));
  }
}

main();
