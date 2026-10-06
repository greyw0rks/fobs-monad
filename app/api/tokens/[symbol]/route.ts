import { NextResponse } from "next/server";
import { getToken } from "@/lib/tokens";
import { getTokenActivity } from "@/lib/feed";
import { getSignal } from "@/lib/signal";
import { getTokenSmartMoney } from "@/lib/labels";

export const dynamic = "force-dynamic";

// GET /api/tokens/[symbol]
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const token = await getToken(symbol);
  if (!token) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  const [activity, signal, smartMoney] = await Promise.all([
    getTokenActivity(token.symbol, 30),
    getSignal(token.symbol),
    // null when Nansen is unconfigured / has no Monad coverage — rendered as nothing.
    getTokenSmartMoney(token.address).catch(() => null)
  ]);

  return NextResponse.json({ token, activity, signal, smartMoney });
}
