// Token queries + trending (ranked by Fobs Signal).

import { tryDb } from "./db";
import { scoreSignal } from "./signal";
import { toTokenDTO } from "./feed";
import type { TokenDTO, SignalDTO } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getToken(symbol: string): Promise<TokenDTO | null> {
  const t = await tryDb((db) => db.token.findUnique({ where: { symbol: symbol.toUpperCase() } }));
  return t ? toTokenDTO(t) : null;
}

export async function getAllTokens(): Promise<TokenDTO[]> {
  const rows = await tryDb((db) => db.token.findMany({ orderBy: { volume24h: "desc" } }));
  return (rows ?? []).map(toTokenDTO);
}

export type TrendingToken = TokenDTO & { signal: SignalDTO };

/** All tokens with their Fobs Signal, ranked by signal score. */
export async function getTrending(limit?: number): Promise<TrendingToken[]> {
  const data = await tryDb(async (db) => {
    const tokens = await db.token.findMany();
    const trades = await db.trade.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 2 * DAY_MS) } },
      select: {
        tokenSymbol: true,
        side: true,
        amountUsd: true,
        userId: true,
        createdAt: true,
        user: { select: { isNotable: true } }
      }
    });
    return { tokens, trades };
  });

  if (!data) return [];

  const byToken = new Map<string, typeof data.trades>();
  for (const t of data.trades) {
    const arr = byToken.get(t.tokenSymbol) ?? [];
    arr.push(t);
    byToken.set(t.tokenSymbol, arr);
  }

  const ranked = data.tokens.map((tok) => {
    const rows = (byToken.get(tok.symbol) ?? []).map((r) => ({
      side: r.side,
      amountUsd: r.amountUsd,
      userId: r.userId,
      isNotable: r.user.isNotable,
      createdAt: r.createdAt
    }));
    return { ...toTokenDTO(tok), signal: scoreSignal(rows) };
  });

  ranked.sort((a, b) => b.signal.score - a.signal.score);
  return limit ? ranked.slice(0, limit) : ranked;
}
