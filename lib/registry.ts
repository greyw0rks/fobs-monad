// Supported-token registry — the ONLY source of truth for on-chain addresses
// and decimals.
//
// Every address below was verified against Circle's Monad announcement, the
// Monad docs "Tokens and Bridges" page and the MonadScan token tracker before
// being written here. Quote, execution, balance and price lookups all resolve
// addresses from this list (never from user input or the DB), so a token can
// never be traded against a wrong or spoofed address.
//
// The DB `Token` rows are seeded FROM this list (prisma/seed-registry.ts) purely
// for trade foreign-key integrity. Prices are NEVER seeded — they come live from
// lib/market.ts at request time.
//
// To list more tokens, add entries verified against the Monad token-list repo.

import { NATIVE_SENTINEL } from "./chain";

export type TokenMeta = {
  symbol: string; // natural key, uppercase — matches Token.symbol
  name: string;
  address: `0x${string}`; // ERC20 contract on Monad (WMON for native MON)
  decimals: number;
  logo: string | null;
  /** True for native MON: swaps use the native sentinel; balance uses getBalance. */
  isNative?: boolean;
  /** True for USD-pegged stables usable as the quote/funding leg. */
  isStable?: boolean;
};

// ── Verified Monad mainnet addresses ────────────────────────────────────────
export const WMON_ADDRESS = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as const; // Wrapped MON
export const USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const; // Circle native USDC

export const REGISTRY: TokenMeta[] = [
  // Native MON — priced via WMON's pools; bought/sold via the native sentinel.
  { symbol: "MON", name: "Monad", address: WMON_ADDRESS, decimals: 18, logo: null, isNative: true },
  { symbol: "WMON", name: "Wrapped MON", address: WMON_ADDRESS, decimals: 18, logo: null },
  { symbol: "USDC", name: "USD Coin", address: USDC_ADDRESS, decimals: 6, logo: null, isStable: true },
  {
    symbol: "USDT0",
    name: "Tether USD",
    address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
    decimals: 6,
    logo: null,
    isStable: true
  },
  { symbol: "WETH", name: "Wrapped Ether", address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", decimals: 18, logo: null },
  {
    symbol: "wstETH",
    name: "Lido wstETH",
    address: "0x10Aeaf63194db8d453d4D85a06E5eFE1dd0b5417",
    decimals: 18,
    logo: null
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b",
    decimals: 8,
    logo: null
  }
];

// The default quote/funding token for a BUY and the proceeds token for a SELL.
export const QUOTE_SYMBOL = "USDC";

const BY_SYMBOL = new Map(REGISTRY.map((t) => [t.symbol.toUpperCase(), t]));

export function bySymbol(symbol: string): TokenMeta | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

/** Address 0x routers use as sellToken/buyToken (native sentinel for MON). */
export function swapAddress(t: TokenMeta): `0x${string}` {
  return t.isNative ? NATIVE_SENTINEL : t.address;
}

/** Address used for price/pool lookups (always the ERC20 — WMON for MON). */
export function priceAddress(t: TokenMeta): `0x${string}` {
  return t.address;
}

/** Registry tokens with a real ERC20 contract (everything but native MON here). */
export const ERC20_TOKENS = REGISTRY.filter((t) => !t.isNative);
