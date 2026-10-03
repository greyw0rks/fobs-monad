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
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "request failed");
  return r.json();
}

export function PortfolioView() {
  const address = useFobsAddress();
  const { openTrade } = useTradeDrawer();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => fetchJSON<PortfolioDTO>(`/api/portfolio?address=${address}`),
    enabled: Boolean(address),
    refetchInterval: 20_000
  });

  if (!address) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <h1 style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>Your portfolio</h1>
        <p className="muted mt-2">Connect your wallet to see your live Monad balances.</p>
      </div>
    );
  }

  const p = data;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 lg:p-6 flex flex-col gap-6">
      <div>
        <div className="eyebrow mb-1">Total value</div>
        <div className="num" style={{ fontSize: "var(--t-3xl)", fontWeight: 700 }}>
          {p ? <CountUp value={p.totalValueUsd} format={(n) => money(n)} /> : "—"}
        </div>
        <p className="faint mt-1" style={{ fontSize: "var(--t-xs)" }}>
          Live on-chain balances, priced at current market rates. PnL needs your reconstructed trade
          history — coming with the indexer.
        </p>
      </div>

      {isLoading && <div className="p-6 text-center muted">Reading on-chain balances…</div>}

      {isError && (
        <div className="card p-8 text-center">
          <div className="muted">Couldn&apos;t read your balances.</div>
          <div className="faint mt-1" style={{ fontSize: "var(--t-sm)" }}>
            {error instanceof Error ? error.message : "Monad RPC unavailable"}
          </div>
        </div>
      )}

      {p && p.holdings.length === 0 && !isLoading && (
        <div className="card p-8 text-center">
          <div className="muted">No tokens in this wallet yet.</div>
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
            <span className="text-right">Price</span>
            <span className="text-right">Value / 24h</span>
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
                  <div className="muted truncate" style={{ fontSize: "var(--t-xs)" }}>
                    {h.token.name}
                  </div>
                </div>
              </Link>
              <Num className="text-right">{qty(h.amount)}</Num>
              <Num className="text-right muted">{price(h.token.priceUsd)}</Num>
              <div className="text-right">
                <Num style={{ fontWeight: 600 }}>{money(h.valueUsd)}</Num>
                <div className={h.token.change24h >= 0 ? "up" : "down"} style={{ fontSize: "var(--t-xs)" }}>
                  <Num>{pct(h.token.change24h)}</Num>
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
          <div className="px-4 py-3 border-b hairline eyebrow">Your trades</div>
          {p.recentTrades.map((t) => (
            <TradeRow key={t.id} trade={t} onTrade={openTrade} />
          ))}
        </div>
      )}
    </div>
  );
}
