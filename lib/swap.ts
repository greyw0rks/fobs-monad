// Swap routing — one entry point the quote route calls. Kuru is the primary
// venue (Monad-native); 0x is the fallback when Kuru has no route for a pair or
// is momentarily unavailable. Whichever answers, the caller gets the same
// normalised VenueQuote plus the venue's name, so provenance is never lost.
//
// Server-only by way of its imports (lib/kuru.ts, lib/zerox.ts); the server
// still only ROUTES — it never signs.

import { getKuruQuote, KuruError } from "./kuru";
import { getSwapQuote } from "./zerox";
import { swapAddress, type TokenMeta } from "./registry";
import type { Venue, VenueQuote } from "./venue";

export type BestQuoteParams = {
  sell: TokenMeta;
  buy: TokenMeta;
  sellAmount: string; // base units of `sell`
  taker: `0x${string}`;
  slippageBps: number;
};

/**
 * Ask Kuru first, then 0x. Throws the last venue error only if BOTH fail, so a
 * Kuru outage degrades to 0x rather than to a dead quote.
 */
export async function getBestQuote(params: BestQuoteParams): Promise<{ quote: VenueQuote; venue: Venue }> {
  try {
    const quote = await getKuruQuote(params);
    if (quote.transaction) return { quote, venue: "kuru" };
  } catch (err) {
    if (err instanceof KuruError) {
      // Fall through to 0x below.
    } else {
      throw err;
    }
  }

  const quote = await getSwapQuote({
    sellToken: swapAddress(params.sell),
    buyToken: swapAddress(params.buy),
    sellAmount: params.sellAmount,
    taker: params.taker,
    slippageBps: params.slippageBps
  });
  return { quote, venue: "0x" };
}
