// Shared DTO shapes returned by the API and consumed by client components.

export type TokenDTO = {
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
};

export type TraderDTO = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isNotable: boolean;
};

export type TradeDTO = {
  id: string;
  side: "BUY" | "SELL";
  amountToken: number;
  amountUsd: number;
  priceUsd: number;
  source: "SEED" | "SWAP" | "CROSS_CHAIN";
  fromChain: string | null;
  txHash: string | null;
  createdAt: string;
  trader: TraderDTO;
  token: Pick<TokenDTO, "symbol" | "name" | "logo" | "priceUsd" | "change24h">;
};

export type SignalDTO = {
  score: number; // 0–100, Fobs' own metric
  volumeUsd: number;
  buyerGrowthPct: number;
  uniqueWalletGrowthPct: number;
  notableActive: number;
  buyPressurePct: number; // share of volume that is buys, 0–100
};

export type HoldingDTO = {
  token: Pick<TokenDTO, "symbol" | "name" | "logo" | "priceUsd" | "change24h">;
  amount: number;
  avgEntryUsd: number;
  valueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
};

export type PortfolioDTO = {
  totalValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  holdings: HoldingDTO[];
  recentTrades: TradeDTO[];
};

// LI.FI-style route shape (see lib/route.ts).
export type RouteStep = {
  type: "bridge" | "swap";
  label: string;
  fromChain: string;
  toChain: string;
  tool: string;
};

export type RouteQuote = {
  id: string;
  fromChain: string;
  fromToken: string;
  toChain: string;
  toToken: string;
  tool: string;
  steps: RouteStep[];
  estimate: {
    fromAmountUsd: number;
    toAmountToken: number;
    toAmountMinToken: number;
    priceImpactPct: number;
    gasCostUsd: number;
    feeCostUsd: number;
    executionDurationSec: number;
  };
};

export type ExecutionStatus = "QUOTING" | "ROUTE_FOUND" | "BRIDGING" | "SWAPPING" | "CONFIRMED" | "FAILED";
