import { connectToDatabase } from '@/lib/mongodb';
import { ConnectedAccountModel } from '@/lib/models/ConnectedAccount';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { fetchVimeoCategories } from '@/lib/platforms/vimeo-api';

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

  const built = await fetchVimeoCategories(tokens.accessToken);
  if (!built.ok) {
    console.log('FAIL', built);
    return;
  }

  console.log('TOTAL', built.items.length);
  console.log('NAMES', built.items.map((c) => c.name).join(', '));
  for (const c of built.items) {
    if (c.subcategories.length > 0 || /comedy|travel|branded|wedding/i.test(c.name)) {
      console.log(
        c.name,
        'subs=',
        c.subcategories.length,
        c.subcategories.map((s) => s.name).join('|') || '-',
        'mayHave=',
        c.mayHaveSubcategories
      );
    }
  }
}

main();
