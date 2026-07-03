import {
  accountNeedsOAuthHealthProbe,
  getConnectionStatus,
} from '@/lib/platforms/connection-status';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import {
  getConnectedAccountForUser,
  getConnectedAccountsByUser,
  getConnectedAccountWithTokens,
} from '@/lib/repositories/connected-accounts';
import type { ConnectedAccountPublic } from '@/types';

/**
 * Loads the user's connected accounts and verifies OAuth refresh health when needed.
 * Revoked refresh tokens are cleared during verification via {@link refreshTokenIfNeeded}.
 * @param userId - Authenticated user id.
 * @returns Public account rows annotated with `connectionStatus`.
 */
export async function getConnectedAccountsWithHealth(
  userId: string
): Promise<ConnectedAccountPublic[]> {
  const accounts = await getConnectedAccountsByUser(userId);
  const results: ConnectedAccountPublic[] = [];

  for (const account of accounts) {
    let publicAccount = account;
    let connectionStatus = getConnectionStatus(account);

    if (connectionStatus === 'connected' && accountNeedsOAuthHealthProbe(account)) {
      const withTokens = await getConnectedAccountWithTokens(userId, account.platform);
      if (withTokens && withTokens.id === account.id) {
        try {
          await refreshTokenIfNeeded(withTokens, { force: true });
          publicAccount = (await getConnectedAccountForUser(account.id, userId)) ?? publicAccount;
          connectionStatus = getConnectionStatus(publicAccount);
        } catch {
          publicAccount = (await getConnectedAccountForUser(account.id, userId)) ?? {
            ...account,
            hasRefreshToken: false,
          };
          connectionStatus = getConnectionStatus(publicAccount);
        }
      }
    }

    results.push({
      ...publicAccount,
      connectionStatus: connectionStatus === 'connected' ? 'connected' : 'expired',
    });
  }

  return results;
}
