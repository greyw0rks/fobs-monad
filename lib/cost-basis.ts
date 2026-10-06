// Average-cost reconstruction of a token position from recorded trades.
//
// Pure arithmetic, deliberately free of Prisma / viem / server-only so it can be
// tested directly: see `pnpm test:pnl`. It is the one piece of PnL that is
// provably right or provably wrong, so it is checked against hand-computed
// numbers rather than only through a live database.

export type Basis = {
  /** Tokens still held according to the recorded trades. */
  qty: number;
  /** USD paid for that qty. */
  cost: number;
  /** PnL banked by recorded sells. */
  realized: number;
  /**
   * False once a sell exceeds everything bought before it. The history is then
   * missing fills and any average derived from it would be *wrong*, not merely
   * imprecise — callers must drop the basis rather than report a confident
   * number built on sand.
   */
  complete: boolean;
};

/**
 * Walk a user's recorded trades, oldest first, into a per-token average cost.
 * A sell realises PnL against the running average and retires that share of the
 * cost, which leaves the average itself unchanged.
 */
export function reconstructBasis(
  rows: Array<{ tokenSymbol: string; side: "BUY" | "SELL"; amountToken: number; amountUsd: number }>
): Map<string, Basis> {
  const out = new Map<string, Basis>();
  for (const r of rows) {
    const b = out.get(r.tokenSymbol) ?? { qty: 0, cost: 0, realized: 0, complete: true };
    if (r.side === "BUY") {
      b.qty += r.amountToken;
      b.cost += r.amountUsd;
    } else if (r.amountToken > b.qty + 1e-9) {
      b.complete = false;
    } else {
      const avg = b.qty > 0 ? b.cost / b.qty : 0;
      const soldCost = r.amountToken * avg;
      b.realized += r.amountUsd - soldCost;
      b.qty -= r.amountToken;
      b.cost -= soldCost;
    }
    out.set(r.tokenSymbol, b);
  }
  return out;
}
