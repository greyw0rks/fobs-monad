"use client";

// Cross-chain funding drawer — gets the user from "USDC on Base" to "MON on
// Monad" without ever handing custody to fobs. The server returns a quote and
// unsigned steps; the user's OWN wallet signs them. Every figure shown comes
// from the server quote or the on-chain balance — nothing here is invented, and
// a null renders "—".
//
// Provider-agnostic: Relay returns origin-chain transactions (approve+deposit),
// Aurora returns a deposit address. Both arrive as `steps`, so this code paths
// through one loop.

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { X, ArrowDown, Check, Loader2, Copy, ExternalLink, ArrowRightLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useAccount, useBalance, useConfig, useSwitchChain } from "wagmi";
import { sendTransaction } from "wagmi/actions";
import type { Address } from "viem";
import { useFobsAddress } from "./connect-wallet-button";
import { qty, txUrl, money } from "@/lib/format";
import { BRIDGE_SOURCES, BRIDGE_DESTINATIONS, bridgeSourceById, type BridgeDestination } from "@/lib/bridge";
import type { BridgeQuoteDTO, BridgeTransferDTO } from "@/lib/types";

type BridgeState = { dest: BridgeDestination } | null;

type Ctx = { openBridge: (dest?: BridgeDestination) => void };
const BridgeCtx = createContext<Ctx>({ openBridge: () => {} });
export const useBridgeDrawer = () => useContext(BridgeCtx);

export function BridgeDrawerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BridgeState>(null);
  const openBridge = useCallback((dest: BridgeDestination = "MON") => setState({ dest }), []);
  const close = useCallback(() => setState(null), []);

  return (
    <BridgeCtx.Provider value={{ openBridge }}>
      {children}
      <AnimatePresence>
        {state && <BridgeDrawer key={state.dest} initialDest={state.dest} onClose={close} />}
      </AnimatePresence>
    </BridgeCtx.Provider>
  );
}

type Phase = "form" | "sending" | "tracking";

const STATUS_LABEL: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen — waiting for confirmation",
  PROCESSING: "Delivering on Monad",
  SUCCESS: "Delivered on Monad",
  INCOMPLETE_DEPOSIT: "Deposit was under the quoted amount",
  REFUNDED: "Refunded to your source wallet",
  FAILED: "Failed",
  // Relay reports lowercase statuses
  pending: "Delivering on Monad",
  unknown: "Waiting for your deposit",
  success: "Delivered on Monad",
  failure: "Failed",
  refunded: "Refunded to your source wallet"
};
const TERMINAL = new Set(["SUCCESS", "FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT", "success", "failure", "refunded"]);

function BridgeDrawer({ initialDest, onClose }: { initialDest: BridgeDestination; onClose: () => void }) {
  const address = useFobsAddress();
  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const config = useConfig();

  const [sourceId, setSourceId] = useState<number>(BRIDGE_SOURCES[0].id);
  const [dest, setDest] = useState<BridgeDestination>(initialDest);
  const [amount, setAmount] = useState("");
  const [slippageBps] = useState(100);

  const [quote, setQuote] = useState<BridgeQuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("form");
  const [transfer, setTransfer] = useState<BridgeTransferDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originTxHash, setOriginTxHash] = useState<string | null>(null);
  const [recordNote, setRecordNote] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);

  const source = bridgeSourceById(sourceId) ?? BRIDGE_SOURCES[0];
  const amountNum = Number(amount) || 0;

  const { data: balance } = useBalance({
    address: address as Address | undefined,
    token: source.address as Address,
    chainId: source.id,
    query: { enabled: Boolean(address) }
  });
  const available = balance ? Number(balance.formatted) : null;

  // Debounced quote against the real bridge API.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!address || amountNum <= 0) return;
    let live = true;
    const id = setTimeout(async () => {
      setQuoting(true);
      try {
        const r = await fetch("/api/bridge/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: source.id, destSymbol: dest, amount, recipient: address, slippageBps })
        });
        const d = await r.json();
        if (!live) return;
        if (!r.ok) setQuoteError(d.error ?? "Quote failed");
        else setQuote(d.quote);
      } catch {
        if (live) setQuoteError("Could not reach the bridge service");
      } finally {
        if (live) setQuoting(false);
      }
    }, 350);
    return () => { live = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, dest, amount, amountNum, address]);

  async function send() {
    if (!address || !quote) return;
    setError(null);
    setPhase("sending");
    try {
      // The deposit is the step that carries the value. An approve often precedes
      // it as a separate transaction and must not be mistaken for the funding tx.
      let lastHash: `0x${string}` | null = null;
      let depositHash: `0x${string}` | null = null;
      for (const step of quote.steps) {
        if (step.kind !== "transaction") {
          throw new Error(`This route needs a "${step.kind}" signature, which isn't supported in this build`);
        }
        if (chainId !== step.chainId) await switchChain({ chainId: step.chainId });
        const hash = await sendTransaction(config, {
          to: step.to as Address,
          data: step.data as `0x${string}`,
          value: BigInt(step.value || "0"),
          account: address as Address,
          chainId: step.chainId
        });
        lastHash = hash;
        if (step.label.trim().toLowerCase().startsWith("send")) depositHash = hash;
      }
      if (!active.current) return;
      setOriginTxHash(depositHash ?? lastHash);
      setPhase("tracking");
      setTransfer({
        depositAddress: quote.depositAddress,
        status: quote.provider === "relay" ? "unknown" : "PENDING_DEPOSIT",
        destinationTxHashes: [],
        amountInFormatted: qty(amountNum),
        amountOutFormatted: null,
        createdAt: new Date().toISOString(),
        refundReason: null
      });
    } catch (e) {
      if (!active.current) return;
      setError((e instanceof Error ? e.message : "Deposit failed").split("\n")[0]);
      setPhase("form");
    }
  }

  // Poll the provider for the transfer's real status until it reaches a terminal one.
  useEffect(() => {
    if (phase !== "tracking" || !quote) return;
    const qs =
      quote.provider === "relay"
        ? `provider=relay&requestId=${quote.requestId}`
        : `provider=aurora&address=${address}&deposit=${quote.depositAddress}`;
    if (quote.provider === "relay" && !quote.requestId) return;

    let live = true;
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      try {
        const r = await fetch(`/api/bridge/status?${qs}`);
        const d = await r.json();
        if (!live || !r.ok) return;
        const found: BridgeTransferDTO | undefined = (d.transfers ?? [])[0];
        if (found) {
          setTransfer((prev) => ({ ...(prev ?? found), ...found }));
          if (TERMINAL.has(found.status) && id) clearInterval(id);
        }
      } catch {
        /* transient — keep polling */
      }
    };
    tick();
    id = setInterval(tick, 6000);
    return () => { live = false; if (id) clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, address, quote?.provider, quote?.requestId, quote?.depositAddress]);

  // Once the bridge reports success, ask the server to record it as a
  // CROSS_CHAIN trade. The server re-verifies both legs on-chain and reads the
  // destination tx from Relay itself — nothing here is trusted. Safe to fire
  // more than once: the route is idempotent on the destination tx hash.
  const delivered = transfer?.status === "SUCCESS" || transfer?.status === "success";
  useEffect(() => {
    if (!delivered || phase !== "tracking") return;
    if (!address || !originTxHash || quote?.provider !== "relay" || !quote.requestId) return;

    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/bridge/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address,
            originChainId: quote.sourceId,
            originTxHash,
            requestId: quote.requestId,
            destinationSymbol: quote.destSymbol
          })
        });
        const d = await r.json();
        if (!live || !active.current) return;
        if (r.ok && d.recorded) setRecordNote(d.alreadyRecorded ? "Already in your feed" : "Added to your feed");
        else if (r.ok && d.recorded === false) setRecordNote(d.reason ?? null);
        // A failed recording is deliberately quiet: the funds arrived regardless,
        // and only the feed entry is missing.
      } catch {
        /* as above — delivery is unaffected */
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivered, phase, address, originTxHash, quote?.provider, quote?.requestId, quote?.sourceId, quote?.destSymbol]);

  const onSourceChain = chainId === source.id;

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
        <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b hairline">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="muted" />
            <span style={{ fontWeight: 700, fontSize: "var(--t-lg)" }}>Fund from another chain</span>
          </div>
          <button className="btn-ghost btn btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Source */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="eyebrow">You send</span>
                {available != null && (
                  <button
                    className="faint"
                    style={{ fontSize: "var(--t-xs)" }}
                    onClick={() => setAmount(String(Math.floor(available * 100) / 100))}
                  >
                    Available {qty(available)} {source.symbol} · Max
                  </button>
                )}
              </div>
              <div className="card-2 p-3 flex flex-col gap-2">
                <input
                  inputMode="decimal"
                  value={amount}
                  disabled={phase !== "form"}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  className="num bg-transparent outline-none w-full"
                  style={{ fontSize: "var(--t-2xl)", fontWeight: 600 }}
                />
                <div className="flex gap-1 flex-wrap">
                  {BRIDGE_SOURCES.map((s) => (
                    <button
                      key={s.id}
                      className="btn btn-sm"
                      disabled={phase !== "form"}
                      onClick={() => setSourceId(s.id)}
                      style={{
                        background: source.id === s.id ? "var(--surface-2)" : "transparent",
                        borderColor: source.id === s.id ? "var(--border)" : "transparent"
                      }}
                    >
                      {s.symbol} · {s.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <ArrowDown size={14} className="faint" />
            </div>

            {/* Destination */}
            <div>
              <div className="eyebrow mb-2">You receive on Monad</div>
              <div className="flex gap-1">
                {BRIDGE_DESTINATIONS.map((d) => (
                  <button
                    key={d}
                    className="btn btn-sm"
                    disabled={phase !== "form"}
                    onClick={() => setDest(d)}
                    style={{
                      background: dest === d ? "var(--surface-2)" : "transparent",
                      borderColor: dest === d ? "var(--border)" : "transparent"
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Quote */}
            <div className="card-2 p-3 flex flex-col gap-2" style={{ fontSize: "var(--t-sm)" }}>
              <Line label="You receive">
                <span className="num" style={{ fontWeight: 600 }}>
                  {quoting ? "…" : quote ? `${qty(quote.amountOutToken)} ${quote.destSymbol}` : "—"}
                </span>
              </Line>
              <Line label="Value in">
                <span className="num muted">{quote?.amountInUsd != null ? money(quote.amountInUsd) : "—"}</span>
              </Line>
              <Line label="Est. time">
                <span className="num muted">
                  {quote?.timeEstimateSec != null ? `~${Math.max(1, Math.ceil(quote.timeEstimateSec / 60))} min` : "—"}
                </span>
              </Line>
              <Line label="Route">
                <span className="num muted">{quote ? (quote.provider === "relay" ? "Relay" : "Aurora Intents") : "—"}</span>
              </Line>
            </div>

            {quoteError && <div className="chip chip-down" style={{ height: "auto", padding: "6px 10px" }}>{quoteError}</div>}
            {error && <div className="chip chip-down" style={{ height: "auto", padding: "6px 10px" }}>{error}</div>}

            {/* What the wallet will do / where to send */}
            {quote && phase === "form" && (
              <div className="card-2 p-3 flex flex-col gap-2">
                <span className="eyebrow">
                  {quote.provider === "relay" ? "Your wallet will" : `Send to this address on ${quote.sourceName}`}
                </span>
                {quote.provider === "relay" ? (
                  quote.steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2" style={{ fontSize: "var(--t-xs)" }}>
                      <span className="num muted">{i + 1}.</span>
                      <span>{s.label}</span>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="num flex-1 truncate" style={{ fontSize: "var(--t-xs)" }}>
                        {quote.depositAddress}
                      </span>
                      <CopyButton value={quote.depositAddress ?? ""} />
                    </div>
                    {quote.depositMemo && (
                      <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                        Memo required: <span className="num">{quote.depositMemo}</span>
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            {phase === "tracking" && transfer && <TrackingView transfer={transfer} dest={dest} />}
            {recordNote && (
              <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
                {recordNote}
              </p>
            )}

            {phase === "form" && (
              <>
                <button
                  className="btn btn-primary"
                  style={{ height: 48 }}
                  disabled={!address || !quote || quoting || amountNum <= 0}
                  onClick={send}
                >
                  {!address
                    ? "Connect wallet"
                    : !quote
                      ? "Fetching route…"
                      : `Send ${amountNum || ""} ${source.symbol} from wallet`}
                </button>
                {!onSourceChain && address && (
                  <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
                    Your wallet will ask to switch to {source.name} to sign.
                  </p>
                )}
                <p className="faint text-center" style={{ fontSize: "var(--t-xs)" }}>
                  You sign from your own wallet. Fobs never holds your keys or your funds.
                </p>
              </>
            )}
          </div>
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? <Check size={13} className="up" /> : <Copy size={13} />}
    </button>
  );
}

function TrackingView({ transfer, dest }: { transfer: BridgeTransferDTO; dest: BridgeDestination }) {
  const done = transfer.status === "SUCCESS" || transfer.status === "success";
  const failed = ["FAILED", "failure", "REFUNDED", "refunded", "INCOMPLETE_DEPOSIT"].includes(transfer.status);
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center gap-3">
        <span
          className="flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 24,
            height: 24,
            background: done ? "var(--up)" : "var(--surface-2)",
            border: `1px solid ${done ? "var(--up)" : failed ? "var(--down, var(--border))" : "var(--border)"}`
          }}
        >
          {done ? (
            <Check size={14} color="#04120b" />
          ) : failed ? (
            <X size={13} className="down" />
          ) : (
            <Loader2 size={13} className="muted" style={{ animation: "spin 1s linear infinite" }} />
          )}
        </span>
        <div className="flex flex-col">
          <span style={{ fontWeight: 600 }}>{STATUS_LABEL[transfer.status] ?? transfer.status}</span>
          <span className="faint num" style={{ fontSize: "var(--t-xs)" }}>
            {transfer.status}
          </span>
        </div>
      </div>

      {transfer.amountOutFormatted && (
        <Line label="Received">
          <span className="num">
            {transfer.amountOutFormatted} {dest}
          </span>
        </Line>
      )}
      {transfer.refundReason && (
        <p className="faint" style={{ fontSize: "var(--t-xs)" }}>
          Refund reason: {transfer.refundReason}
        </p>
      )}
      {transfer.destinationTxHashes[0] && (
        <a
          href={txUrl(transfer.destinationTxHashes[0])}
          target="_blank"
          rel="noreferrer"
          className="num faint hover:underline inline-flex items-center gap-1"
          style={{ fontSize: "var(--t-xs)" }}
        >
          View on monadscan <ExternalLink size={11} />
        </a>
      )}
      <p className="faint" style={{ fontSize: "var(--t-xs)" }}>
        {done ? "Your funds are on Monad." : "You can close this — delivery continues on its own."}
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
