// Aurora Intents — cross-chain funding INTO Monad (the same 1Click / NEAR-Intents
// stack). Server-only: the appKey is a path segment and never reaches the client,
// and this module only READS — it fetches a deposit address and reads transfer
// status. It never signs and never holds funds: the user sends from their own
// wallet on the source chain (see bridge-drawer.tsx), so custody never moves.
//
// Host:  https://intents-api.aurora.dev          (env AURORA_INTENTS_API_URL)
// Auth:  appKey is a PATH SEGMENT, not a header:  /api/<op>/<appKey>
//   GET  /api/tokens/<appKey>                          -> { tokens: [...] }
//   POST /api/quote/<appKey>                           -> { depositAddress, ... }
//   GET  /api/transactions/<appKey>?walletAddress=0x.. -> { data: [...] }
// Docs: docs.intents.aurora.dev/intents-deposits/quickstart/api-integration
//
// Monad assets are HOT-Bridge `nep245:` ids prefixed with the chain id (`143_`).
// Two doc inconsistencies are absorbed here rather than by callers: the quote
// body may be flat or nested under `quote`, and list endpoints flip between
// `tokens`/`data`. Asset ids are NEVER hard-coded — they are resolved live from
// the token list, because a wrong id would route a real deposit nowhere.

import "server-only";
import { fetchWithRetry } from "./http";

const BASE = process.env.AURORA_INTENTS_API_URL ?? "https://intents-api.aurora.dev";

export class AuroraError extends Error {}

/** True when the app can route cross-chain funding (appKey present). */
export function auroraConfigured(): boolean {
  return Boolean(process.env.AURORA_INTENTS_API_KEY);
}

function appKey(): string {
  const k = process.env.AURORA_INTENTS_API_KEY;
  if (!k) throw new AuroraError("Cross-chain funding is not configured (missing AURORA_INTENTS_API_KEY)");
  return k;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

export type AuroraAsset = {
  assetId: string;
  blockchain: string; // lowercase chain key: eth | base | arb | monad | …
  symbol: string;
  decimals: number;
  contractAddress: string | null;
};

// ── Asset list (cached) ──────────────────────────────────────────────────────
// The list is large and changes slowly; a 10-minute cache keeps the drawer snappy
// without ever serving a stale price (prices come from lib/market.ts, not here).
let assetCache: { at: number; assets: AuroraAsset[] } | null = null;
const ASSET_TTL_MS = 10 * 60 * 1000;

export async function getAuroraAssets(): Promise<AuroraAsset[]> {
  if (assetCache && Date.now() - assetCache.at < ASSET_TTL_MS) return assetCache.assets;

  const res = await fetchWithRetry(`${BASE}/api/tokens/${appKey()}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  // `{tokens:[…]}` per the docs; tolerate a bare array / `data` too.
  const list = Array.isArray(json) ? json : (json?.tokens ?? json?.data);
  if (!res.ok || !Array.isArray(list)) {
    throw new AuroraError(json?.message ?? `Aurora token list failed (${res.status})`);
  }

  const assets: AuroraAsset[] = list
    .map((t: Record<string, unknown>) => ({
      assetId: String(t.assetId ?? t.asset_id ?? ""),
      blockchain: String(t.blockchain ?? "").toLowerCase(),
      symbol: String(t.symbol ?? ""),
      decimals: Number(t.decimals ?? 0),
      contractAddress: t.contractAddress != null ? String(t.contractAddress) : null
    }))
    .filter((t: AuroraAsset) => t.assetId.length > 0 && t.blockchain.length > 0);

  assetCache = { at: Date.now(), assets };
  return assets;
}

/** Resolve one asset by chain key + symbol, or null when Aurora doesn't list it. */
export async function findAuroraAsset(blockchain: string, symbol: string): Promise<AuroraAsset | null> {
  const assets = await getAuroraAssets();
  const b = blockchain.toLowerCase();
  const s = symbol.toUpperCase();
  return assets.find((a) => a.blockchain === b && a.symbol.toUpperCase() === s) ?? null;
}

/** Monad destination assets Aurora can deliver (for the "receive as" picker). */
export async function getMonadAssets(): Promise<AuroraAsset[]> {
  const assets = await getAuroraAssets();
  return assets.filter((a) => a.blockchain === "monad");
}

export type AuroraQuoteParams = {
  originAsset: string;
  destinationAsset: string;
  amount: string; // base units of the origin asset
  recipient: `0x${string}`; // Monad address to receive on
  refundTo: `0x${string}`; // source-chain address refunded on failure
  slippageBps: number;
  deadlineSeconds?: number;
};

/**
 * A quote plus the deposit address the user must send to. NOT marked `dry`: a
 * dry quote validates without creating a deposit address, which is the whole
 * point of the call. Nothing is executed until the user actually sends funds.
 */
export type AuroraQuote = {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string; // base units
  amountOut: string; // base units, expected
  amountInUsd: number | null;
  amountOutUsd: number | null;
  deadline: string | null;
  originAsset: string;
  destinationAsset: string;
  timeEstimateSec: number | null;
};

export async function getAuroraQuote(params: AuroraQuoteParams): Promise<AuroraQuote> {
  const deadline = new Date(Date.now() + (params.deadlineSeconds ?? 1800) * 1000).toISOString();
  const body = {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: Math.max(1, Math.min(10_000, Math.round(params.slippageBps))),
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    recipient: params.recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: params.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline
  };

  const res = await fetchWithRetry(`${BASE}/api/quote/${appKey()}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  // Flat or nested — the docs show both; accept either.
  const q = json?.quote ?? json;
  const depositAddress = q?.depositAddress ?? q?.deposit_address;
  if (!res.ok || !depositAddress) {
    throw new AuroraError(json?.message ?? q?.message ?? `Aurora quote failed (${res.status})`);
  }

  return {
    depositAddress: String(depositAddress),
    depositMemo: strOrNull(q?.depositMemo ?? q?.deposit_memo),
    amountIn: String(q?.amountIn ?? params.amount),
    amountOut: String(q?.amountOut ?? "0"),
    amountInUsd: numOrNull(q?.amountInUsd),
    amountOutUsd: numOrNull(q?.amountOutUsd),
    deadline: strOrNull(q?.deadline) ?? deadline,
    originAsset: String(q?.originAsset ?? params.originAsset),
    destinationAsset: String(q?.destinationAsset ?? params.destinationAsset),
    timeEstimateSec: numOrNull(q?.timeEstimate)
  };
}

export type AuroraTransfer = {
  depositAddress: string | null;
  status: string;
  originAsset: string | null;
  destinationAsset: string | null;
  amountInFormatted: string | null;
  amountOutFormatted: string | null;
  destinationTxHashes: string[];
  createdAt: string | null;
  refundReason: string | null;
};

/**
 * Transfers for a wallet. Aurora indexes by the ORIGIN wallet; the drawer then
 * matches on `depositAddress` to track the one it created. Status is one of
 * PENDING_DEPOSIT | KNOWN_DEPOSIT_TX | PROCESSING | SUCCESS | INCOMPLETE_DEPOSIT
 * | REFUNDED | FAILED — passed through verbatim, never reinterpreted.
 */
export async function getAuroraTransfers(walletAddress: string): Promise<AuroraTransfer[]> {
  const url = `${BASE}/api/transactions/${appKey()}?walletAddress=${encodeURIComponent(walletAddress)}`;
  const res = await fetchWithRetry(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const json = await res.json().catch(() => null);
  // Aurora returns a BARE ARRAY here (verified live), but the docs show a
  // wrapped object — accept both rather than guess which deploy is which.
  const list = Array.isArray(json) ? json : (json?.data ?? json?.transactions);
  if (!res.ok || !Array.isArray(list)) {
    throw new AuroraError(json?.message ?? `Aurora transfers failed (${res.status})`);
  }

  return list.map((t: Record<string, unknown>) => ({
    depositAddress: strOrNull(t.depositAddress),
    status: String(t.status ?? "UNKNOWN"),
    originAsset: strOrNull(t.originAsset),
    destinationAsset: strOrNull(t.destinationAsset),
    amountInFormatted: strOrNull(t.amountInFormatted),
    amountOutFormatted: strOrNull(t.amountOutFormatted),
    destinationTxHashes: Array.isArray(t.destinationChainTxHashes)
      ? (t.destinationChainTxHashes as unknown[]).map(String)
      : [],
    createdAt: strOrNull(t.createdAt),
    refundReason: strOrNull(t.refundReason)
  }));
}
