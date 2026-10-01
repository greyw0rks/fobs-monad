import { NextResponse } from "next/server";
import { getToken } from "@/lib/tokens";
import { getTokenActivity } from "@/lib/feed";
import { getSignal } from "@/lib/signal";

export const dynamic = "force-dynamic";

// GET /api/tokens/[symbol]
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const token = await getToken(symbol);
  if (!token) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  const [activity, signal] = await Promise.all([
    getTokenActivity(token.symbol, 30),
    getSignal(token.symbol)
  ]);

  return NextResponse.json({ token, activity, signal });
}
