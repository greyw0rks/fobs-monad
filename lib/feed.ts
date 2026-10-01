// Feed / activity queries. One Trade include shape feeds the home timeline,
// token activity, and trader profiles — the activity graph read many ways.

import { tryDb } from "./db";
import type { Prisma } from "@prisma/client";
import type { TradeDTO, TokenDTO } from "./types";

export const tradeInclude = {
  user: { select: { id: true, username: true, displayName: true, avatar: true, isNotable: true } },
  token: { select: { symbol: true, name: true, logo: true, priceUsd: true, change24h: true } }
} satisfies Prisma.TradeInclude;

type TradeRow = Prisma.TradeGetPayload<{ include: typeof tradeInclude }>;

export function toTradeDTO(t: TradeRow): TradeDTO {
  return {
    id: t.id,
    side: t.side,
    amountToken: t.amountToken,
    amountUsd: t.amountUsd,
    priceUsd: t.priceUsd,
    source: t.source,
    fromChain: t.fromChain,
    txHash: t.txHash,
    createdAt: t.createdAt.toISOString(),
    trader: {
      id: t.user.id,
      username: t.user.username,
      displayName: t.user.displayName,
      avatar: t.user.avatar,
      isNotable: t.user.isNotable
    },
    token: {
      symbol: t.token.symbol,
      name: t.token.name,
      logo: t.token.logo,
      priceUsd: t.token.priceUsd,
      change24h: t.token.change24h
    }
  };
}

export function toTokenDTO(t: {
  symbol: string;
  name: string;
  address: string;
  chain: string;
  decimals: number;
  logo: string | null;
  priceUsd: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  holders: number;
}): TokenDTO {
  return { ...t };
}

/** Global or following-scoped trade timeline. */
export async function getFeed(opts: { viewerId?: string | null; limit?: number } = {}): Promise<TradeDTO[]> {
  const limit = opts.limit ?? 40;
  const rows = await tryDb(async (db) => {
    let userIds: string[] | undefined;
    if (opts.viewerId) {
      const follows = await db.follow.findMany({
        where: { followerId: opts.viewerId },
        select: { followingId: true }
      });
      if (follows.length > 0) userIds = follows.map((f) => f.followingId);
    }
    return db.trade.findMany({
      where: userIds ? { userId: { in: userIds } } : undefined,
      include: tradeInclude,
      orderBy: { createdAt: "desc" },
      take: limit
    });
  });
  return (rows ?? []).map(toTradeDTO);
}

export async function getTokenActivity(tokenSymbol: string, limit = 30): Promise<TradeDTO[]> {
  const rows = await tryDb((db) =>
    db.trade.findMany({
      where: { tokenSymbol },
      include: tradeInclude,
      orderBy: { createdAt: "desc" },
      take: limit
    })
  );
  return (rows ?? []).map(toTradeDTO);
}
