import { NextResponse } from "next/server";
import { bySymbol } from "@/lib/registry";
import { getOhlcv } from "@/lib/market";

export const dynamic = "force-dynamic";

// GET /api/candles/[symbol]?points=72 — real OHLCV closes from the token's
// deepest Monad pool. No synthesised series: an empty array renders an honest
// "no price history yet" state.
export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const meta = bySymbol(symbol);
  if (!meta) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const points = Math.min(200, Math.max(24, Number(searchParams.get("points")) || 72));

  const series = await getOhlcv(meta.symbol, { timeframe: "hour", aggregate: 1, limit: points });
  return NextResponse.json({ symbol: meta.symbol, series });
}
