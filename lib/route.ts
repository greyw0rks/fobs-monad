// Cross-chain route engine — LI.FI-style shape, deterministic math.
//
// This models the quote/route/estimate contract of an aggregator (LI.FI,
// Across, deBridge) so a real integration is a drop-in later: swap getQuote's
// body for a fetch to the provider and keep the RouteQuote shape. For the demo
// the numbers are derived deterministically from the token price + fixed
// slippage/fee assumptions — no live liquidity dependency.

import type { RouteQuote, RouteStep, ExecutionStatus } from "./types";

const SLIPPAGE_PCT = 0.5; // max slippage tolerance
const BRIDGE_FEE_PCT = 0.1;
const SWAP_FEE_PCT = 0.25;

export type QuoteInput = {
  fromChain: string; // e.g. "base"
  fromToken: string; // e.g. "USDC"
  toToken: string; // target token symbol on Monad
  toTokenPriceUsd: number;
  amountUsd: number;
};

const PRETTY_CHAIN: Record<string, string> = {
  base: "Base",
  monad: "Monad",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum"
};

export function prettyChain(chain: string): string {
  return PRETTY_CHAIN[chain] ?? chain.charAt(0).toUpperCase() + chain.slice(1);
}

export function getQuote(input: QuoteInput): RouteQuote {
  const { fromChain, fromToken, toToken, toTokenPriceUsd, amountUsd } = input;
  const sameChain = fromChain === "monad";

  // Price impact grows with size (toy model: 0.1% per $25k, capped).
  const priceImpactPct = Math.min(2, 0.1 + amountUsd / 250_000);

  const bridgeFee = sameChain ? 0 : amountUsd * (BRIDGE_FEE_PCT / 100);
  const swapFee = amountUsd * (SWAP_FEE_PCT / 100);
  const feeCostUsd = bridgeFee + swapFee;
  const gasCostUsd = sameChain ? 0.02 : 0.14; // Monad gas is cheap; bridge adds src-chain gas

  const netUsd = amountUsd - feeCostUsd;
  const effectivePrice = toTokenPriceUsd * (1 + priceImpactPct / 100);
  const toAmountToken = netUsd / effectivePrice;
  const toAmountMinToken = toAmountToken * (1 - SLIPPAGE_PCT / 100);

  const steps: RouteStep[] = [];
  if (!sameChain) {
    steps.push({
      type: "bridge",
      label: `Bridge ${fromToken}`,
      fromChain,
      toChain: "monad",
      tool: "LI.FI"
    });
  }
  steps.push({
    type: "swap",
    label: `Swap to ${toToken}`,
    fromChain: "monad",
    toChain: "monad",
    tool: "Monad DEX"
  });

  return {
    id: `route_${Math.random().toString(36).slice(2, 10)}`,
    fromChain,
    fromToken,
    toChain: "monad",
    toToken,
    tool: "LI.FI",
    steps,
    estimate: {
      fromAmountUsd: amountUsd,
      toAmountToken,
      toAmountMinToken,
      priceImpactPct,
      gasCostUsd,
      feeCostUsd,
      executionDurationSec: sameChain ? 3 : 24
    }
  };
}

// Execution stages the Trade drawer animates through. Durations are the demo's
// "feel" — a same-chain swap skips the bridge stage.
export type ExecutionStage = { status: ExecutionStatus; label: string; durationMs: number };

export function executionStages(crossChain: boolean): ExecutionStage[] {
  const stages: ExecutionStage[] = [
    { status: "QUOTING", label: "Finding best route", durationMs: 900 },
    { status: "ROUTE_FOUND", label: "Route found", durationMs: 700 }
  ];
  if (crossChain) {
    stages.push({ status: "BRIDGING", label: "Bridging to Monad", durationMs: 1600 });
  }
  stages.push({ status: "SWAPPING", label: "Executing on Monad", durationMs: 1200 });
  stages.push({ status: "CONFIRMED", label: "Confirmed", durationMs: 0 });
  return stages;
}
