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
          {p && p.totalValueUsd !== null ? (
            <CountUp value={p.totalValueUsd} format={(n) => money(n)} />
          ) : (
            "—"
          )}
        </div>
        <p className="faint mt-1" style={{ fontSize: "var(--t-xs)" }}>
          Live on-chain balances, priced at current market rates.
          {p && p.holdings.length > 0 && p.totalValueUsd === null &&
            " No price is available for any of them right now, so the total is unknown rather than zero."}
          {p &&
            p.totalValueUsd !== null &&
            p.holdings.some((h) => h.valueUsd === null) &&
            " Holdings with no live price are left out of the total."}
        </p>

        {p && <PnlSummary p={p} />}
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
          <div className="hidden sm:grid items-center gap-3 px-4 py-2 border-b hairline eyebrow sm:grid-cols-[2fr_1fr_1fr_1fr_80px] lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px]">
            <span>Token</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Price</span>
            <span className="text-right hidden lg:block">Avg cost</span>
            <span className="text-right">Value / 24h</span>
            <span className="text-right hidden lg:block">PnL</span>
            <span />
          </div>
          {p.holdings.map((h) => (
            <div
              key={h.token.symbol}
              className="grid grid-cols-[2fr_1fr_auto] sm:grid-cols-[2fr_1fr_1fr_1fr_80px] lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] items-center gap-3 px-4 py-3 border-b hairline row-hover"
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
              <Num className="text-right hidden sm:block">{qty(h.amount)}</Num>
              <Num className="text-right muted hidden sm:block">{price(h.token.priceUsd)}</Num>
              <Num className="text-right muted hidden lg:block">{price(h.avgCostUsd)}</Num>
              <div className="text-right">
                <Num style={{ fontWeight: 600 }}>{money(h.valueUsd)}</Num>
                <div className={h.token.change24h >= 0 ? "up" : "down"} style={{ fontSize: "var(--t-xs)" }}>
                  <Num>{pct(h.token.change24h)}</Num>
                </div>
              </div>
              <div className="text-right hidden lg:block">
                <Num
                  className={h.pnlUsd === null ? "muted" : h.pnlUsd >= 0 ? "up" : "down"}
                  style={{ fontWeight: 600 }}
                >
                  {h.pnlUsd !== null && h.pnlUsd >= 0 ? `+${money(h.pnlUsd)}` : money(h.pnlUsd)}
                </Num>
                <div className="faint" style={{ fontSize: "var(--t-xs)" }}>
                  <Num>{h.pnlPct === null ? "—" : pct(h.pnlPct)}</Num>
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

function PnlStat({ label, value, tone }: { label: string; value: number | null; tone?: boolean }) {
  const cls = tone && value !== null ? (value >= 0 ? "up" : "down") : undefined;
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <Num className={cls} style={{ fontWeight: 600 }}>
        {tone && value !== null && value >= 0 ? `+${money(value)}` : money(value)}
      </Num>
    </div>
  );
}

/**
 * PnL header. The three states are genuinely different facts, so they get three
 * different sentences — never one number that hides which one applies.
 */
function PnlSummary({ p }: { p: PortfolioDTO }) {
  if (p.pnlStatus === "unavailable") {
    return (
      <p className="faint mt-3" style={{ fontSize: "var(--t-xs)" }}>
        PnL is unavailable — your trade history couldn&apos;t be read just now. The balances above
        are unaffected; they come straight from the chain.
      </p>
    );
  }

  if (p.pnlStatus === "empty") {
    return (
      <p className="faint mt-3" style={{ fontSize: "var(--t-xs)" }}>
        No recorded trade history to build a cost basis from yet. Positions you buy through fobs get
        an average-cost basis and a PnL line here.
      </p>
    );
  }

  const coverage = p.pnlCoveragePct;
  const uncovered = coverage === null ? 0 : Math.max(0, 100 - coverage);

  return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <PnlStat label="Unrealized" value={p.unrealizedPnlUsd} tone />
        <PnlStat label="Realized" value={p.realizedPnlUsd} tone />
        <PnlStat label="Cost basis" value={p.costBasisUsd} />
      </div>
      <p className="faint mt-2" style={{ fontSize: "var(--t-xs)" }}>
        Average cost across the {p.basisTrades} {p.basisTrades === 1 ? "trade" : "trades"} recorded
        in fobs
        {coverage !== null && `, covering ${coverage.toFixed(0)}% of your priced holdings`}.
        {uncovered >= 1 &&
          ` The other ${uncovered.toFixed(0)}% wasn't bought through fobs, so it's left out rather than given a cost we'd be making up.`}
      </p>
    </>
  );
}
