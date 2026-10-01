import { NextResponse } from "next/server";
import { getToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// Deterministic pseudo-random walk seeded by the symbol, ending at the live
// price. Honest about being a demo series — the token page labels it as such.
function seeded(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// GET /api/candles/[symbol]?points=60
export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const token = await getToken(symbol);
  if (!token) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const points = Math.min(200, Math.max(20, Number(searchParams.get("points")) || 60));

  const rnd = seeded(token.symbol);
  const end = token.priceUsd;
  // Walk backwards from the live price so the last point matches reality.
  const change = token.change24h / 100;
  const start = end / (1 + change);

  const series: { t: number; price: number }[] = [];
  const now = Date.now();
  const stepMs = (24 * 60 * 60 * 1000) / points;
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const trend = start + (end - start) * progress;
    const noise = (rnd() - 0.5) * end * 0.02;
    const p = Math.max(end * 0.0001, trend + noise);
    series.push({ t: now - (points - 1 - i) * stepMs, price: i === points - 1 ? end : p });
  }

  return NextResponse.json({ symbol: token.symbol, series });
}
