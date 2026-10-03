import { NextResponse } from "next/server";
import { tryDb } from "@/lib/db";
import { REGISTRY } from "@/lib/registry";
import { getMarket } from "@/lib/market";
import { toTokenDTO } from "@/lib/feed";

export const dynamic = "force-dynamic";

// GET /api/search?q=mon — supported tokens (live market) + known traders.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ tokens: [], traders: [] });

  const matched = REGISTRY.filter(
    (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
  ).slice(0, 6);

  const [market, traders] = await Promise.all([
    getMarket(matched.map((t) => t.symbol)),
    tryDb((db) =>
      db.user.findMany({
        where: {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } }
          ]
        },
        take: 5,
        orderBy: { isNotable: "desc" }
      })
    )
  ]);

  return NextResponse.json({
    tokens: matched.map((t) => toTokenDTO(t, market.get(t.symbol.toUpperCase()))),
    traders: (traders ?? []).map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      isNotable: u.isNotable
    }))
  });
}
