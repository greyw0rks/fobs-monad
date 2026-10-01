import { NextResponse } from "next/server";
import { tryDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/search?q=mon
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ tokens: [], traders: [] });

  const data = await tryDb(async (db) => {
    const [tokens, traders] = await Promise.all([
      db.token.findMany({
        where: {
          OR: [
            { symbol: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } }
          ]
        },
        take: 6,
        orderBy: { volume24h: "desc" }
      }),
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
    ]);
    return { tokens, traders };
  });

  if (!data) return NextResponse.json({ tokens: [], traders: [] });

  return NextResponse.json({
    tokens: data.tokens,
    traders: data.traders.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      isNotable: u.isNotable
    }))
  });
}
