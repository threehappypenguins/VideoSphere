import { connectToDatabase } from '@/lib/mongodb';
import { ConnectedAccountModel } from '@/lib/models/ConnectedAccount';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { fetchVimeoCategories } from '@/lib/platforms/vimeo-api';

async function main() {
  await connectToDatabase();
  const acct = await ConnectedAccountModel.findOne({ platform: 'vimeo' }).lean();
  if (!acct) {
    console.log('NO_VIMEO_ACCOUNT');
    return;
  }

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

  const token = tokens.accessToken;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.vimeo.*+json;version=3.4',
  };

  const listRes = await fetch(
    'https://api.vimeo.com/categories?per_page=100&sort=name&direction=asc',
    { headers }
  );
  const listBody = (await listRes.json()) as {
    data?: Array<Record<string, unknown>>;
    total?: number;
    paging?: Record<string, unknown>;
  };
  const rows = listBody.data ?? [];
  console.log('LIST_COUNT', rows.length, 'TOTAL', listBody.total);
  console.log('PAGING', JSON.stringify(listBody.paging));
  console.log(
    'TOP_LEVEL_NAMES',
    rows
      .map((r) => String(r.name ?? ''))
      .sort()
      .join(', ')
  );

  const wedding = rows.find(
    (r) => /wedding/i.test(String(r.name ?? '')) || /wedding/i.test(String(r.uri ?? ''))
  );
  console.log('WEDDING_ROW', JSON.stringify(wedding, null, 2));
  console.log(
    'LIST_INLINE_SUBS',
    rows.map((r) => ({
      name: r.name,
      uri: r.uri,
      subCount: Array.isArray(r.subcategories) ? r.subcategories.length : 'none',
      subs: Array.isArray(r.subcategories)
        ? (r.subcategories as Array<{ uri?: string; name?: string }>).map((s) => s.name)
        : undefined,
    }))
  );

  const weddingDetail = await fetch('https://api.vimeo.com/categories/wedding', { headers }).then(
    (r) => r.json().catch(() => ({}))
  );
  console.log('WEDDING_DETAIL_EXISTS', Boolean((weddingDetail as { uri?: string }).uri));

  for (const slug of ['comedy', 'travel', 'brandedcontent', 'wedding', 'animation']) {
    const detail = await fetch(`https://api.vimeo.com/categories/${slug}`, { headers }).then((r) =>
      r.json().catch(() => ({}))
    );
    const dedicatedRes = await fetch(
      `https://api.vimeo.com/categories/${slug}/subcategories?per_page=100`,
      { headers }
    );
    const dedicatedBody = (await dedicatedRes.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>;
    };
    console.log('---', slug);
    const subs = (detail as { subcategories?: unknown[] }).subcategories;
    console.log(
      'detail_subs',
      Array.isArray(subs) ? subs.length : 'missing',
      Array.isArray(subs)
        ? subs.slice(0, 3).map((s) => s as { uri?: string; name?: string })
        : undefined
    );
    console.log('dedicated_status', dedicatedRes.status, 'count', dedicatedBody.data?.length ?? 0);
    if (dedicatedBody.data?.length) {
      console.log(
        'dedicated_sample',
        dedicatedBody.data.slice(0, 5).map((x) => ({
          uri: x.uri,
          name: x.name,
          top_level: x.top_level,
          parent: (x.parent as { uri?: string } | undefined)?.uri,
        }))
      );
    }
  }

  const built = await fetchVimeoCategories(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
