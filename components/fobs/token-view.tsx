"use client";

import { useQuery } from "@tanstack/react-query";
import { useTradeDrawer } from "./trade-drawer";
import { TradeRow } from "./trade-row";
import { PriceChart } from "./price-chart";
import { Avatar, Num, SignalBar } from "./ui";
import { price, pct, compactMoney, compactNumber } from "@/lib/format";
import type { TokenDTO, TradeDTO, SignalDTO } from "@/lib/types";

type TokenResp = { token: TokenDTO; activity: TradeDTO[]; signal: SignalDTO | null };

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("not found");
  return r.json();
}

export function TokenView({ symbol }: { symbol: string }) {
  const { openTrade } = useTradeDrawer();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["token", symbol],
    queryFn: () => fetchJSON<TokenResp>(`/api/tokens/${symbol}`),
    refetchInterval: 15_000
  });

  if (isLoading) return <div className="p-8 text-center muted">Loading {symbol}…</div>;
  if (isError || !data) return <div className="p-8 text-center muted">Token {symbol} not found.</div>;

  const { token, activity, signal } = data;
  const up = token.change24h >= 0;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 lg:p-6 grid gap-6" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Avatar name={token.symbol} logo={token.logo} size={44} />
              <div>
                <div className="num" style={{ fontSize: "var(--t-xl)", fontWeight: 800 }}>
                  {token.symbol}
                </div>
                <div className="muted">{token.name}</div>
              </div>
            </div>
            <div className="text-right">
              <Num style={{ fontSize: "var(--t-3xl)", fontWeight: 700 }}>{price(token.priceUsd)}</Num>
              <div className={up ? "up" : "down"}>
                <Num style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{pct(token.change24h)}</Num>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Market cap" value={compactMoney(token.marketCap)} />
            <Stat label="24h volume" value={compactMoney(token.volume24h)} />
            <Stat label="Liquidity" value={compactMoney(token.liquidity)} />
          </div>

          {/* Chart */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow">Price · live</span>
              <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                top Monad pool
              </span>
            </div>
            <PriceChart symbol={token.symbol} up={up} />
          </div>

          {/* Buy / Sell */}
          <div className="flex gap-3">
            <button className="btn btn-buy flex-1" style={{ height: 46 }} onClick={() => openTrade(token.symbol, "BUY")}>
              Buy {token.symbol}
            </button>
            <button className="btn btn-sell flex-1" style={{ height: 46 }} onClick={() => openTrade(token.symbol, "SELL")}>
              Sell {token.symbol}
            </button>
          </div>
        </div>

        {/* Side rail: signal + activity */}
        <div className="flex flex-col gap-5">
          {signal && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="eyebrow">Fobs Signal</span>
                <span className="chip">our metric</span>
              </div>
              <SignalBar score={signal.score} />
              <div className="mt-3 flex flex-col gap-1.5" style={{ fontSize: "var(--t-sm)" }}>
                <SignalLine label="Volume (24h)" value={compactMoney(signal.volumeUsd)} />
                <SignalLine label="Buyer growth" value={pct(signal.buyerGrowthPct)} up={signal.buyerGrowthPct >= 0} />
                <SignalLine
                  label="Unique wallets"
                  value={pct(signal.uniqueWalletGrowthPct)}
                  up={signal.uniqueWalletGrowthPct >= 0}
                />
                <SignalLine label="Buy pressure" value={`${signal.buyPressurePct}%`} />
                <SignalLine label="Notable active" value={compactNumber(signal.notableActive)} />
              </div>
              <p className="faint mt-3" style={{ fontSize: "var(--t-xs)" }}>
                A momentum blend from the activity graph. Not financial advice or a price prediction.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Activity (full width) */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b hairline eyebrow">Activity</div>
        {activity.length === 0 ? (
          <div className="p-6 text-center muted">No trades on {token.symbol} yet.</div>
        ) : (
          activity.map((t) => <TradeRow key={t.id} trade={t} onTrade={openTrade} />)
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-2 p-3">
      <div className="muted" style={{ fontSize: "var(--t-xs)" }}>
        {label}
      </div>
      <Num style={{ fontSize: "var(--t-lg)", fontWeight: 600 }}>{value}</Num>
    </div>
  );
}

function SignalLine({ label, value, up }: { label: string; value: string; up?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="muted">{label}</span>
      <Num className={up === undefined ? "" : up ? "up" : "down"}>{value}</Num>
    </div>
  );
}
