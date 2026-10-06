// Shared venue vocabulary. A "venue" is whatever actually fills a swap on
// Monad: Kuru (primary) or 0x (fallback). `VenueQuote` is the normalised shape
// every venue returns, so the quote route and the API DTO never care which one
// answered. Types only — safe to import from client code.

export type Venue = "kuru" | "0x";

/**
 * A routed, unsigned swap. Every amount is in the token's smallest units; the
 * transaction is handed to the user's wallet to sign (the server never signs).
 */
export type VenueQuote = {
  sellAmount: string; // base units sold
  buyAmount: string; // base units received (expected)
  minBuyAmount: string; // base units, after slippage
  totalNetworkFee: string | null; // wei of native MON, when the venue reports it
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string; gas: string | null } | null;
  allowanceTarget: `0x${string}` | null; // ERC20 spender to approve (null when native)
  allowanceNeeded: string | null; // base units of allowance required (null when native)
};
