// Decoding a Kuru fill into numbers a person can read.
//
// The indexer stores every `KuruTrade` field exactly as the contract emitted it,
// so nothing is lost to rounding. This module is the one place that knows how
// those integers scale, and it is deliberately the only place: a second copy of
// this rule is a second chance to get it wrong.
//
// The rule (verified against live MON/USDC fills — see tests/kuru.ts):
//
//   priceQuotePerBase = price / (pricePrecision × sizePrecision)
//   baseAmount        = filledSize / sizePrecision
//
// `pricePrecision` (1e8) and `sizePrecision` (1e10) are the market's own
// parameters, emitted by the Router's `MarketRegistered`. For MON/USDC their
// product happens to be 1e18, which is why `price / 1e18` looks like a price.
//
// The check that settles it is not the price, it is the notional: on six
// separate fills, `priceQuotePerBase × baseAmount` reproduced the exact USDC
// the same transaction moved — 23.202816, 21.828593, 17.685618, 9.170722 and
// 3.009661, matching the chain to the sixth decimal. Two of them landed one
// unit (0.000001 USDC) either side, which is the contract's own integer
// rounding, not a scaling error.
//
// An unverifiable market returns null rather than a number. In particular the
// pair being known is not enough — without the two precisions there is no
// reading of `price` at all, and guessing one would put a decimal point in
// front of a made-up figure.

/** The market's own scaling parameters, as `MarketRegistered` declares them. */
export type KuruMarketPrecision = {
  pricePrecision: bigint;
  sizePrecision: bigint;
};

/** A fill exactly as the indexer stored it: raw, base units, no conversion. */
export type KuruFillRaw = {
  price: string;
  filledSize: string;
  updatedSize: string;
};

export type KuruFill = {
  /** Quote (e.g. USDC) per base (e.g. MON), e.g. 0.025647. */
  priceQuotePerBase: number;
  /** Base units filled, e.g. 904.6990291262 MON. */
  baseAmount: number;
  /** What the fill was worth in the quote asset, e.g. 23.202816 USDC. */
  quoteAmount: number;
  /** The maker's order size still resting after this fill, in base units. */
  remainingBaseAmount: number;
};

const SCALE = BigInt(10) ** BigInt(18);

/**
 * `numerator / denominator` as a number, done in integer space first so a
 * raw uint256 does not lose its low digits to a float before we start.
 */
function divide(numerator: bigint, denominator: bigint): number {
  if (denominator === BigInt(0)) return NaN;
  return Number((numerator * SCALE) / denominator) / 1e18;
}

const UINT_RE = /^\d+$/;

/**
 * Parse a stored column into a bigint, or null if it is not an unsigned
 * integer. The shape check is not decoration: `BigInt("")` is `BigInt(0)`, so
 * without it an empty column would decode as "the maker filled nothing" rather
 * than as "we do not know" — a zero where the honest answer is an absence.
 */
function toBigInt(value: string): bigint | null {
  if (typeof value !== "string" || !UINT_RE.test(value)) return null;
  return BigInt(value);
}

/**
 * Turn one indexed fill into human numbers, or `null` when the market's
 * precisions are missing or zero — in which case there is no honest reading.
 */
export function decodeKuruFill(raw: KuruFillRaw, market: KuruMarketPrecision): KuruFill | null {
  if (market.pricePrecision <= BigInt(0) || market.sizePrecision <= BigInt(0)) return null;

  const price = toBigInt(raw.price);
  const filledSize = toBigInt(raw.filledSize);
  const updatedSize = toBigInt(raw.updatedSize);
  if (price === null || filledSize === null || updatedSize === null) return null;

  const priceQuotePerBase = divide(price, market.pricePrecision * market.sizePrecision);
  const baseAmount = divide(filledSize, market.sizePrecision);
  const remainingBaseAmount = divide(updatedSize, market.sizePrecision);
  if (!Number.isFinite(priceQuotePerBase) || !Number.isFinite(baseAmount)) return null;

  return {
    priceQuotePerBase,
    baseAmount,
    quoteAmount: priceQuotePerBase * baseAmount,
    remainingBaseAmount
  };
}

/**
 * Malformed-market guard plus the pair, for the markets whose `MarketRegistered`
 * predates the indexer's `start_block` — the Router never saw them, so the app
 * has no indexed `KuruMarket` row to read the pair or the precisions from.
 * Decoded from each market's own creation log on-chain, not from a docs page
 * (Kuru's published ABI is stale on the event signature; see indexer/README.md).
 *
 * This mirrors `SEEDED_MARKETS` in `indexer/src/EventHandlers.ts`, which carries
 * the same pair for the same reason. If a market is added in one place it has to
 * be added in the other, or the indexer will resolve a pair the app cannot scale.
 */
export type VerifiedMarket = KuruMarketPrecision & {
  /** 0x0…0 means native MON, as the Router records it. */
  baseAsset: string;
  quoteAsset: string;
};

const NATIVE = "0x0000000000000000000000000000000000000000";

export const VERIFIED_MARKETS: Record<string, VerifiedMarket> = {
  // MON/USDC — creation tx 0x85f4b267…, block 43,660,999.
  "0x065c9d28e428a0db40191a54d33d5b7c71a9c394": {
    baseAsset: NATIVE,
    quoteAsset: "0x754704bc059f8c67012fed69bc8a327a5aafb603", // USDC
    pricePrecision: BigInt(100_000_000), // 1e8
    sizePrecision: BigInt(10_000_000_000) // 1e10
  }
};

/**
 * The verified markets a token takes part in, as `[marketAddress, market]`.
 * `address` is the token's ERC20 (WMON for native MON); pass `isNative` so MON's
 * own page matches a market that recorded the native sentinel rather than an
 * address. Returns empty for a token in no verified market — which is an answer,
 * not a failure.
 */
export function marketsForToken(address: string, isNative = false): [string, VerifiedMarket][] {
  const want = address.toLowerCase();
  return Object.entries(VERIFIED_MARKETS).filter(([, m]) => {
    if (m.baseAsset === want || m.quoteAsset === want) return true;
    return isNative && m.baseAsset === NATIVE;
  });
}
