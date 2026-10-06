// Feed / activity queries. One Trade include shape feeds the home timeline,
// token activity, and trader profiles — the activity graph read many ways.
//
// Token market figures on every trade are LIVE (lib/market.ts), overlaid at read
// time; the trade's own amountUsd/priceUsd are the verified on-chain fill.

import { dbQuery } from "./db";
import type { Prisma } from "@prisma/client";
import type { TradeDTO, TokenDTO } from "./types";
import { getMarket, type MarketData } from "./market";
import { bySymbol, type TokenMeta } from "./registry";

export const tradeInclude = {
  user: { select: { id: true, username: true, displayName: true, avatar: true, isNotable: true } },
  token: { select: { symbol: true, name: true, logo: true } }
} satisfies Prisma.TradeInclude;

type TradeRow = Prisma.TradeGetPayload<{ include: typeof tradeInclude }>;

/** Identity-only token DTO from the registry, with live market merged in. */
export function toTokenDTO(meta: TokenMeta, market?: MarketData): TokenDTO {
  return {
    symbol: meta.symbol,
    name: meta.name,
    address: meta.address,
    chain: "monad",
    decimals: meta.decimals,
    logo: meta.logo,
    priceUsd: market?.priceUsd ?? null,
    change24h: market?.change24h ?? 0,
    marketCap: market?.marketCap ?? null,
    volume24h: market?.volume24h ?? 0,
    liquidity: market?.liquidity ?? null
  };
}

/** A token snapshot for a trade row: registry identity + live market. */
function tokenSnapshot(symbol: string, name: string, logo: string | null, market?: MarketData) {
  return {
    symbol,
    name,
    logo,
    priceUsd: market?.priceUsd ?? null,
    change24h: market?.change24h ?? 0
  };
}

export function toTradeDTO(t: TradeRow, market?: MarketData): TradeDTO {
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
    token: tokenSnapshot(t.token.symbol, t.token.name, t.token.logo, market)
  };
}

/** Fetch live market for the symbols appearing in a set of trade rows. */
async function marketForRows(rows: TradeRow[]): Promise<Map<string, MarketData>> {
  const symbols = [...new Set(rows.map((r) => r.token.symbol))];
  return symbols.length ? getMarket(symbols) : new Map();
}

/**
 * Global or following-scoped trade timeline.
 *
 * `null` means the DB did not answer. Callers must NOT render that as an empty
 * feed — "No activity yet." would be a claim about the world when the truth is
 * that we don't know. `[]` means genuinely no trades.
 */
export async function getFeed(
  opts: { viewerId?: string | null; limit?: number } = {}
): Promise<TradeDTO[] | null> {
  const limit = opts.limit ?? 40;
  const result = await dbQuery(async (db) => {
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
  if (!result.ok) return null;

  const rows = result.data;
  if (rows.length === 0) return [];
  const market = await marketForRows(rows);
  return rows.map((r) => toTradeDTO(r, market.get(r.token.symbol.toUpperCase())));
}

/** A token's recorded trades. `null` when the DB did not answer — see getFeed. */
export async function getTokenActivity(tokenSymbol: string, limit = 30): Promise<TradeDTO[] | null> {
  const result = await dbQuery((db) =>
    db.trade.findMany({
      where: { tokenSymbol },
      include: tradeInclude,
      orderBy: { createdAt: "desc" },
      take: limit
    })
  );
  if (!result.ok) return null;

  const rows = result.data;
  if (rows.length === 0) return [];
  const market = await marketForRows(rows);
  return rows.map((r) => toTradeDTO(r, market.get(r.token.symbol.toUpperCase())));
}

/** Resolve the market for a single symbol (used where a Meta is already known). */
export async function marketForSymbol(symbol: string): Promise<MarketData | undefined> {
  if (!bySymbol(symbol)) return undefined;
  return (await getMarket([symbol])).get(symbol.toUpperCase());
}
