import { NextResponse } from "next/server";
import { tryDb } from "@/lib/db";
import { tradeInclude, toTradeDTO } from "@/lib/feed";

export const dynamic = "force-dynamic";

// GET /api/trade/[id] — single trade, for the share card.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await tryDb((db) => db.trade.findUnique({ where: { id }, include: tradeInclude }));
  if (!row) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  return NextResponse.json({ trade: toTradeDTO(row) });
}
