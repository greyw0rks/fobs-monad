import { NextResponse } from "next/server";
import { z } from "zod";
import { getToken } from "@/lib/tokens";
import { getQuote } from "@/lib/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  symbol: z.string(),
  amountUsd: z.number().positive(),
  fromChain: z.string().default("base"),
  fromToken: z.string().default("USDC")
});

// POST /api/trade/quote — LI.FI-style route quote (Base USDC → Monad token).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const token = await getToken(parsed.data.symbol);
  if (!token) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  const quote = getQuote({
    fromChain: parsed.data.fromChain,
    fromToken: parsed.data.fromToken,
    toToken: token.symbol,
    toTokenPriceUsd: token.priceUsd,
    amountUsd: parsed.data.amountUsd
  });

  return NextResponse.json({ quote });
}
