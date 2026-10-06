import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { tradeInclude, toTradeDTO } from "@/lib/feed";
import { getMarket } from "@/lib/market";

export const dynamic = "force-dynamic";

// GET /api/trade/[id] — single trade, for the share card.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await dbQuery((db) => db.trade.findUnique({ where: { id }, include: tradeInclude }));
  // An unreachable DB must not be reported as "this trade does not exist".
  if (!row.ok) {
    return NextResponse.json({ error: "Trade data is temporarily unavailable" }, { status: 503 });
  }
  if (!row.data) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  const market = (await getMarket([row.data.token.symbol])).get(row.data.token.symbol.toUpperCase());
  return NextResponse.json({ trade: toTradeDTO(row.data, market) });
}
