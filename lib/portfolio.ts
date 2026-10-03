// Portfolio — read straight from the chain. Holdings are the wallet's live
// on-chain balances (native MON + registry ERC20s) valued at live prices.
//
// PnL is deliberately ABSENT: a real cost basis needs reconstructed trade
// history, which arrives with the indexer milestone. Until then we report
// pnlAvailable: false rather than fabricate an average entry.

import "server-only";
import { getBalances } from "./onchain";
import { getMarket } from "./market";
import { tryDb } from "./db";
import { tradeInclude, toTradeDTO } from "./feed";
import type { PortfolioDTO, HoldingDTO } from "./types";

/** Live on-chain holdings for a wallet, valued and sorted by value. */
export async function getHoldings(address: `0x${string}`): Promise<HoldingDTO[]> {
  const balances = await getBalances(address);
  if (balances.length === 0) return [];

  const market = await getMarket(balances.map((b) => b.token.symbol));
  const holdings = balances.map((b): HoldingDTO => {
    const m = market.get(b.token.symbol.toUpperCase());
    const priceUsd = m?.priceUsd ?? null;
    return {
      token: {
        symbol: b.token.symbol,
        name: b.token.name,
        logo: b.token.logo,
        priceUsd,
        change24h: m?.change24h ?? 0
      },
      amount: b.amount,
      valueUsd: priceUsd === null ? null : b.amount * priceUsd
    };
  });

  return holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

/**
 * Full portfolio for a wallet: live holdings + the user's recorded on-chain
 * trades (the only trades we can attribute — no fabricated history).
 */
export async function getPortfolio(address: `0x${string}`, viewerId: string | null): Promise<PortfolioDTO> {
  const [holdings, rows] = await Promise.all([
    getHoldings(address),
    viewerId
      ? tryDb((db) =>
          db.trade.findMany({
            where: { userId: viewerId },
            include: tradeInclude,
            orderBy: { createdAt: "desc" },
            take: 20
          })
        )
      : Promise.resolve(null)
  ]);

  const totalValueUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

  let recentTrades: PortfolioDTO["recentTrades"] = [];
  if (rows && rows.length > 0) {
    const market = await getMarket([...new Set(rows.map((r) => r.token.symbol))]);
    recentTrades = rows.map((r) => toTradeDTO(r, market.get(r.token.symbol.toUpperCase())));
  }

  return { totalValueUsd, holdings, recentTrades, pnlAvailable: false };
}
