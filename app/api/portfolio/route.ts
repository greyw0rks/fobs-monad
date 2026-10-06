import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/portfolio";
import { isAddress } from "@/lib/session";
import { viewerIdFromAddress } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/portfolio?address=0x.. — live on-chain holdings + recorded trades.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  if (!isAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }

  try {
    const viewerId = await viewerIdFromAddress(address);
    const portfolio = await getPortfolio(address.toLowerCase() as `0x${string}`, viewerId);
    return NextResponse.json(portfolio);
  } catch (error) {
    // RPC failure — say so rather than render an empty (misleading) portfolio.
    const message = error instanceof Error ? error.message : "Could not read on-chain balances";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
