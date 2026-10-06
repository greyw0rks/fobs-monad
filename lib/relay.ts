// Relay client — the bridge that actually delivers to Monad. Server-only, keyless
// (no API key to leak), and it only ever REQUESTS calldata: the returned steps are
// transactions the user signs in their own wallet. No custody at any point.
//
// Docs: docs.relay.link/references/api
//   POST /quote                    -> { requestId, steps[], details, fees }
//   GET  /intents/status?requestId -> { status }
//
// A quote returns up to two origin-chain transactions: an optional ERC20
// `approve` (only when the current allowance is short — Relay omits it
// otherwise) and the `deposit` that moves funds to the relayer. `details`
// carries the real in/out amounts; we read them from there rather than
// recomputing anything.
//
// Chains use EIP-155 ids (Monad = 143) and the NATIVE sentinel is the ZERO
// address, matching lib/bridge.ts.

import "server-only";
import { fetchWithRetry } from "./http";
import { MONAD_CHAIN_ID } from "./chain";
import type { BridgeSource } from "./bridge";

const BASE = process.env.RELAY_API_URL ?? "https://api.relay.link";

export class RelayError extends Error {}

export type RelayStep = {
  label: string;
  kind: string; // "transaction" (signable) | others (not handled by the drawer)
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
};

export type RelayQuote = {
  requestId: string;
  steps: RelayStep[];
  amountIn: string;
  amountOut: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOut: string;
  amountInUsd: number | null;
  amountOutUsd: number | null;
  timeEstimateSec: number | null;
};

export type RelayQuoteParams = {
  source: BridgeSource;
  destAddress: `0x${string}`; // token contract on Monad (zero address for native MON)
  destSymbol: string;
  amount: string; // base units of the source token
  recipient: `0x${string}`; // Monad address to receive on (also the refund target)
  slippageBps: number;
};

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getRelayQuote(params: RelayQuoteParams): Promise<RelayQuote> {
  const body = {
    user: params.recipient,
    recipient: params.recipient,
    originChainId: params.source.id,
    destinationChainId: MONAD_CHAIN_ID,
    originCurrency: params.source.address,
    destinationCurrency: params.destAddress,
    tradeType: "EXACT_INPUT",
    amount: params.amount,
    slippageTolerance: String(Math.max(1, Math.min(10_000, Math.round(params.slippageBps))))
  };

  const res = await fetchWithRetry(`${BASE}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.requestId) {
    throw new RelayError(json?.message ?? json?.error ?? `Relay quote failed (${res.status})`);
  }

  // Flatten steps -> the transactions the wallet must sign. Items Relay already
  // considers complete are dropped; non-transaction steps are KEPT (with their
  // kind) so the UI can say so rather than silently skip a required signature.
  const steps: RelayStep[] = [];
  for (const step of json.steps ?? []) {
    for (const item of step?.items ?? []) {
      if (item?.status === "complete") continue;
      const data = item?.data;
      if (!data?.to) continue;
      steps.push({
        label: step.id === "approve" ? `Approve ${params.source.symbol}` : `Send ${params.source.symbol}`,
        kind: String(step.kind ?? "transaction"),
        to: data.to as `0x${string}`,
        data: (data.data ?? "0x") as `0x${string}`,
        value: String(data.value ?? "0"),
        chainId: Number(data.chainId ?? params.source.id)
      });
    }
  }
  if (steps.length === 0) throw new RelayError("Relay returned no executable steps for this route");

  const det = json.details ?? {};
  const cin = det.currencyIn ?? {};
  const cout = det.currencyOut ?? {};

  return {
    requestId: String(json.requestId),
    steps,
    amountIn: String(cin.amount ?? params.amount),
    amountOut: String(cout.amount ?? "0"),
    amountInFormatted: String(cin.amountFormatted ?? ""),
    amountOutFormatted: String(cout.amountFormatted ?? ""),
    minAmountOut: String(cout.minimumAmount ?? cout.amount ?? "0"),
    amountInUsd: numOrNull(cin.amountUsd),
    amountOutUsd: numOrNull(cout.amountUsd),
    timeEstimateSec: numOrNull(det.timeEstimate)
  };
}

export type RelayStatus = {
  status: string; // unknown | pending | success | failure | refunded | …
  destinationTxHashes: string[];
  refundReason: string | null;
};

/** Relay's status for a request. Read verbatim — never upgraded to "success". */
export async function getRelayStatus(requestId: string): Promise<RelayStatus> {
  const res = await fetchWithRetry(`${BASE}/intents/status?requestId=${encodeURIComponent(requestId)}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new RelayError(json?.message ?? `Relay status failed (${res.status})`);

  const hashes = [
    ...(Array.isArray(json?.destinationChainTxHashes) ? json.destinationChainTxHashes : []),
    ...(Array.isArray(json?.txHashes) ? json.txHashes : [])
  ].map(String);

  return {
    status: String(json?.status ?? "unknown"),
    destinationTxHashes: hashes,
    refundReason: json?.refundReason != null ? String(json.refundReason) : null
  };
}
