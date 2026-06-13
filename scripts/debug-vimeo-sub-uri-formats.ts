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
    if ((row.subcategories?.length ?? 0) > 0) {
      console.log(
        row.name,
        row.subcategories?.map((s: { uri: string; name: string }) => s.uri)
      );
    }
  }

  const brandedDedicated = await fetch(
    'https://api.vimeo.com/categories/brandedcontent/subcategories?per_page=100',
    { headers }
  ).then((r) => r.json());
  console.log(
    'BRANDED_DEDICATED',
    brandedDedicated.data?.map((s: { uri: string; name: string }) => s.uri)
  );

  // probe wedding discovery
  for (const url of [
    'https://api.vimeo.com/categories?filter=top_level&per_page=100',
    'https://api.vimeo.com/categories?query=wedding&per_page=100',
    'https://api.vimeo.com/categories/wedding',
  ]) {
    const body = await fetch(url, { headers }).then((r) => r.json());
    const names = Array.isArray(body.data)
      ? body.data.map((r: { name: string }) => r.name)
      : body.name;
    console.log(url.split('vimeo.com')[1], 'total', body.total ?? '-', names);
  }
}

main();
