"use client";

import { useQuery } from "@tanstack/react-query";
import { useTradeDrawer } from "./trade-drawer";
import { TradeRow } from "./trade-row";
import { PriceChart } from "./price-chart";
import { Avatar, Num, SignalBar } from "./ui";
import { price, pct, compactMoney, compactNumber, money, ago, shortAddress, addressUrl } from "@/lib/format";
import type { TokenDTO, TradeDTO, SignalDTO, ChainActivityDTO, KuruTradeDTO } from "@/lib/types";

type TokenResp = {
  token: TokenDTO;
  // null = the DB did not answer (NOT "no trades"). [] = genuinely no trades.
  activity: TradeDTO[] | null;
  signal: SignalDTO | null;
  smartMoney: { holders: number; netflowUsd: number } | null;
  // Raw on-chain ERC20 transfers (Envio) — null when the indexer is
  // unconfigured or did not answer. Not the same thing as `activity`.
  chainActivity: ChainActivityDTO | null;
  // Real OrderBook fills (Envio) — null when the indexer did not answer, or when
  // it carries no KuruTrade entity yet. Either way the card is absent.
  kuruTrades: KuruTradeDTO[] | null;
  kuruMarket: { address: string; baseSymbol: string | null; quoteSymbol: string | null } | null;
};

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

  const { token, activity, signal, smartMoney, chainActivity, kuruTrades, kuruMarket } = data;
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

          {smartMoney && (smartMoney.holders > 0 || smartMoney.netflowUsd !== 0) && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="eyebrow">Smart money</span>
                <span className="chip">Nansen</span>
              </div>
              <div className="flex flex-col gap-1.5" style={{ fontSize: "var(--t-sm)" }}>
                <SignalLine label="Wallets holding" value={compactNumber(smartMoney.holders)} />
                <SignalLine
                  label="Net flow"
                  value={money(smartMoney.netflowUsd)}
                  up={smartMoney.netflowUsd >= 0}
                />
              </div>
              <p className="faint mt-3" style={{ fontSize: "var(--t-xs)" }}>
                Labeled smart-money activity from Nansen.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Activity (full width) */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b hairline eyebrow">Activity</div>
        {activity === null ? (
          <div className="p-6 text-center muted">Trade history is temporarily unavailable.</div>
        ) : activity.length === 0 ? (
          <div className="p-6 text-center muted">No trades on {token.symbol} yet.</div>
        ) : (
          activity.map((t) => <TradeRow key={t.id} trade={t} onTrade={openTrade} />)
        )}
      </div>

      {/* Kuru order book — real fills. Distinct from both the app's own trade
          feed and the transfer list below: this is somebody's order meeting
          somebody else's, read off the chain. */}
      {kuruTrades && kuruMarket && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b hairline flex items-center justify-between gap-3 flex-wrap">
            <span className="eyebrow">Kuru order book</span>
            <span className="chip">
              {kuruMarket.baseSymbol ?? "?"} / {kuruMarket.quoteSymbol ?? "?"}
            </span>
          </div>

          {kuruTrades.length === 0 ? (
            <div className="p-6 text-center muted">No fills indexed on this market yet.</div>
          ) : (
            kuruTrades.map((t) => (
              <div
                key={t.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3 border-b hairline last:border-b-0 row-hover"
                style={{ fontSize: "var(--t-sm)" }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={t.isBuy ? "up" : "down"} style={{ fontWeight: 600 }}>
                    {t.isBuy ? "Buy" : "Sell"}
                  </span>
                  <a
                    href={addressUrl(t.maker)}
                    target="_blank"
                    rel="noreferrer"
                    className="num faint hover:underline truncate"
                  >
                    {shortAddress(t.maker)}
                  </a>
                </span>
                <span className="flex items-center gap-3 shrink-0 num">
                  {/* A price and a size that could not be scaled render as an
                      em dash, never as a zero. */}
                  <span className="muted">{price(t.priceQuotePerBase)}</span>
                  <span>
                    {t.baseAmount === null ? (
                      <span className="faint">—</span>
                    ) : (
                      <>
                        {compactNumber(t.baseAmount)} {kuruMarket.baseSymbol}
                      </>
                    )}
                  </span>
                  <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                    {ago(new Date(t.timestamp * 1000))}
                  </span>
                </span>
              </div>
            ))
          )}

          <p className="px-4 py-3 faint border-t hairline" style={{ fontSize: "var(--t-xs)" }}>
            Fills on the Kuru {kuruMarket.baseSymbol ?? "?"}/{kuruMarket.quoteSymbol ?? "?"} order book,
            indexed by Envio — a matched trade, not a transfer.
          </p>
        </div>
      )}

      {/* Chain-wide activity — raw ERC20 transfers from the Envio indexer. Kept
          distinct from the trade feed above: a transfer is not a trade. */}
      {chainActivity && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b hairline flex items-center justify-between gap-3 flex-wrap">
            <span className="eyebrow">Chain activity</span>
            <span className="flex items-center gap-2">
              <span className="chip">Envio</span>
              <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                <Num>{compactNumber(chainActivity.indexedTransfers)}</Num> transfers ·{" "}
                <Num>{compactNumber(chainActivity.indexedVolumeToken)}</Num> {token.symbol} indexed
              </span>
            </span>
          </div>

          {chainActivity.transfers.length === 0 ? (
            <div className="p-6 text-center muted">No {token.symbol} transfers indexed yet.</div>
          ) : (
            chainActivity.transfers.map((t) => (
              <div
                key={t.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3 border-b hairline last:border-b-0 row-hover"
                style={{ fontSize: "var(--t-sm)" }}
              >
                <span className="num min-w-0 truncate">
                  <a href={addressUrl(t.from)} target="_blank" rel="noreferrer" className="muted hover:underline">
                    {shortAddress(t.from)}
                  </a>
                  <span className="faint"> → </span>
                  <a href={addressUrl(t.to)} target="_blank" rel="noreferrer" className="hover:underline">
                    {shortAddress(t.to)}
                  </a>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <Num>
                    {compactNumber(t.amountToken)} {token.symbol}
                  </Num>
                  <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                    {ago(new Date(t.timestamp * 1000))}
                  </span>
                </span>
              </div>
            ))
          )}

          <p className="px-4 py-3 faint border-t hairline" style={{ fontSize: "var(--t-xs)" }}>
            Raw ERC20 transfers indexed on-chain by Envio — a transfer is not a trade. Newest
            indexed block {ago(new Date(chainActivity.lastIndexedAt * 1000))}.
          </p>
        </div>
      )}
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
