// Portfolio — read straight from the chain. Holdings are the wallet's live
// on-chain balances (native MON + registry ERC20s) valued at live prices.
//
// PnL is an AVERAGE COST basis reconstructed from this app's own recorded
// trades — the only fills we can attribute to a wallet. It is deliberately
// narrow, and the DTO says how narrow:
//   · a token with no recorded buy gets no basis (`null`), never a zero one;
//   · a recorded history that does not explain the whole on-chain balance is
//     treated as unattributable, rather than priced off a partial guess;
//   · an unreadable trade history reports "unavailable", not "no trades".
// Coverage travels with the number, so a PnL covering 20% of a portfolio is
// never read as covering all of it.

import "server-only";
import { getBalances } from "./onchain";
import { getMarket } from "./market";
import { dbQuery } from "./db";
import { tradeInclude, toTradeDTO } from "./feed";
import { reconstructBasis } from "./cost-basis";
import type { PortfolioDTO, PortfolioHoldingDTO, HoldingDTO } from "./types";

const RECENT_TRADES = 20;
/** Recorded fills are exact; this only absorbs float noise in the comparison. */
const RECONCILE_TOLERANCE = 0.005;

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
 * trades, and a cost basis over those trades where one can honestly be built.
 */
export async function getPortfolio(address: `0x${string}`, viewerId: string | null): Promise<PortfolioDTO> {
  const [holdings, history] = await Promise.all([
    getHoldings(address),
    viewerId
      ? dbQuery((db) =>
          db.trade.findMany({
            where: { userId: viewerId },
            include: tradeInclude,
            orderBy: { createdAt: "asc" } // oldest first — cost basis is a walk
          })
        )
      : // No account for this wallet means no recorded trades at all: an empty
        // history we can state with certainty, not a failure we should hide.
        Promise.resolve({ ok: true as const, data: [] })
  ]);

  const rows = history.ok ? history.data : [];
  const basis = reconstructBasis(rows);

  const enriched: PortfolioHoldingDTO[] = holdings.map((h) => {
    const b = basis.get(h.token.symbol);
    let avgCostUsd: number | null = null;
    let costBasisUsd: number | null = null;
    let pnlUsd: number | null = null;
    let pnlPct: number | null = null;

    if (b && b.complete && b.qty > 0) {
      const avg = b.cost / b.qty;
      // The basis explains the position only if the position IS the recorded
      // quantity. Tokens that arrived any other way (a transfer in, an airdrop)
      // leave the position partly unexplained, and pricing it would overstate
      // what we actually know.
      const reconciles = Math.abs(h.amount - b.qty) <= Math.max(h.amount, b.qty) * RECONCILE_TOLERANCE;
      if (reconciles && h.valueUsd !== null) {
        avgCostUsd = avg;
        costBasisUsd = h.amount * avg;
        pnlUsd = h.valueUsd - costBasisUsd;
        pnlPct = costBasisUsd > 0 ? (pnlUsd / costBasisUsd) * 100 : null;
      }
    }
    return { ...h, avgCostUsd, costBasisUsd, pnlUsd, pnlPct };
  });

  const priced = enriched.filter((h) => h.valueUsd !== null);
  const pricedTotal = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  // Nothing priced means an UNKNOWN total, not zero — see PortfolioDTO.
  const totalValueUsd = priced.length > 0 ? pricedTotal : null;
  const coveredTotal = priced
    .filter((h) => h.costBasisUsd !== null)
    .reduce((s, h) => s + (h.valueUsd ?? 0), 0);

  const withBasis = enriched.filter((h) => h.costBasisUsd !== null);
  const complete = [...basis.values()].filter((b) => b.complete);
  const ready = withBasis.length > 0 || complete.length > 0;

  const pnlStatus: PortfolioDTO["pnlStatus"] = !history.ok
    ? "unavailable"
    : ready
      ? "ready"
      : "empty";

  const recent = rows.slice(-RECENT_TRADES).reverse();
  let recentTrades: PortfolioDTO["recentTrades"] = [];
  if (recent.length > 0) {
    const market = await getMarket([...new Set(recent.map((r) => r.token.symbol))]);
    recentTrades = recent.map((r) => toTradeDTO(r, market.get(r.token.symbol.toUpperCase())));
  }

  return {
    totalValueUsd,
    holdings: enriched,
    recentTrades,
    pnlStatus,
    pnlMethod: pnlStatus === "ready" ? "average-cost" : null,
    basisTrades: rows.length,
    costBasisUsd: withBasis.length ? withBasis.reduce((s, h) => s + (h.costBasisUsd ?? 0), 0) : null,
    realizedPnlUsd: complete.length ? complete.reduce((s, b) => s + b.realized, 0) : null,
    unrealizedPnlUsd: withBasis.length ? withBasis.reduce((s, h) => s + (h.pnlUsd ?? 0), 0) : null,
    pnlCoveragePct: pricedTotal > 0 ? (coveredTotal / pricedTotal) * 100 : null
  };
}
