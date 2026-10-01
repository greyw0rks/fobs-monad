// Portfolio accounting. Positions store amount + average entry; current value
// and unrealized PnL are computed against the live Token.priceUsd at read time
// (never stored stale).

import { tryDb } from "./db";
import { tradeInclude, toTradeDTO } from "./feed";
import type { PortfolioDTO, HoldingDTO } from "./types";

export async function getPortfolio(userId: string): Promise<PortfolioDTO | null> {
  const data = await tryDb(async (db) => {
    const [positions, recentTrades] = await Promise.all([
      db.position.findMany({
        where: { userId, amount: { gt: 0 } },
        include: { token: true },
        orderBy: { updatedAt: "desc" }
      }),
      db.trade.findMany({
        where: { userId },
        include: tradeInclude,
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);
    return { positions, recentTrades };
  });

  if (!data) return null;

  const holdings: HoldingDTO[] = data.positions.map((p) => {
    const valueUsd = p.amount * p.token.priceUsd;
    const costUsd = p.amount * p.avgEntryUsd;
    const unrealizedPnlUsd = valueUsd - costUsd;
    const unrealizedPnlPct = costUsd > 0 ? (unrealizedPnlUsd / costUsd) * 100 : 0;
    return {
      token: {
        symbol: p.token.symbol,
        name: p.token.name,
        logo: p.token.logo,
        priceUsd: p.token.priceUsd,
        change24h: p.token.change24h
      },
      amount: p.amount,
      avgEntryUsd: p.avgEntryUsd,
      valueUsd,
      unrealizedPnlUsd,
      unrealizedPnlPct
    };
  });

  const totalValueUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);
  const totalCost = holdings.reduce((s, h) => s + h.amount * h.avgEntryUsd, 0);
  const unrealizedPnlUsd = totalValueUsd - totalCost;
  const unrealizedPnlPct = totalCost > 0 ? (unrealizedPnlUsd / totalCost) * 100 : 0;
  const realizedPnlUsd = data.positions.reduce((s, p) => s + p.realizedPnlUsd, 0);

  return {
    totalValueUsd,
    unrealizedPnlUsd,
    unrealizedPnlPct,
    realizedPnlUsd,
    holdings: holdings.sort((a, b) => b.valueUsd - a.valueUsd),
    recentTrades: data.recentTrades.map(toTradeDTO)
  };
}

/** Apply an executed trade to the user's position (upsert + weighted avg entry). */
export async function applyTradeToPosition(args: {
  userId: string;
  tokenSymbol: string;
  side: "BUY" | "SELL";
  amountToken: number;
  priceUsd: number;
}) {
  const { userId, tokenSymbol, side, amountToken, priceUsd } = args;
  const existing = await tryDb((db) =>
    db.position.findUnique({ where: { userId_tokenSymbol: { userId, tokenSymbol } } })
  );

  if (side === "BUY") {
    const prevAmount = existing?.amount ?? 0;
    const prevCost = prevAmount * (existing?.avgEntryUsd ?? 0);
    const newAmount = prevAmount + amountToken;
    const newAvg = newAmount > 0 ? (prevCost + amountToken * priceUsd) / newAmount : priceUsd;
    await tryDb((db) =>
      db.position.upsert({
        where: { userId_tokenSymbol: { userId, tokenSymbol } },
        update: { amount: newAmount, avgEntryUsd: newAvg },
        create: { userId, tokenSymbol, amount: newAmount, avgEntryUsd: newAvg }
      })
    );
  } else {
    const prevAmount = existing?.amount ?? 0;
    const avg = existing?.avgEntryUsd ?? priceUsd;
    const sold = Math.min(amountToken, prevAmount);
    const realized = (priceUsd - avg) * sold + (existing?.realizedPnlUsd ?? 0);
    await tryDb((db) =>
      db.position.upsert({
        where: { userId_tokenSymbol: { userId, tokenSymbol } },
        update: { amount: Math.max(0, prevAmount - sold), realizedPnlUsd: realized },
        create: { userId, tokenSymbol, amount: 0, avgEntryUsd: avg, realizedPnlUsd: realized }
      })
    );
  }
}
