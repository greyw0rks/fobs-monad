import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/portfolio";
import { viewerIdFromAddress } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/portfolio?address=0x..
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const viewerId = await viewerIdFromAddress(searchParams.get("address"));
  if (!viewerId) {
    return NextResponse.json({
      totalValueUsd: 0,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      realizedPnlUsd: 0,
      holdings: [],
      recentTrades: []
    });
  }
  const portfolio = await getPortfolio(viewerId);
  return NextResponse.json(
    portfolio ?? {
      totalValueUsd: 0,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      realizedPnlUsd: 0,
      holdings: [],
      recentTrades: []
    }
  );
}
