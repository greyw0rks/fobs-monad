"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { X, ArrowDown, Check, Loader2, Share2, Copy, ExternalLink, AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useAccount, useBalance, useConfig, useSwitchChain } from "wagmi";
import { sendTransaction, writeContract, waitForTransactionReceipt, readContract } from "wagmi/actions";
import { erc20Abi, type Address } from "viem";
import { useFobsAddress, useOnMonad } from "./connect-wallet-button";
import { Num } from "./ui";
import { money, qty, compactNumber, txUrl } from "@/lib/format";
import { bySymbol, QUOTE_SYMBOL } from "@/lib/registry";
import { MONAD_CHAIN_ID } from "@/lib/wagmi";
import type { TokenDTO, SwapQuoteDTO, SwapStatus } from "@/lib/types";

type Side = "BUY" | "SELL";
type DrawerState = { symbol: string; side: Side } | null;

type Ctx = { openTrade: (symbol: string, side?: Side) => void };
const TradeDrawerCtx = createContext<Ctx>({ openTrade: () => {} });
export const useTradeDrawer = () => useContext(TradeDrawerCtx);

const SLIPPAGE_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 }
];

const QUOTE_TOKEN = bySymbol(QUOTE_SYMBOL)!; // USDC — the funding/quote leg

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
  const onMonad = useOnMonad();
  const { chainId } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const config = useConfig();

  const [token, setToken] = useState<TokenDTO | null>(null);
  const [amount, setAmount] = useState(side === "BUY" ? "100" : "");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<SwapQuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState<SwapStatus>("IDLE");
  const [result, setResult] = useState<{ tradeId: string | null; txHash: string; amountToken: number; amountUsd: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);

  const amountNum = Number(amount) || 0;
  const isBuy = side === "BUY";
  const subjectMeta = bySymbol(symbol);

  // The asset the wallet spends: USDC for a buy, the subject token for a sell
  // (native MON reads the native balance, not its WMON wrapper).
  const sellTokenAddress: Address | undefined = isBuy
    ? (QUOTE_TOKEN.address as Address)
    : subjectMeta?.isNative
      ? undefined
      : (token?.address as Address | undefined);

  useEffect(() => {
    let live = true;
    fetch(`/api/tokens/${symbol}`)
      .then((r) => r.json())
      .then((d) => live && setToken(d.token ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [symbol]);

  // Live wallet balance of the spend leg, for the "Max"/available display.
  const { data: balance } = useBalance({
    address: address as Address | undefined,
    token: isBuy ? (QUOTE_TOKEN.address as Address) : (sellTokenAddress ?? undefined),
    chainId: MONAD_CHAIN_ID,
    query: { enabled: Boolean(address) && onMonad && (isBuy || Boolean(sellTokenAddress) || Boolean(subjectMeta?.isNative)) }
  });
  const available = balance ? Number(balance.formatted) : null;

  // Debounced real quote from 0x (server-proxied).
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!address || !onMonad || amountNum <= 0) return;
    let live = true;
    const id = setTimeout(async () => {
      setQuoting(true);
      try {
        const r = await fetch("/api/trade/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol,
            side,
            taker: address,
            slippageBps,
            amount
          })
        });
        const d = await r.json();
        if (!live) return;
        if (!r.ok) setQuoteError(d.error ?? "Quote failed");
        else setQuote(d.quote);
      } catch {
        if (live) setQuoteError("Could not reach the routing service");
      } finally {
        if (live) setQuoting(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, side, amount, amountNum, slippageBps, address, onMonad]);

  async function execute() {
    if (!address || !quote) return;
    setError(null);
    setPhase("executing");
    try {
      // 1. Approve the router's spender if 0x says the ERC20 allowance is short.
      if (quote.allowanceTarget && quote.allowanceNeeded && !quote.sellIsNative) {
        const spender = quote.allowanceTarget as Address;
        const needed = BigInt(quote.allowanceNeeded);
        const current = (await readContract(config, {
          address: quote.sellTokenAddress as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address as Address, spender]
        })) as bigint;

        if (current < needed) {
          setStatus("APPROVING");
          const approveHash = await writeContract(config, {
            address: quote.sellTokenAddress as Address,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, needed],
            account: address as Address
          });
          await waitForTransactionReceipt(config, { hash: approveHash });
        }
      }

      // 2. The swap itself — signed in the user's wallet.
      setStatus("SIGNING");
      const hash = await sendTransaction(config, {
        to: quote.to as Address,
        data: quote.data as `0x${string}`,
        value: BigInt(quote.value),
        account: address as Address
      });

      setStatus("SUBMITTED");
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted on-chain");

      // 3. Record — the server verifies the receipt and derives the real amounts.
      setStatus("CONFIRMING");
      let tradeId: string | null = null;
      let amountToken = quote.buyAmountToken;
      let amountUsd = quote.sellAmountToken;
      try {
        const r = await fetch("/api/trade/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: hash, address, symbol, side })
        });
        const d = await r.json();
        if (r.ok) {
          tradeId = d.tradeId;
          amountToken = d.amountToken;
          amountUsd = d.amountUsd;
        }
      } catch {
        /* recorded is best-effort; the swap is already on-chain */
      }

      if (!active.current) return;
      setResult({ tradeId, txHash: hash, amountToken, amountUsd });
      setStatus("CONFIRMED");
      setPhase("done");
    } catch (e) {
      if (!active.current) return;
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setError(msg.split("\n")[0]);
      setStatus("FAILED");
      setPhase("form");
    }
  }

  const wrongChain = Boolean(address) && chainId !== MONAD_CHAIN_ID;

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
        style={{ right: 0, top: 0, bottom: 0, width: "min(420px, 100vw)", borderRadius: 0, borderRight: "none" }}
        initial={{ x: 440 }}
        animate={{ x: 0 }}
        exit={{ x: 440 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Header */}
        <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b hairline">
          <div className="flex items-center gap-2">
            <span className={isBuy ? "up" : "down"} style={{ fontWeight: 700 }}>
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
          {wrongChain && (
            <div className="flex flex-col gap-3 pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="down" />
                <span style={{ fontWeight: 600 }}>Wrong network</span>
              </div>
              <p className="muted">
                Fobs trades on Monad mainnet. Switch your wallet to Monad to continue.
              </p>
              <button className="btn btn-primary" style={{ height: 46 }} disabled={isSwitching} onClick={() => switchChain({ chainId: MONAD_CHAIN_ID })}>
                {isSwitching ? "Switching…" : "Switch to Monad"}
              </button>
            </div>
          )}

          {!wrongChain && phase === "form" && (
            <div className="flex flex-col gap-5">
              {/* You pay */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="eyebrow">{isBuy ? "You pay (USD)" : `You sell (${symbol})`}</span>
                  {available != null && (
                    <button
                      className="faint"
                      style={{ fontSize: "var(--t-xs)" }}
                      onClick={() => setAmount(String(isBuy ? Math.floor(available * 100) / 100 : Math.floor(available * 1e4) / 1e4))}
                    >
                      Available {qty(available)} {isBuy ? QUOTE_TOKEN.symbol : symbol} · Max
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 card-2 px-3" style={{ height: 56 }}>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    className="num bg-transparent outline-none flex-1"
                    style={{ fontSize: "var(--t-2xl)", fontWeight: 600 }}
                  />
                  <span className="chip" style={{ height: 28 }}>
                    {isBuy ? QUOTE_TOKEN.symbol : symbol}
                  </span>
                </div>
              </div>

              {/* Route */}
              <div>
                <div className="eyebrow mb-2">Route</div>
                <div className="card-2 p-3 flex flex-col items-center gap-1.5">
                  <RouteNode label={`${isBuy ? QUOTE_TOKEN.symbol : symbol} · Monad`} />
                  <ArrowDown size={14} className="faint" />
                  <RouteNode label={isBuy ? symbol : QUOTE_TOKEN.symbol} accent />
                </div>
              </div>

              {/* Slippage */}
              <div className="flex items-center justify-between">
                <span className="eyebrow">Max slippage</span>
                <div className="flex gap-1">
                  {SLIPPAGE_PRESETS.map((p) => (
                    <button
                      key={p.bps}
                      className="btn btn-sm"
                      onClick={() => setSlippageBps(p.bps)}
                      style={{
                        background: slippageBps === p.bps ? "var(--surface-2)" : "transparent",
                        borderColor: slippageBps === p.bps ? "var(--border)" : "transparent"
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quote */}
              <div className="card-2 p-3 flex flex-col gap-2" style={{ fontSize: "var(--t-sm)" }}>
                <Line label={isBuy ? "You receive" : "You receive (USD)"}>
                  <Num style={{ fontWeight: 600 }}>
                    {quoting ? (
                      "…"
                    ) : quote ? (
                      isBuy ? `${qty(quote.buyAmountToken)} ${symbol}` : money(quote.buyAmountToken)
                    ) : (
                      "—"
                    )}
                  </Num>
                </Line>
                <Line label="Minimum received">
                  <Num className="muted">
                    {quote ? (isBuy ? `${qty(quote.minBuyAmountToken)} ${symbol}` : money(quote.minBuyAmountToken)) : "—"}
                  </Num>
                </Line>
                <Line label="Rate">
                  <Num className="muted">
                    {quote && quote.buyAmountToken > 0
                      ? isBuy
                        ? `${money(quote.sellAmountToken / quote.buyAmountToken)} / ${symbol}`
                        : `${qty(quote.buyAmountToken / quote.sellAmountToken)} ${QUOTE_TOKEN.symbol} / ${symbol}`
                      : "—"}
                  </Num>
                </Line>
                <Line label="Network fee">
                  <Num className="muted">{quote?.networkFeeUsd != null ? money(quote.networkFeeUsd) : "—"}</Num>
                </Line>
                <Line label="Routed by">
                  <Num className="muted">0x</Num>
                </Line>
              </div>

              {quoteError && (
                <div className="chip chip-down" style={{ height: "auto", padding: "6px 10px" }}>
                  {quoteError}
                </div>
              )}
              {error && (
                <div className="chip chip-down" style={{ height: "auto", padding: "6px 10px" }}>
                  {error}
                </div>
              )}

              <button
                className={`btn ${isBuy ? "btn-buy" : "btn-sell"}`}
                style={{ height: 48 }}
                disabled={amountNum <= 0 || !quote || quoting || !address}
                onClick={execute}
              >
                {!address ? "Connect wallet" : !quote ? "Fetching route…" : `${side} ${symbol}`}
              </button>
              <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
                You sign this trade in your own wallet. Fobs never holds your keys or your funds.
              </p>
            </div>
          )}

          {!wrongChain && phase === "executing" && <ExecutingView status={status} quote={quote} symbol={symbol} />}

          {!wrongChain && phase === "done" && result && (
            <DoneView symbol={symbol} side={side} result={result} onClose={onClose} />
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

function RouteNode({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div
      className="num px-3 py-1.5 rounded-md w-full text-center"
      style={{
        background: accent ? "rgba(124,92,255,0.1)" : "var(--surface)",
        border: `1px solid ${accent ? "color-mix(in srgb, var(--primary) 40%, transparent)" : "var(--border)"}`,
        fontWeight: 600
      }}
    >
      {label}
    </div>
  );
}

function ExecutingView({ status, quote, symbol }: { status: SwapStatus; quote: SwapQuoteDTO | null; symbol: string }) {
  const needsApproval = Boolean(quote?.allowanceTarget && !quote?.sellIsNative);
  const stages: { key: SwapStatus; label: string; gated: boolean }[] = [
    ...(needsApproval ? [{ key: "APPROVING" as SwapStatus, label: `Approve ${quote?.sellSymbol ?? ""}`, gated: true }] : []),
    { key: "SIGNING", label: "Sign the swap in your wallet", gated: true },
    { key: "SUBMITTED", label: "Confirming on Monad", gated: false },
    { key: "CONFIRMED", label: "Done", gated: false }
  ];

  // Which stage are we at? SUBMITTED and CONFIRMING share the "Confirming" node.
  const order = stages.map((s) => s.key);
  const currentIdx =
    status === "CONFIRMED"
      ? stages.length
      : status === "CONFIRMING"
        ? order.indexOf("SUBMITTED")
        : order.indexOf(status);

  return (
    <div className="flex flex-col gap-4 pt-6">
      <div className="eyebrow">Executing on Monad</div>
      <div className="flex flex-col gap-3">
        {stages.map((stage, i) => {
          const done = i < currentIdx || status === "CONFIRMED";
          const activeStage = i === currentIdx && status !== "CONFIRMED";
          return (
            <div key={stage.key} className="flex items-center gap-3">
              <span
                className="flex items-center justify-center rounded-full shrink-0"
                style={{
                  width: 24,
                  height: 24,
                  background: done ? "var(--up)" : activeStage ? "var(--surface-2)" : "transparent",
                  border: `1px solid ${done ? "var(--up)" : "var(--border)"}`
                }}
              >
                {done ? (
                  <Check size={14} color="#04120b" />
                ) : activeStage ? (
                  <Loader2 size={13} className="muted" style={{ animation: "spin 1s linear infinite" }} />
                ) : null}
              </span>
              <span style={{ color: done || activeStage ? "var(--ink)" : "var(--faint)", fontWeight: activeStage ? 600 : 400 }}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: "var(--t-xs)" }}>
        Swapping {symbol} through 0x on Monad…
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DoneView({
  symbol,
  side,
  result,
  onClose
}: {
  symbol: string;
  side: Side;
  result: { tradeId: string | null; txHash: string; amountToken: number; amountUsd: number };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" && result.tradeId ? `${window.location.origin}/share/${result.tradeId}` : "";

  const copy = async () => {
    if (!shareUrl) return;
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
        <div className="eyebrow up">Trade confirmed on Monad</div>
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
          {money(result.amountUsd)} <span className="faint">→</span> {compactNumber(result.amountToken)} {symbol}
        </div>
        <a
          href={txUrl(result.txHash)}
          target="_blank"
          rel="noreferrer"
          className="num faint hover:underline inline-flex items-center gap-1"
          style={{ fontSize: "var(--t-xs)" }}
        >
          View transaction on monadscan <ExternalLink size={11} />
        </a>
      </div>

      {!result.tradeId && (
        <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
          The swap is on-chain. It couldn&apos;t be added to the activity feed (database unavailable).
        </p>
      )}

      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" onClick={copy} disabled={!shareUrl}>
          {copied ? <Check size={14} /> : <Share2 size={14} />}
          {copied ? "Link copied" : "Share trade"}
        </button>
        <Link href={"/portfolio" as Route} className="btn flex-1" onClick={onClose}>
          View portfolio
        </Link>
      </div>
      {result.tradeId && (
        <Link href={`/share/${result.tradeId}` as Route} className="btn btn-ghost btn-sm self-center" onClick={onClose}>
          <Copy size={13} /> Open share page
        </Link>
      )}
    </div>
  );
}
