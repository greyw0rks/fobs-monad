import { NextResponse } from "next/server";
import { z } from "zod";
import { formatUnits, parseUnits } from "viem";
import { bySymbol, swapAddress, QUOTE_SYMBOL, type TokenMeta } from "@/lib/registry";
import { getBestQuote } from "@/lib/swap";
import { KuruError } from "@/lib/kuru";
import { ZeroExError } from "@/lib/zerox";
import { getMarket } from "@/lib/market";
import type { SwapQuoteDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const DECIMAL_RE = /^\d+(\.\d+)?$/;

const Body = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  taker: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "A connected wallet address is required"),
  // The raw user input, exactly as typed (no float rounding into base units).
  // A BUY amount is in USD; a SELL amount is in subject-token units.
  amount: z.string(),
  slippageBps: z.number().int().min(1).max(500).default(50)
});

// POST /api/trade/quote — real 0x Swap quote on Monad (chainId 143).
// Returns the unsigned transaction the client signs in the user's wallet. The
// server only routes; it never holds keys and never signs.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { symbol, side, taker, amount, slippageBps } = parsed.data;

  const subject = bySymbol(symbol);
  if (!subject) return NextResponse.json({ error: `Unsupported token ${symbol}` }, { status: 404 });

  const quote = bySymbol(QUOTE_SYMBOL)!;
  const sell: TokenMeta = side === "BUY" ? quote : subject;
  const buy: TokenMeta = side === "BUY" ? subject : quote;

  const clean = amount.trim().replace(/\.$/, "");
  if (!DECIMAL_RE.test(clean) || Number(clean) <= 0) {
    return NextResponse.json({ error: "Enter a valid amount" }, { status: 400 });
  }

  const market = await getMarket(["MON", subject.symbol, QUOTE_SYMBOL]);

  // Resolve the base-unit sell amount exactly (no float → bigint rounding).
  let sellAmount: bigint;
  try {
    if (side === "BUY") {
      const quotePrice = market.get(QUOTE_SYMBOL)?.priceUsd ?? 1; // USDC ≈ $1
      if (!(quotePrice > 0)) {
        return NextResponse.json({ error: "No live price for the funding asset" }, { status: 502 });
      }
      sellAmount = BigInt(Math.round((Number(clean) / quotePrice) * 10 ** quote.decimals));
    } else {
      sellAmount = parseUnits(clean, subject.decimals);
    }
  } catch {
    return NextResponse.json({ error: `Amount has too many decimals for ${sell.symbol}` }, { status: 400 });
  }
  if (sellAmount <= BigInt(0)) return NextResponse.json({ error: "Amount is too small" }, { status: 400 });

  let routed;
  try {
    routed = await getBestQuote({
      sell,
      buy,
      sellAmount: sellAmount.toString(),
      taker: taker as `0x${string}`,
      slippageBps
    });
  } catch (err) {
    const status = err instanceof ZeroExError || err instanceof KuruError ? 422 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Quote failed" }, { status });
  }

  const { quote: venueQuote, venue } = routed;
  if (!venueQuote.transaction) {
    return NextResponse.json({ error: "No route available for this trade right now" }, { status: 422 });
  }

  const monPrice = market.get("MON")?.priceUsd ?? null;
  const networkFeeUsd =
    venueQuote.totalNetworkFee != null && monPrice != null
      ? Number(formatUnits(BigInt(venueQuote.totalNetworkFee), 18)) * monPrice
      : null;

  const dto: SwapQuoteDTO = {
    sellSymbol: sell.symbol,
    buySymbol: buy.symbol,
    subjectSymbol: subject.symbol,
    side,
    venue,
    sellAmount: venueQuote.sellAmount,
    buyAmount: venueQuote.buyAmount,
    minBuyAmount: venueQuote.minBuyAmount,
    sellAmountToken: Number(formatUnits(BigInt(venueQuote.sellAmount), sell.decimals)),
    buyAmountToken: Number(formatUnits(BigInt(venueQuote.buyAmount), buy.decimals)),
    minBuyAmountToken: Number(formatUnits(BigInt(venueQuote.minBuyAmount), buy.decimals)),
    subjectPriceUsd: market.get(subject.symbol)?.priceUsd ?? null,
    networkFeeUsd,
    slippageBps,
    sellTokenAddress: swapAddress(sell),
    sellIsNative: Boolean(sell.isNative),
    to: venueQuote.transaction.to,
    data: venueQuote.transaction.data,
    value: venueQuote.transaction.value,
    allowanceTarget: sell.isNative ? null : venueQuote.allowanceTarget,
    // Approve the amount being sold — sufficient for this trade, minimal exposure.
    allowanceNeeded: sell.isNative ? null : venueQuote.sellAmount
  };

  return NextResponse.json({ quote: dto });
}
