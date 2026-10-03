"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { useFobsAddress } from "./connect-wallet-button";
import { useTradeDrawer } from "./trade-drawer";
import { TradeRow } from "./trade-row";
import { Avatar, Num } from "./ui";
import { money, price, pct, qty, compactNumber } from "@/lib/format";
import type { ProfileDTO } from "@/lib/profile";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("not found");
  return r.json();
}

export function ProfileView({ username }: { username: string }) {
  const address = useFobsAddress();
  const { openTrade } = useTradeDrawer();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["profile", username, address],
    queryFn: () => fetchJSON<ProfileDTO>(`/api/traders/${username}${address ? `?address=${address}` : ""}`)
  });

  const follow = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/follow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, username })
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Follow failed");
      return r.json() as Promise<{ following: boolean }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile", username] })
  });

  if (isLoading) return <div className="p-8 text-center muted">Loading @{username}…</div>;
  if (isError || !data) return <div className="p-8 text-center muted">Trader @{username} not found.</div>;

  const { trader, followers, following, holdings, recentTrades, isFollowedByViewer } = data;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 lg:p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Avatar name={trader.displayName} logo={trader.avatar} size={56} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>@{trader.username}</h1>
            {trader.isNotable && <span className="chip chip-notable">Notable</span>}
          </div>
          <p className="muted">{trader.bio ?? "Monad trader"}</p>
          <div className="flex gap-4 mt-2" style={{ fontSize: "var(--t-sm)" }}>
            <span>
              <Num style={{ fontWeight: 700 }}>{compactNumber(followers)}</Num> <span className="muted">followers</span>
            </span>
            <span>
              <Num style={{ fontWeight: 700 }}>{compactNumber(following)}</Num> <span className="muted">following</span>
            </span>
          </div>
        </div>
        {address && (
          <button
            className={`btn ${isFollowedByViewer ? "" : "btn-primary"}`}
            disabled={follow.isPending}
            onClick={() => follow.mutate()}
          >
            {follow.isPending ? "…" : isFollowedByViewer ? "Following" : "Follow"}
          </button>
        )}
      </div>

      {/* Live on-chain holdings */}
      {holdings.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b hairline eyebrow">Holdings</div>
          {holdings.map((h) => (
            <Link
              key={h.token.symbol}
              href={`/token/${h.token.symbol}` as Route}
              className="flex items-center gap-3 px-4 py-3 border-b hairline row-hover"
            >
              <Avatar name={h.token.symbol} logo={h.token.logo} size={30} />
              <div className="flex-1 min-w-0">
                <div className="num" style={{ fontWeight: 700 }}>
                  {h.token.symbol}
                </div>
                <div className="muted" style={{ fontSize: "var(--t-xs)" }}>
                  <Num>{qty(h.amount)}</Num> @ <Num>{price(h.token.priceUsd)}</Num>
                </div>
              </div>
              <div className="text-right">
                <Num style={{ fontWeight: 600 }}>{money(h.valueUsd)}</Num>
                <div className={h.token.change24h >= 0 ? "up" : "down"} style={{ fontSize: "var(--t-xs)" }}>
                  <Num>{pct(h.token.change24h)}</Num>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent trades */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b hairline eyebrow">Recent trades</div>
        {recentTrades.length === 0 ? (
          <div className="p-6 text-center muted">No trades yet.</div>
        ) : (
          recentTrades.map((t) => <TradeRow key={t.id} trade={t} onTrade={openTrade} />)
        )}
      </div>
    </div>
  );
}
