// Trader profile — identity + their activity graph. Discovery, not a leaderboard.

import { tryDb } from "./db";
import { tradeInclude, toTradeDTO } from "./feed";
import type { TradeDTO, TraderDTO } from "./types";

export type ProfileDTO = {
  trader: TraderDTO & { bio: string | null; createdAt: string };
  followers: number;
  following: number;
  // Per-token activity summary (current position value + unrealized PnL).
  activity: {
    symbol: string;
    name: string;
    logo: string | null;
    amount: number;
    avgEntryUsd: number;
    valueUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
  }[];
  recentTrades: TradeDTO[];
  isFollowedByViewer: boolean;
};

export async function getProfile(username: string, viewerId: string | null): Promise<ProfileDTO | null> {
  const data = await tryDb(async (db) => {
    const user = await db.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user) return null;

    const [followers, following, positions, recentTrades, followEdge] = await Promise.all([
      db.follow.count({ where: { followingId: user.id } }),
      db.follow.count({ where: { followerId: user.id } }),
      db.position.findMany({ where: { userId: user.id, amount: { gt: 0 } }, include: { token: true } }),
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

    return { user, followers, following, positions, recentTrades, followEdge };
  });

  if (!data) return null;

  const activity = data.positions
    .map((p) => {
      const valueUsd = p.amount * p.token.priceUsd;
      const costUsd = p.amount * p.avgEntryUsd;
      const unrealizedPnlUsd = valueUsd - costUsd;
      return {
        symbol: p.token.symbol,
        name: p.token.name,
        logo: p.token.logo,
        amount: p.amount,
        avgEntryUsd: p.avgEntryUsd,
        valueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct: costUsd > 0 ? (unrealizedPnlUsd / costUsd) * 100 : 0
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);

  return {
    trader: {
      id: data.user.id,
      username: data.user.username,
      displayName: data.user.displayName,
      avatar: data.user.avatar,
      isNotable: data.user.isNotable,
      bio: data.user.bio,
      createdAt: data.user.createdAt.toISOString()
    },
    followers: data.followers,
    following: data.following,
    activity,
    recentTrades: data.recentTrades.map(toTradeDTO),
    isFollowedByViewer: Boolean(data.followEdge)
  };
}
