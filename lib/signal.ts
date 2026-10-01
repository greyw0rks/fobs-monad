// Fobs Signal — a deterministic momentum score computed from the activity graph.
//
// This is FOBS' OWN METRIC, not a price prediction. It blends five signals from
// the last 24h of trades on a token:
//   - volume          (raw USD traded)
//   - buyer growth     (unique buyers 24h vs the prior 24h)
//   - unique wallets   (distinct wallets 24h vs prior)
//   - buy pressure     (buy volume / total volume)
//   - notable activity (distinct notable traders active)
// Everything is derived from Trade rows — nothing is stored or fabricated.

import { tryDb } from "./db";
import type { SignalDTO } from "./types";

type SignalRow = {
  side: "BUY" | "SELL";
  amountUsd: number;
  userId: string;
  isNotable: boolean;
  createdAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Pure scorer — easy to test, no DB. */
export function scoreSignal(rows: SignalRow[], now = Date.now()): SignalDTO {
  const recent = rows.filter((r) => now - r.createdAt.getTime() <= DAY_MS);
  const prior = rows.filter((r) => {
    const age = now - r.createdAt.getTime();
    return age > DAY_MS && age <= 2 * DAY_MS;
  });

  const volumeUsd = recent.reduce((s, r) => s + r.amountUsd, 0);
  const buyVol = recent.filter((r) => r.side === "BUY").reduce((s, r) => s + r.amountUsd, 0);
  const buyPressurePct = volumeUsd > 0 ? (buyVol / volumeUsd) * 100 : 50;

  const buyersNow = new Set(recent.filter((r) => r.side === "BUY").map((r) => r.userId)).size;
  const buyersPrior = new Set(prior.filter((r) => r.side === "BUY").map((r) => r.userId)).size;
  const buyerGrowthPct = buyersPrior > 0 ? ((buyersNow - buyersPrior) / buyersPrior) * 100 : buyersNow > 0 ? 100 : 0;

  const walletsNow = new Set(recent.map((r) => r.userId)).size;
  const walletsPrior = new Set(prior.map((r) => r.userId)).size;
  const uniqueWalletGrowthPct =
    walletsPrior > 0 ? ((walletsNow - walletsPrior) / walletsPrior) * 100 : walletsNow > 0 ? 100 : 0;

  const notableActive = new Set(recent.filter((r) => r.isNotable).map((r) => r.userId)).size;

  // Blend into 0–100. Weights are a deliberate editorial choice, not a model.
  const volumeScore = clamp(Math.log10(volumeUsd + 1) / 7, 0, 1) * 35; // ~$10M saturates
  const buyerScore = clamp(buyerGrowthPct / 60, 0, 1) * 20;
  const walletScore = clamp(uniqueWalletGrowthPct / 60, 0, 1) * 15;
  const pressureScore = clamp((buyPressurePct - 40) / 40, 0, 1) * 20; // 40%→0, 80%→full
  const notableScore = clamp(notableActive / 10, 0, 1) * 10;

  const score = Math.round(volumeScore + buyerScore + walletScore + pressureScore + notableScore);

  return {
    score: clamp(score, 0, 100),
    volumeUsd,
    buyerGrowthPct: Math.round(buyerGrowthPct),
    uniqueWalletGrowthPct: Math.round(uniqueWalletGrowthPct),
    notableActive,
    buyPressurePct: Math.round(buyPressurePct)
  };
}

/** Fetch 48h of trades for a token and score them. */
export async function getSignal(tokenSymbol: string): Promise<SignalDTO | null> {
  const rows = await tryDb((db) =>
    db.trade.findMany({
      where: { tokenSymbol, createdAt: { gte: new Date(Date.now() - 2 * DAY_MS) } },
      select: { side: true, amountUsd: true, userId: true, createdAt: true, user: { select: { isNotable: true } } }
    })
  );
  if (!rows) return null;
  return scoreSignal(
    rows.map((r) => ({
      side: r.side,
      amountUsd: r.amountUsd,
      userId: r.userId,
      isNotable: r.user.isNotable,
      createdAt: r.createdAt
    }))
  );
}
