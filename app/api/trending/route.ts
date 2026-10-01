import { NextResponse } from "next/server";
import { getTrending } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// GET /api/trending?limit=10
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, limitRaw) : undefined;
  const tokens = await getTrending(limit);
  return NextResponse.json({ tokens });
}
