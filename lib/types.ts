// Shared DTO shapes returned by the API and consumed by client components.
//
// Honesty rule: any market figure that is `null` means "provider had no number"
// — the formatters render an em dash rather than a fake zero. Token identity
// (symbol/name/address/decimals) is real and stable; price/volume/24h are live.

export type TokenDTO = {
  symbol: string;
  name: string;
  address: string;
  chain: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null; // live; null when the provider has no quote
  change24h: number; // 24h % move of the token's top pool; 0 when unknown
  marketCap: number | null;
  volume24h: number; // 24h USD volume; 0 when unknown
  liquidity: number | null; // top-pool reserve in USD; null when unknown
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
  source: "SWAP" | "CROSS_CHAIN";
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
  amount: number; // live on-chain balance
  valueUsd: number | null; // amount × live price; null when price is unknown
};

export type PortfolioDTO = {
  totalValueUsd: number; // sum of priced holdings (unpriced holdings excluded)
  holdings: HoldingDTO[];
  recentTrades: TradeDTO[];
  // PnL needs reconstructed trade history. Until the indexer lands we say so
  // rather than invent an average entry.
  pnlAvailable: boolean;
};

// Real swap quote (0x Swap API v2) — returned by /api/trade/quote. Includes the
// unsigned transaction the client signs in the user's wallet. The server never
// signs; amounts shown here are indicative until the tx confirms on-chain.
export type SwapQuoteDTO = {
  sellSymbol: string;
  buySymbol: string;
  subjectSymbol: string; // the token the trade is "about" (what the UI centres on)
  side: "BUY" | "SELL";
  sellAmount: string; // base units
  buyAmount: string; // base units
  minBuyAmount: string; // base units, after slippage
  sellAmountToken: number; // human-readable
  buyAmountToken: number;
  minBuyAmountToken: number;
  subjectPriceUsd: number | null; // live price of the subject token
  networkFeeUsd: number | null;
  slippageBps: number;
  // Everything the client needs to approve + sign:
  sellTokenAddress: string;
  sellIsNative: boolean;
  to: string;
  data: string;
  value: string; // wei
  allowanceTarget: string | null; // ERC20 spender to approve (null if native sell)
  allowanceNeeded: string | null; // base units of allowance required (null if ok)
};

// Real on-chain execution stages, driven by wallet + receipt state (no timers).
export type SwapStatus =
  | "IDLE"
  | "APPROVING" // user signing the ERC20 approval
  | "SIGNING" // user signing the swap
  | "SUBMITTED" // tx broadcast, awaiting inclusion
  | "CONFIRMING" // mined, awaiting our receipt verification
  | "CONFIRMED"
  | "FAILED";
