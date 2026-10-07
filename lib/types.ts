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

// Chain-wide ERC20 activity from the Envio indexer. Deliberately NOT TradeDTO:
// these are raw on-chain transfers, and a transfer is not a trade (it can be a
// swap, a CEX deposit, or a wallet's own housekeeping). Kept separate so the UI
// never presents a transfer as somebody's trade.
export type ChainTransferDTO = {
  id: string; // "{chainId}_{block}_{logIndex}"
  from: string;
  to: string;
  value: string; // base units, decimal string (exact)
  amountToken: number; // same amount, human-readable via the token's decimals
  blockNumber: number;
  timestamp: number; // unix seconds
};

export type ChainActivityDTO = {
  transfers: ChainTransferDTO[]; // newest first
  indexedTransfers: number; // total for this token since the indexer's start block
  indexedVolumeToken: number; // total volume in that same window, in tokens
  lastIndexedAt: number; // unix seconds of the newest indexed block
  source: "envio";
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

// A holding with a cost basis attached. Every basis field is `null` unless the
// position can be attributed to a recorded buy — null means "unknown", never
// "zero cost". See PortfolioDTO.pnlStatus for why the whole set is missing.
export type PortfolioHoldingDTO = HoldingDTO & {
  avgCostUsd: number | null; // average price paid per token still held
  costBasisUsd: number | null; // amount × avgCostUsd
  pnlUsd: number | null;
  pnlPct: number | null;
};

export type PortfolioDTO = {
  // Sum of the PRICED holdings. `null` when no holding has a price — a wallet
  // whose tokens we cannot price has an unknown total, not a zero one, and
  // rendering "$0.00" there would be a claim we cannot support.
  totalValueUsd: number | null;
  holdings: PortfolioHoldingDTO[];
  recentTrades: TradeDTO[];
  // Cost basis is reconstructed from THE APP'S OWN recorded trades, by average
  // cost. Three distinct facts, never collapsed into one another:
  //   "ready"       — a basis was reconstructed
  //   "empty"       — no recorded history we can price (unknown, not zero)
  //   "unavailable" — the trade history could not be read at all (DB outage)
  pnlStatus: "ready" | "empty" | "unavailable";
  pnlMethod: "average-cost" | null;
  basisTrades: number; // how many recorded trades the reconstruction walked
  costBasisUsd: number | null; // cost of the positions the basis explains
  realizedPnlUsd: number | null; // from recorded sells
  unrealizedPnlUsd: number | null;
  // Share of PRICED portfolio value the basis explains, 0–100. PnL covers only
  // this much; the rest is position we cannot attribute to a recorded buy, and
  // is excluded rather than guessed at.
  pnlCoveragePct: number | null;
};

// Real swap quote (Kuru Flow primary, 0x fallback) — returned by
// /api/trade/quote. Includes the unsigned transaction the client signs in the
// user's wallet. The server never signs; amounts shown here are indicative
// until the tx confirms on-chain.
export type SwapQuoteDTO = {
  sellSymbol: string;
  buySymbol: string;
  subjectSymbol: string; // the token the trade is "about" (what the UI centres on)
  side: "BUY" | "SELL";
  venue: "kuru" | "0x"; // which router filled this quote
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

// One wallet action in a bridge quote. Relay returns origin-chain transactions
// (approve + deposit); Aurora yields a single ERC20 transfer to a deposit
// address. Both are normalised to this shape so the drawer just signs them.
export type BridgeStepDTO = {
  label: string;
  kind: string; // "transaction" is signable; anything else is surfaced, not skipped
  to: string;
  data: string;
  value: string;
  chainId: number;
};

// Cross-chain funding quote — returned by /api/bridge/quote. The user signs the
// steps in their OWN wallet on the source chain; no server-side signing, no
// custody. `provider` records which bridge answered, so provenance is never lost.
export type BridgeQuoteDTO = {
  provider: "relay" | "aurora";
  requestId: string | null; // Relay's status key
  sourceId: number;
  sourceName: string;
  sourceSymbol: string;
  destSymbol: string;
  amountIn: string; // base units of the source asset
  amountOut: string; // base units received on Monad
  amountInToken: number; // human-readable
  amountOutToken: number;
  amountInUsd: number | null;
  amountOutUsd: number | null;
  steps: BridgeStepDTO[];
  depositAddress: string | null; // Aurora's deposit target
  depositMemo: string | null;
  deadline: string | null; // ISO — quote/deposit expiry
  timeEstimateSec: number | null;
};

// A cross-chain transfer, read back from Aurora (matched by depositAddress).
// `status` is Aurora's own value, passed through verbatim — never re-mapped.
export type BridgeTransferDTO = {
  depositAddress: string | null;
  status: string; // PENDING_DEPOSIT | PROCESSING | SUCCESS | REFUNDED | FAILED | …
  destinationTxHashes: string[];
  amountInFormatted: string | null;
  amountOutFormatted: string | null;
  createdAt: string | null;
  refundReason: string | null; // populated only when Aurora refunded
};

// Real on-chain execution stages, driven by wallet + receipt state (no timers).
export type SwapStatus =
  | "IDLE"
  | "APPROVING" // user signing the ERC20 approval
  | "SIGNING" // user signing the swap
  | "SUBMITTED" // tx broadcast, awaiting inclusion
  | "CONFIRMING" // mined; wallet signs the publish, then the server verifies the receipt
  | "CONFIRMED"
  | "FAILED";
