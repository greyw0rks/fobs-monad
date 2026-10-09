"use client";

import { useState } from "react";
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

type Kuru = NonNullable<TokenResp["kuruMarket"]>;
type OpenTrade = (symbol: string, side?: "BUY" | "SELL", amount?: string) => void;

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
    <div className="mx-auto w-full max-w-7xl p-3 lg:p-5 flex flex-col gap-3">
      {/* Market bar — the ticker strip across the top of the terminal. */}
      <div className="card px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Avatar name={token.symbol} logo={token.logo} size={40} />
          <div>
            <div className="flex items-center gap-2">
              <span className="num" style={{ fontSize: "var(--t-xl)", fontWeight: 800 }}>
                {token.symbol}
              </span>
              <span className="live-dot" title="Live" />
            </div>
            <div className="muted" style={{ fontSize: "var(--t-xs)" }}>
              {token.name} · Monad
            </div>
          </div>
        </div>
        <div className="flex items-stretch gap-5 flex-wrap">
          <MarketStat label="Price" value={price(token.priceUsd)}>
            <Num className={up ? "up" : "down"} style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>
              {pct(token.change24h)}
            </Num>
          </MarketStat>
          <MarketStat label="Market cap" value={compactMoney(token.marketCap)} />
          <MarketStat label="24h volume" value={compactMoney(token.volume24h)} />
          <MarketStat label="Liquidity" value={compactMoney(token.liquidity)} />
        </div>
      </div>

      {/* Main — chart + activity on the left, the order ticket and read-outs
          on the right. A dense, single-screen trading layout. */}
      <div className="grid gap-3 lg:grid-cols-[1fr_336px] items-start">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <Num style={{ fontSize: "var(--t-2xl)", fontWeight: 700 }}>{price(token.priceUsd)}</Num>
                <Num className={up ? "up" : "down"} style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>
                  {pct(token.change24h)}
                </Num>
              </div>
              <span className="eyebrow">Live · top Monad pool</span>
            </div>
            <PriceChart symbol={token.symbol} up={up} height={360} />
          </div>

          <ActivityPanel
            token={token}
            activity={activity}
            kuruTrades={kuruTrades}
            kuruMarket={kuruMarket}
            chainActivity={chainActivity}
            openTrade={openTrade}
          />
        </div>

        <div className="flex flex-col gap-3">
          <OrderTicket token={token} openTrade={openTrade} />
          {signal && <SignalCard signal={signal} />}
          {smartMoney && (smartMoney.holders > 0 || smartMoney.netflowUsd !== 0) && (
            <SmartMoneyCard smartMoney={smartMoney} />
          )}
        </div>
      </div>
    </div>
  );
}

function MarketStat({
  label,
  value,
  children
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-center" style={{ minWidth: 72 }}>
      <span className="muted" style={{ fontSize: "var(--t-xs)" }}>
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <Num style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{value}</Num>
        {children}
      </div>
    </div>
  );
}

// Order ticket — a market-order entry panel. The real quote/approve/sign/record
// flow lives in the trade drawer; this hands it the side and a starting amount
// so the terminal has a one-click entry without duplicating the swap logic.
function OrderTicket({ token, openTrade }: { token: TokenDTO; openTrade: OpenTrade }) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("100");
  const isBuy = side === "BUY";
  const presets = ["50", "100", "250", "1000"];

  return (
    <div className="card p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Order</span>
        <span className="chip">Market</span>
      </div>

      <div className="grid grid-cols-2 gap-1 card-2 p-1">
        <button
          onClick={() => setSide("BUY")}
          className="btn btn-sm"
          style={{
            background: isBuy ? "var(--up)" : "transparent",
            color: isBuy ? "#04120b" : "var(--up)",
            borderColor: "transparent",
            fontWeight: 600
          }}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("SELL")}
          className="btn btn-sm"
          style={{
            background: !isBuy ? "var(--down)" : "transparent",
            color: !isBuy ? "#1a0608" : "var(--down)",
            borderColor: "transparent",
            fontWeight: 600
          }}
        >
          Sell
        </button>
      </div>

      <div>
        <span className="eyebrow">{isBuy ? "Amount (USD)" : `Amount (${token.symbol})`}</span>
        <div className="flex items-center gap-2 card-2 px-3 mt-2" style={{ height: 48 }}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            className="num flex-1"
            style={{ background: "transparent", outline: "none", border: "none", fontSize: "var(--t-xl)", fontWeight: 600 }}
          />
          <span className="chip" style={{ height: 28 }}>
            {isBuy ? "USD" : token.symbol}
          </span>
        </div>
      </div>

      {isBuy && (
        <div className="flex gap-1">
          {presets.map((p) => (
            <button
              key={p}
              className="btn btn-sm flex-1"
              onClick={() => setAmount(p)}
              style={{
                background: amount === p ? "var(--surface-2)" : "transparent",
                borderColor: amount === p ? "var(--border)" : "transparent"
              }}
            >
              ${p}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between" style={{ fontSize: "var(--t-sm)" }}>
        <span className="muted">{token.symbol} price</span>
        <Num>{price(token.priceUsd)}</Num>
      </div>

      <button
        className={`btn ${isBuy ? "btn-buy" : "btn-sell"}`}
        style={{ height: 46 }}
        onClick={() => openTrade(token.symbol, side, amount)}
      >
        {isBuy ? "Buy" : "Sell"} {token.symbol}
      </button>
      <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
        Market order routed through Kuru with a 0x fallback. You review and sign it in your own wallet.
      </p>
    </div>
  );
}

// The lower panel: three distinct read models behind tabs. They are deliberately
// NOT merged — the app's own trades, matched OrderBook fills, and raw ERC20
// transfers are three different facts, and a tab that is absent means that read
// model had nothing to render (indexer unconfigured / no entity yet).
function ActivityPanel({
  token,
  activity,
  kuruTrades,
  kuruMarket,
  chainActivity,
  openTrade
}: {
  token: TokenDTO;
  activity: TradeDTO[] | null;
  kuruTrades: KuruTradeDTO[] | null;
  kuruMarket: TokenResp["kuruMarket"];
  chainActivity: ChainActivityDTO | null;
  openTrade: OpenTrade;
}) {
  const hasKuru = Boolean(kuruTrades && kuruMarket);
  const hasTransfers = Boolean(chainActivity);
  const tabs = [
    { key: "trades", label: "Trades", show: true },
    { key: "kuru", label: "Order book", show: hasKuru },
    { key: "transfers", label: "Transfers", show: hasTransfers }
  ].filter((t) => t.show);
  const [tab, setTab] = useState("trades");
  const active = tabs.some((t) => t.key === tab) ? tab : "trades";

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1 px-2 border-b hairline">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-3 py-3"
            style={{
              fontSize: "var(--t-sm)",
              fontWeight: 600,
              color: active === t.key ? "var(--ink)" : "var(--muted)",
              borderBottom: `2px solid ${active === t.key ? "var(--ink)" : "transparent"}`,
              marginBottom: -1
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "trades" && <TradesTab token={token} activity={activity} openTrade={openTrade} />}
      {active === "kuru" && kuruTrades && kuruMarket && (
        <KuruTab kuruTrades={kuruTrades} kuruMarket={kuruMarket} />
      )}
      {active === "transfers" && chainActivity && <TransfersTab token={token} chainActivity={chainActivity} />}
    </div>
  );
}

function TradesTab({
  token,
  activity,
  openTrade
}: {
  token: TokenDTO;
  activity: TradeDTO[] | null;
  openTrade: OpenTrade;
}) {
  if (activity === null) return <div className="p-6 text-center muted">Trade history is temporarily unavailable.</div>;
  if (activity.length === 0) return <div className="p-6 text-center muted">No trades on {token.symbol} yet.</div>;
  return (
    <>
      {activity.map((t) => (
        <TradeRow key={t.id} trade={t} onTrade={openTrade} />
      ))}
    </>
  );
}

// Matched OrderBook fills (Envio) — somebody's order meeting somebody else's,
// read off the chain. A price/size that could not be scaled renders as an em
// dash, never a zero.
function KuruTab({ kuruTrades, kuruMarket }: { kuruTrades: KuruTradeDTO[]; kuruMarket: Kuru }) {
  return (
    <>
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-b hairline">
        <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
          Kuru · indexed by Envio
        </span>
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
        Fills on the Kuru {kuruMarket.baseSymbol ?? "?"}/{kuruMarket.quoteSymbol ?? "?"} order book, indexed by
        Envio — a matched trade, not a transfer.
      </p>
    </>
  );
}

// Raw ERC20 transfers (Envio). A transfer is not a trade; this is kept its own
// tab for exactly that reason.
function TransfersTab({ token, chainActivity }: { token: TokenDTO; chainActivity: ChainActivityDTO }) {
  return (
    <>
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-b hairline">
        <span className="chip">Envio</span>
        <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
          <Num>{compactNumber(chainActivity.indexedTransfers)}</Num> transfers ·{" "}
          <Num>{compactNumber(chainActivity.indexedVolumeToken)}</Num> {token.symbol} indexed
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
        Raw ERC20 transfers indexed on-chain by Envio — a transfer is not a trade. Newest indexed block{" "}
        {ago(new Date(chainActivity.lastIndexedAt * 1000))}.
      </p>
    </>
  );
}

function SignalCard({ signal }: { signal: SignalDTO }) {
  return (
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
  );
}

function SmartMoneyCard({ smartMoney }: { smartMoney: { holders: number; netflowUsd: number } }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">Smart money</span>
        <span className="chip">Nansen</span>
      </div>
      <div className="flex flex-col gap-1.5" style={{ fontSize: "var(--t-sm)" }}>
        <SignalLine label="Wallets holding" value={compactNumber(smartMoney.holders)} />
        <SignalLine label="Net flow" value={money(smartMoney.netflowUsd)} up={smartMoney.netflowUsd >= 0} />
      </div>
      <p className="faint mt-3" style={{ fontSize: "var(--t-xs)" }}>
        Labeled smart-money activity from Nansen.
      </p>
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






