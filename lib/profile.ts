// Trader profile — identity + their activity graph. Discovery, not a leaderboard.
// Holdings are read live from the trader's wallet; PnL needs reconstructed
// history and is deferred to the indexer milestone.

import { dbQuery, type DbResult } from "./db";
import { tradeInclude, toTradeDTO } from "./feed";
import { getMarket, type MarketData } from "./market";
import { getHoldings } from "./portfolio";
import { getWalletLabels } from "./labels";
import type { TradeDTO, TraderDTO, HoldingDTO } from "./types";

export type ProfileDTO = {
  trader: TraderDTO & { bio: string | null; createdAt: string; address: string };
  followers: number;
  following: number;
  /** Live on-chain holdings for this wallet (empty when the RPC read fails). */
  holdings: HoldingDTO[];
  recentTrades: TradeDTO[];
  isFollowedByViewer: boolean;
  /** External labels (Nansen). Empty when unconfigured / unavailable — never faked. */
  labels: string[];
};

/**
 * A trader's public profile.
 *
 * Returns a `DbResult` because "no such user" and "the DB did not answer" must
 * not collapse: the first is a real 404, the second is a 503. Rendering an
 * outage as "Trader not found" tells the viewer a real account doesn't exist.
 */
export async function getProfile(
  username: string,
  viewerId: string | null
): Promise<DbResult<ProfileDTO | null>> {
  const result = await dbQuery(async (db) => {
    const user = await db.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user) return null;

    const [followers, following, recentTrades, followEdge] = await Promise.all([
      db.follow.count({ where: { followingId: user.id } }),
      db.follow.count({ where: { followerId: user.id } }),
      db.trade.findMany({
        where: { userId: user.id },
        include: tradeInclude,
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      viewerId
        ? db.follow.findUnique({
            where: { followerId_followingId: { followerId: viewerId, followingId: user.id } }
          })
        : Promise.resolve(null)
    ]);

    return { user, followers, following, recentTrades, followEdge };
  });

  if (!result.ok) return result; // the DB did not answer — not an empty profile

  const data = result.data;
  if (!data) return { ok: true, data: null }; // genuinely no such user

  const [holdings, market, labels] = await Promise.all([
    getHoldings(data.user.address as `0x${string}`).catch(() => [] as HoldingDTO[]),
    data.recentTrades.length
      ? getMarket([...new Set(data.recentTrades.map((r) => r.token.symbol))])
      : Promise.resolve(new Map<string, MarketData>()),
    getWalletLabels(data.user.address).catch(() => null)
  ]);

  return {
    ok: true,
    data: {
      trader: {
        id: data.user.id,
        username: data.user.username,
        displayName: data.user.displayName,
        avatar: data.user.avatar,
        isNotable: data.user.isNotable,
        bio: data.user.bio,
        createdAt: data.user.createdAt.toISOString(),
        address: data.user.address
      },
      followers: data.followers,
      following: data.following,
      holdings,
      recentTrades: data.recentTrades.map((r) => toTradeDTO(r, market.get(r.token.symbol.toUpperCase()))),
      isFollowedByViewer: Boolean(data.followEdge),
      labels: labels?.labels ?? []
    }
  };
}
