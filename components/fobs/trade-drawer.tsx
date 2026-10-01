"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { X, ArrowDown, Check, Loader2, Share2, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useFobsAddress } from "./connect-wallet-button";
import { Num } from "./ui";
import { money, price, qty, compactNumber } from "@/lib/format";
import { executionStages, prettyChain } from "@/lib/route";
import type { TokenDTO, RouteQuote, ExecutionStatus } from "@/lib/types";

type Side = "BUY" | "SELL";
type DrawerState = { symbol: string; side: Side } | null;

type Ctx = { openTrade: (symbol: string, side?: Side) => void };
const TradeDrawerCtx = createContext<Ctx>({ openTrade: () => {} });
export const useTradeDrawer = () => useContext(TradeDrawerCtx);

const FUNDING = [
  { chain: "base", token: "USDC", label: "Base USDC" },
  { chain: "monad", token: "USDC", label: "Monad USDC" }
];

export function TradeDrawerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DrawerState>(null);
  const openTrade = useCallback((symbol: string, side: Side = "BUY") => setState({ symbol, side }), []);
  const close = useCallback(() => setState(null), []);

  return (
    <TradeDrawerCtx.Provider value={{ openTrade }}>
      {children}
      <AnimatePresence>
        {state && <TradeDrawer key={state.symbol + state.side} symbol={state.symbol} side={state.side} onClose={close} />}
      </AnimatePresence>
    </TradeDrawerCtx.Provider>
  );
}

type Phase = "form" | "executing" | "done";

function TradeDrawer({ symbol, side, onClose }: { symbol: string; side: Side; onClose: () => void }) {
  const address = useFobsAddress();
  const [token, setToken] = useState<TokenDTO | null>(null);
  const [amount, setAmount] = useState("500");
  const [funding, setFunding] = useState(FUNDING[0]);
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState<ExecutionStatus>("QUOTING");
  const [result, setResult] = useState<{ tradeId: string; amountToken: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const amountUsd = Number(amount) || 0;
  const crossChain = funding.chain !== "monad";

  useEffect(() => {
    let active = true;
    fetch(`/api/tokens/${symbol}`)
      .then((r) => r.json())
      .then((d) => active && setToken(d.token ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [symbol]);

  // Debounced quote.
  useEffect(() => {
    if (side === "SELL" || amountUsd <= 0) {
      setQuote(null);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const r = await fetch("/api/trade/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbol, amountUsd, fromChain: funding.chain, fromToken: funding.token })
        });
        if (r.ok) setQuote((await r.json()).quote);
      } catch {
        /* ignore */
      }
    }, 220);
    return () => clearTimeout(id);
  }, [symbol, amountUsd, funding, side]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const expectedToken = quote?.estimate.toAmountToken ?? (token ? amountUsd / token.priceUsd : 0);

  async function execute() {
    if (!address) {
      setError("Connect your wallet to trade");
      return;
    }
    setError(null);
    setPhase("executing");

    const stages = executionStages(crossChain);
    let acc = 0;
    stages.forEach((stage, i) => {
      const t = setTimeout(() => setStatus(stage.status), acc);
      timers.current.push(t);
      acc += stages[i].durationMs;
    });

    // Fire the real (simulated) execution partway through so the receipt is ready.
    const execTimer = setTimeout(async () => {
      try {
        const r = await fetch("/api/trade/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address,
            symbol,
            side,
            amountUsd: side === "BUY" ? amountUsd : undefined,
            amountToken: side === "SELL" && token ? amountUsd / token.priceUsd : undefined,
            fromChain: funding.chain,
            fromToken: funding.token
          })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Execution failed");
        const finishTimer = setTimeout(() => {
          setResult({ tradeId: d.tradeId, amountToken: d.amountToken });
          setPhase("done");
        }, Math.max(0, acc - 600));
        timers.current.push(finishTimer);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Execution failed");
        setPhase("form");
        setStatus("FAILED");
      }
    }, 400);
    timers.current.push(execTimer);
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.6)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed z-50 card flex flex-col"
        style={{
          right: 0,
          top: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          borderRadius: 0,
          borderRight: "none"
        }}
        initial={{ x: 440 }}
        animate={{ x: 0 }}
        exit={{ x: 440 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Header */}
        <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b hairline">
          <div className="flex items-center gap-2">
            <span className={side === "BUY" ? "up" : "down"} style={{ fontWeight: 700 }}>
              {side}
            </span>
            <span className="num" style={{ fontWeight: 700, fontSize: "var(--t-lg)" }}>
              {symbol}
            </span>
            {token && <span className="muted">{token.name}</span>}
          </div>
          <button className="btn-ghost btn btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {phase === "form" && (
            <div className="flex flex-col gap-5">
              {/* You pay */}
              <div>
                <div className="eyebrow mb-2">You pay</div>
                <div className="flex items-center gap-2 card-2 px-3" style={{ height: 56 }}>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="num bg-transparent outline-none flex-1"
                    style={{ fontSize: "var(--t-2xl)", fontWeight: 600 }}
                  />
                  <span className="chip" style={{ height: 28 }}>
                    {side === "BUY" ? funding.token : symbol}
                  </span>
                </div>
              </div>

              {/* Funding source (BUY only) */}
              {side === "BUY" && (
                <div>
                  <div className="eyebrow mb-2">Funding source</div>
                  <div className="flex flex-col gap-2">
                    {FUNDING.map((f) => {
                      const selected = f.chain === funding.chain;
                      return (
                        <button
                          key={f.chain}
                          onClick={() => setFunding(f)}
                          className="flex items-center gap-3 px-3 h-11 rounded-md text-left"
                          style={{
                            border: `1px solid ${selected ? "var(--primary)" : "var(--border)"}`,
                            background: selected ? "rgba(124,92,255,0.08)" : "var(--surface-2)"
                          }}
                        >
                          <span
                            className="rounded-full shrink-0"
                            style={{
                              width: 14,
                              height: 14,
                              border: `4px solid ${selected ? "var(--primary)" : "var(--faint)"}`,
                              background: selected ? "var(--primary)" : "transparent"
                            }}
                          />
                          <span style={{ fontWeight: 500 }}>{f.label}</span>
                          {f.chain !== "monad" && <span className="chip ml-auto">cross-chain</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Route */}
              {side === "BUY" && (
                <div>
                  <div className="eyebrow mb-2">Route</div>
                  <div className="card-2 p-3 flex flex-col items-center gap-1.5">
                    <RouteNode label={`${prettyChain(funding.chain)} ${funding.token}`} />
                    {crossChain && (
                      <>
                        <ArrowDown size={14} className="faint" />
                        <RouteNode label="Monad" muted />
                      </>
                    )}
                    <ArrowDown size={14} className="faint" />
                    <RouteNode label={symbol} accent />
                  </div>
                </div>
              )}

              {/* Estimate */}
              <div className="card-2 p-3 flex flex-col gap-2" style={{ fontSize: "var(--t-sm)" }}>
                <Line label={side === "BUY" ? "Expected" : "You receive"}>
                  <Num style={{ fontWeight: 600 }}>
                    {side === "BUY" ? `${qty(expectedToken)} ${symbol}` : money(amountUsd)}
                  </Num>
                </Line>
                <Line label="Price impact">
                  <Num>{quote ? `${quote.estimate.priceImpactPct.toFixed(2)}%` : "—"}</Num>
                </Line>
                <Line label="Network + bridge fee">
                  <Num>{quote ? money(quote.estimate.gasCostUsd + quote.estimate.feeCostUsd) : "—"}</Num>
                </Line>
                <Line label="Est. time">
                  <Num>{quote ? `~${quote.estimate.executionDurationSec}s` : "—"}</Num>
                </Line>
              </div>

              {error && (
                <div className="chip chip-down" style={{ height: "auto", padding: "6px 10px" }}>
                  {error}
                </div>
              )}

              <button
                className={`btn ${side === "BUY" ? "btn-buy" : "btn-sell"}`}
                style={{ height: 48 }}
                disabled={amountUsd <= 0 || !token}
                onClick={execute}
              >
                {side} {symbol}
              </button>
              <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
                Simulated execution — no funds move. Route modelled LI.FI-style.
              </p>
            </div>
          )}

          {phase === "executing" && <ExecutingView status={status} crossChain={crossChain} symbol={symbol} />}

          {phase === "done" && result && token && (
            <DoneView
              symbol={symbol}
              side={side}
              amountUsd={amountUsd}
              amountToken={result.amountToken}
              tradeId={result.tradeId}
              onClose={onClose}
            />
          )}
        </div>
      </motion.div>
    </>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="muted">{label}</span>
      {children}
    </div>
  );
}

function RouteNode({ label, muted, accent }: { label: string; muted?: boolean; accent?: boolean }) {
  return (
    <div
      className="num px-3 py-1.5 rounded-md w-full text-center"
      style={{
        background: accent ? "rgba(124,92,255,0.1)" : "var(--surface)",
        border: `1px solid ${accent ? "color-mix(in srgb, var(--primary) 40%, transparent)" : "var(--border)"}`,
        color: muted ? "var(--muted)" : "var(--ink)",
        fontWeight: 600
      }}
    >
      {label}
    </div>
  );
}

function ExecutingView({
  status,
  crossChain,
  symbol
}: {
  status: ExecutionStatus;
  crossChain: boolean;
  symbol: string;
}) {
  const stages = executionStages(crossChain);
  const order = stages.map((s) => s.status);
  const currentIdx = order.indexOf(status);

  return (
    <div className="flex flex-col gap-4 pt-6">
      <div className="eyebrow">Executing on Monad</div>
      <div className="flex flex-col gap-3">
        {stages.map((stage, i) => {
          const done = i < currentIdx || status === "CONFIRMED";
          const active = i === currentIdx && status !== "CONFIRMED";
          return (
            <div key={stage.status} className="flex items-center gap-3">
              <span
                className="flex items-center justify-center rounded-full shrink-0"
                style={{
                  width: 24,
                  height: 24,
                  background: done ? "var(--up)" : active ? "var(--surface-2)" : "transparent",
                  border: `1px solid ${done ? "var(--up)" : "var(--border)"}`
                }}
              >
                {done ? (
                  <Check size={14} color="#04120b" />
                ) : active ? (
                  <Loader2 size={13} className="muted" style={{ animation: "spin 1s linear infinite" }} />
                ) : null}
              </span>
              <span style={{ color: done || active ? "var(--ink)" : "var(--faint)", fontWeight: active ? 600 : 400 }}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: "var(--t-xs)" }}>
        Routing {symbol} through the Fobs route engine…
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DoneView({
  symbol,
  side,
  amountUsd,
  amountToken,
  tradeId,
  onClose
}: {
  symbol: string;
  side: Side;
  amountUsd: number;
  amountToken: number;
  tradeId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/share/${tradeId}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex flex-col items-center gap-2 py-2">
        <span
          className="flex items-center justify-center rounded-full"
          style={{ width: 48, height: 48, background: "var(--up-bg)", border: "1px solid var(--up)" }}
        >
          <Check size={24} className="up" />
        </span>
        <div className="eyebrow up">Trade complete</div>
      </div>

      {/* Share card */}
      <div
        className="rounded-md p-5 flex flex-col gap-3"
        style={{ background: "linear-gradient(160deg, #15131f, #0c0d12)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <span className="num" style={{ fontWeight: 800, letterSpacing: "-0.03em" }}>
            fobs
          </span>
          <span className="chip">Monad</span>
        </div>
        <div>
          <div className="muted" style={{ fontSize: "var(--t-sm)" }}>
            {side === "BUY" ? "Bought" : "Sold"}
          </div>
          <div className="num" style={{ fontSize: "var(--t-2xl)", fontWeight: 700 }}>
            {symbol}
          </div>
        </div>
        <div className="num" style={{ fontSize: "var(--t-lg)" }}>
          {money(amountUsd)} <span className="faint">→</span> {compactNumber(amountToken)} {symbol}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" onClick={copy}>
          {copied ? <Check size={14} /> : <Share2 size={14} />}
          {copied ? "Link copied" : "Share trade"}
        </button>
        <Link href={"/portfolio" as Route} className="btn flex-1" onClick={onClose}>
          View position
        </Link>
      </div>
      <Link href={`/share/${tradeId}` as Route} className="btn btn-ghost btn-sm self-center" onClick={onClose}>
        <Copy size={13} /> Open share page
      </Link>
    </div>
  );
}
