import { NextResponse } from "next/server";
import { getFeed } from "@/lib/feed";
import { viewerIdFromAddress } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/feed?address=0x..&scope=following|global
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const scope = searchParams.get("scope") ?? "global";

  const viewerId = scope === "following" ? await viewerIdFromAddress(address) : null;
  const trades = await getFeed({ viewerId, limit: 40 });
  return NextResponse.json({ trades });
}
