"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { useTradeDrawer } from "./trade-drawer";
import { Avatar, Num, SignalBar } from "./ui";
import { price, pct, compactMoney, compactNumber } from "@/lib/format";
import type { TrendingToken } from "@/lib/tokens";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("request failed");
  return r.json();
}

export function ExploreView() {
  const { openTrade } = useTradeDrawer();
  const { data, isLoading } = useQuery({
    queryKey: ["trending", "full"],
    queryFn: () => fetchJSON<{ tokens: TrendingToken[] }>("/api/trending"),
    refetchInterval: 20_000
  });
  const tokens = data?.tokens ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl p-4 lg:p-6">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 style={{ fontSize: "var(--t-2xl)", fontWeight: 700, letterSpacing: "-0.02em" }}>Markets</h1>
          <p className="muted">Ranked by Fobs Signal — Fobs' own momentum metric, not a prediction.</p>
        </div>
      </div>

      {isLoading && <div className="p-8 text-center muted">Loading markets…</div>}
      {!isLoading && tokens.length === 0 && (
        <div className="card p-8 text-center">
          <div className="muted">No tokens available.</div>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="card overflow-hidden">
          {/* header */}
          <div
            className="hidden md:grid items-center gap-3 px-4 py-2 border-b hairline eyebrow"
            style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1.4fr 90px" }}
          >
            <span>Token</span>
            <span className="text-right">Price</span>
            <span className="text-right">24h</span>
            <span className="text-right">Volume</span>
            <span>Fobs Signal</span>
            <span />
          </div>

          {tokens.map((t) => (
            <div
              key={t.symbol}
              className="grid items-center gap-3 px-4 py-3 border-b hairline row-hover"
              style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1.4fr 90px" }}
            >
              <Link href={`/token/${t.symbol}` as Route} className="flex items-center gap-3 min-w-0">
                <Avatar name={t.symbol} logo={t.logo} size={34} />
                <div className="min-w-0">
                  <div className="num" style={{ fontWeight: 700 }}>
                    {t.symbol}
                  </div>
                  <div className="muted truncate" style={{ fontSize: "var(--t-xs)" }}>
                    {t.name}
                  </div>
                </div>
              </Link>
              <Num className="text-right">{price(t.priceUsd)}</Num>
              <Num className={`text-right ${t.change24h >= 0 ? "up" : "down"}`}>{pct(t.change24h)}</Num>
              <Num className="text-right muted">{compactMoney(t.volume24h)}</Num>
              <div>
                <SignalBar score={t.signal.score} />
                <div className="muted mt-1" style={{ fontSize: "var(--t-xs)" }}>
                  {compactNumber(t.signal.notableActive)} notable · {t.signal.buyPressurePct}% buys
                </div>
              </div>
              <button className="btn btn-sm btn-buy justify-self-end" onClick={() => openTrade(t.symbol)}>
                Trade
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
