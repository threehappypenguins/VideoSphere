import { connectToDatabase } from '@/lib/mongodb';
import { ConnectedAccountModel } from '@/lib/models/ConnectedAccount';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';

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

  const list = await fetch('https://api.vimeo.com/categories?per_page=100&sort=name', {
    headers,
  }).then((r) => r.json());

  for (const row of list.data ?? []) {
    console.log(
      JSON.stringify({
        name: row.name,
        uri: row.uri,
        top_level: row.top_level,
        parent: row.parent?.uri,
        inlineSubs: row.subcategories?.length ?? 0,
        inlineSubNames: row.subcategories?.map((s: { name: string }) => s.name),
      })
    );
  }

  const wedding = await fetch('https://api.vimeo.com/categories/wedding', { headers }).then((r) =>
    r.json()
  );
  console.log('WEDDING_DETAIL', wedding.uri, wedding.name);
}

main();
