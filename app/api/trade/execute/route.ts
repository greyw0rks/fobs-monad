import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, dbConfigured } from "@/lib/db";
import { resolveUser } from "@/lib/session";
import { getToken } from "@/lib/tokens";
import { getQuote } from "@/lib/route";
import { applyTradeToPosition } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

const Body = z.object({
  address: z.string(),
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  amountUsd: z.number().positive().optional(),
  amountToken: z.number().positive().optional(),
  fromChain: z.string().default("base"),
  fromToken: z.string().default("USDC")
});

function fakeTxHash(): string {
  const hex = "0123456789abcdef";
  let h = "0x";
  for (let i = 0; i < 64; i++) h += hex[Math.floor(Math.random() * 16)];
  return h;
}

// POST /api/trade/execute — simulated execution. Persists the Trade and updates
// the Position. No funds move; the route/execution is modelled, not on-chain.
export async function POST(request: Request) {
  if (!dbConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { address, symbol, side, fromChain, fromToken } = parsed.data;

  const token = await getToken(symbol);
  if (!token) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  let amountToken: number;
  let amountUsd: number;

  if (side === "BUY") {
    if (!parsed.data.amountUsd) return NextResponse.json({ error: "amountUsd required for BUY" }, { status: 400 });
    amountUsd = parsed.data.amountUsd;
    const quote = getQuote({ fromChain, fromToken, toToken: token.symbol, toTokenPriceUsd: token.priceUsd, amountUsd });
    amountToken = quote.estimate.toAmountToken;
  } else {
    if (!parsed.data.amountToken) return NextResponse.json({ error: "amountToken required for SELL" }, { status: 400 });
    amountToken = parsed.data.amountToken;
    amountUsd = amountToken * token.priceUsd;
  }

  try {
    const me = await resolveUser(address);
    const crossChain = side === "BUY" && fromChain !== "monad";
    const trade = await prisma.trade.create({
      data: {
        userId: me.id,
        tokenSymbol: token.symbol,
        side,
        amountToken,
        amountUsd,
        priceUsd: token.priceUsd,
        chain: "monad",
        fromChain: crossChain ? fromChain : null,
        txHash: fakeTxHash(),
        source: crossChain ? "CROSS_CHAIN" : "SWAP"
      }
    });

    await applyTradeToPosition({ userId: me.id, tokenSymbol: token.symbol, side, amountToken, priceUsd: token.priceUsd });

    return NextResponse.json({
      tradeId: trade.id,
      txHash: trade.txHash,
      amountToken,
      amountUsd,
      priceUsd: token.priceUsd,
      symbol: token.symbol
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
