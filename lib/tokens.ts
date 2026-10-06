// Token reads — identity from the registry, market from the live provider, and
// Fobs Signal from the activity graph. No token market figure is ever stored.

import { tryDb } from "./db";
import { scoreSignal } from "./signal";
import { toTokenDTO } from "./feed";
import { REGISTRY, bySymbol } from "./registry";
import { getMarket } from "./market";
import type { TokenDTO, SignalDTO } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One registry token with live market merged in (null when unsupported). */
export async function getToken(symbol: string): Promise<TokenDTO | null> {
  const meta = bySymbol(symbol);
  if (!meta) return null;
  const market = (await getMarket([meta.symbol])).get(meta.symbol.toUpperCase());
  return toTokenDTO(meta, market);
}

/** Every supported token with live market merged in. */
export async function getAllTokens(): Promise<TokenDTO[]> {
  const market = await getMarket();
  return REGISTRY.map((meta) => toTokenDTO(meta, market.get(meta.symbol.toUpperCase())));
}

export type TrendingToken = TokenDTO & { signal: SignalDTO };

/** All tokens with their Fobs Signal, ranked by signal score. */
export async function getTrending(limit?: number): Promise<TrendingToken[]> {
  const [market, trades] = await Promise.all([
    getMarket(),
    tryDb((db) =>
      db.trade.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 2 * DAY_MS) } },
        select: {
          tokenSymbol: true,
          side: true,
          amountUsd: true,
          userId: true,
          createdAt: true,
          user: { select: { isNotable: true } }
        }
      })
    )
  ]);

  const byToken = new Map<string, NonNullable<typeof trades>>();
  for (const t of trades ?? []) {
    const arr = byToken.get(t.tokenSymbol) ?? [];
    arr.push(t);
    byToken.set(t.tokenSymbol, arr);
  }

  const ranked = REGISTRY.map((meta) => {
    const rows = (byToken.get(meta.symbol) ?? []).map((r) => ({
      side: r.side,
      amountUsd: r.amountUsd,
      userId: r.userId,
      isNotable: r.user.isNotable,
      createdAt: r.createdAt
    }));
    return { ...toTokenDTO(meta, market.get(meta.symbol.toUpperCase())), signal: scoreSignal(rows) };
  });

  ranked.sort((a, b) => b.signal.score - a.signal.score);
  return limit ? ranked.slice(0, limit) : ranked;
}
