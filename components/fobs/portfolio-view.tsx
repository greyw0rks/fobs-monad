"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { useFobsAddress } from "./connect-wallet-button";
import { useTradeDrawer } from "./trade-drawer";
import { TradeRow } from "./trade-row";
import { Avatar, Num } from "./ui";
import { CountUp } from "./motion";
import { money, price, pct, qty } from "@/lib/format";
import type { PortfolioDTO } from "@/lib/types";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("request failed");
  return r.json();
}

export function PortfolioView() {
  const address = useFobsAddress();
  const { openTrade } = useTradeDrawer();
  const { data, isLoading } = useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => fetchJSON<PortfolioDTO>(`/api/portfolio?address=${address}`),
    enabled: Boolean(address),
    refetchInterval: 15_000
  });

  if (!address) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <h1 style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>Your portfolio</h1>
        <p className="muted mt-2">Connect your wallet to see your Monad positions and PnL.</p>
      </div>
    );
  }

  const p = data;
  const pnlUp = (p?.unrealizedPnlUsd ?? 0) >= 0;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 lg:p-6 flex flex-col gap-6">
      <div>
        <div className="eyebrow mb-1">Total value</div>
        <div className="num" style={{ fontSize: "var(--t-3xl)", fontWeight: 700 }}>
          {p ? (
            <CountUp value={p.totalValueUsd} format={(n) => money(n)} />
          ) : (
            "—"
          )}
        </div>
        {p && (
          <div className={`mt-1 ${pnlUp ? "up" : "down"}`}>
            <Num style={{ fontWeight: 600 }}>
              {pnlUp ? "+" : ""}
              {money(p.unrealizedPnlUsd)} ({pct(p.unrealizedPnlPct)})
            </Num>
            <span className="muted ml-2" style={{ fontSize: "var(--t-sm)" }}>
              unrealized · realized <Num className={p.realizedPnlUsd >= 0 ? "up" : "down"}>{money(p.realizedPnlUsd)}</Num>
            </span>
          </div>
        )}
      </div>

      {isLoading && <div className="p-6 text-center muted">Loading positions…</div>}

      {p && p.holdings.length === 0 && !isLoading && (
        <div className="card p-8 text-center">
          <div className="muted">No positions yet.</div>
          <Link href={"/explore" as Route} className="btn btn-primary btn-sm mt-3 inline-flex">
            Discover tokens
          </Link>
        </div>
      )}

      {p && p.holdings.length > 0 && (
        <div className="card overflow-hidden">
          <div
            className="hidden sm:grid items-center gap-3 px-4 py-2 border-b hairline eyebrow"
            style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 80px" }}
          >
            <span>Token</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Avg entry</span>
            <span className="text-right">Value / PnL</span>
            <span />
          </div>
          {p.holdings.map((h) => (
            <div
              key={h.token.symbol}
              className="grid items-center gap-3 px-4 py-3 border-b hairline row-hover"
              style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 80px" }}
            >
              <Link href={`/token/${h.token.symbol}` as Route} className="flex items-center gap-3 min-w-0">
                <Avatar name={h.token.symbol} logo={h.token.logo} size={32} />
                <div className="min-w-0">
                  <div className="num" style={{ fontWeight: 700 }}>
                    {h.token.symbol}
                  </div>
                  <Num className="muted" >{price(h.token.priceUsd)}</Num>
                </div>
              </Link>
              <Num className="text-right">{qty(h.amount)}</Num>
              <Num className="text-right muted">{price(h.avgEntryUsd)}</Num>
              <div className="text-right">
                <Num style={{ fontWeight: 600 }}>{money(h.valueUsd)}</Num>
                <div className={h.unrealizedPnlUsd >= 0 ? "up" : "down"} style={{ fontSize: "var(--t-xs)" }}>
                  <Num>{pct(h.unrealizedPnlPct)}</Num>
                </div>
              </div>
              <button className="btn btn-sm justify-self-end" onClick={() => openTrade(h.token.symbol)}>
                Trade
              </button>
            </div>
          ))}
        </div>
      )}

      {p && p.recentTrades.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b hairline eyebrow">Recent trades</div>
          {p.recentTrades.map((t) => (
            <TradeRow key={t.id} trade={t} onTrade={openTrade} />
          ))}
        </div>
      )}
    </div>
  );
}
