"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { AnimatePresence } from "motion/react";
import { useFobsAddress } from "./connect-wallet-button";
import { useTradeDrawer } from "./trade-drawer";
import { TradeRow } from "./trade-row";
import { SlideIn } from "./motion";
import { Avatar, Num } from "./ui";
import { price, pct } from "@/lib/format";
import type { TradeDTO } from "@/lib/types";
import type { TrendingToken } from "@/lib/tokens";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("request failed");
  return r.json();
}

export function FeedView({ scope = "global" }: { scope?: "global" | "following" }) {
  const address = useFobsAddress();
  const { openTrade } = useTradeDrawer();
  const [tab, setTab] = useState<"global" | "following">(scope);

  const feedUrl =
    tab === "following" && address ? `/api/feed?scope=following&address=${address}` : "/api/feed";

  const feed = useQuery({
    queryKey: ["feed", tab, address],
    queryFn: () => fetchJSON<{ trades: TradeDTO[] }>(feedUrl),
    refetchInterval: 12_000
  });

  const trades = feed.data?.trades ?? [];

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Trending strip */}
      <TrendingStrip onTrade={openTrade} />

      {/* Scope tabs */}
      <div className="flex items-center gap-1 px-4 py-3 border-b hairline sticky top-0 z-10" style={{ background: "var(--bg)" }}>
        <div className="live-dot" />
        <span className="eyebrow mr-3">Live feed</span>
        <div className="flex-1" />
        {(["global", "following"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="btn btn-sm"
            style={{
              background: tab === t ? "var(--surface-2)" : "transparent",
              borderColor: tab === t ? "var(--border)" : "transparent",
              textTransform: "capitalize"
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "following" && !address && (
        <div className="p-8 text-center muted">Connect your wallet and follow traders to see their activity here.</div>
      )}

      {feed.isLoading && <div className="p-8 text-center muted">Loading feed…</div>}

      {!feed.isLoading && trades.length === 0 && tab === "global" && (
        <div className="p-8 text-center">
          <div className="muted">No activity yet.</div>
          <div className="faint mt-1" style={{ fontSize: "var(--t-sm)" }}>
            Run <span className="num">npm run seed</span> to populate the demo activity graph.
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {trades.map((t) => (
          <SlideIn key={t.id}>
            <TradeRow trade={t} onTrade={openTrade} />
          </SlideIn>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TrendingStrip({ onTrade }: { onTrade: (s: string) => void }) {
  const { data } = useQuery({
    queryKey: ["trending", "strip"],
    queryFn: () => fetchJSON<{ tokens: TrendingToken[] }>("/api/trending?limit=8"),
    refetchInterval: 20_000
  });
  const tokens = data?.tokens ?? [];
  if (tokens.length === 0) return null;

  return (
    <div className="border-b hairline">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <span className="eyebrow">Trending on Monad</span>
      </div>
      <div className="flex gap-2 px-4 pb-4 overflow-x-auto">
        {tokens.map((t) => (
          <Link
            key={t.symbol}
            href={`/token/${t.symbol}` as Route}
            className="card-2 px-3 py-2 shrink-0 row-hover"
            style={{ minWidth: 132 }}
          >
            <div className="flex items-center gap-2">
              <Avatar name={t.symbol} logo={t.logo} size={22} />
              <span className="num" style={{ fontWeight: 700 }}>
                {t.symbol}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <Num style={{ fontSize: "var(--t-sm)" }}>{price(t.priceUsd)}</Num>
              <Num className={t.change24h >= 0 ? "up" : "down"} style={{ fontSize: "var(--t-sm)" }}>
                {pct(t.change24h)}
              </Num>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
