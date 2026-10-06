// Kuru Flow client — Kuru's HTTP routing API for Monad (the primary venue).
// Server-only: it only ever REQUESTS calldata; the user's wallet signs it.
//
// Flow (docs.monad.xyz/guides/kuru-flow):
//   1. POST /api/generate-token { user_address } -> { token, expires_at, ... }  (JWT)
//   2. POST /api/quote  Authorization: Bearer <token>
//        body { userAddress, tokenIn, tokenOut, amount, slippageTolerance, ... }
//        -> { status, output, minOut, transaction: { to, calldata, value }, ... }
//
// Two Monad-specific quirks this module owns:
//   - Native MON is the ZERO address here (0x0), NOT the 0x sentinel the rest of
//     the app uses for 0x routing.
//   - `calldata` comes back WITHOUT the 0x prefix; we re-add it.
// ERC20 sells need an approve to `transaction.to` (the router); native MON does
// not. `value` must equal the amount for a native sell.

import "server-only";
import { fetchWithRetry } from "./http";
import { type TokenMeta } from "./registry";
import type { VenueQuote } from "./venue";

const BASE = process.env.KURU_FLOW_URL ?? "https://ws.kuru.io";

export class KuruError extends Error {}

/** Kuru's native sentinel — the zero address, distinct from the 0x sentinel. */
const KURU_NATIVE = "0x0000000000000000000000000000000000000000" as const;

function kuruAddress(t: TokenMeta): string {
  return t.isNative ? KURU_NATIVE : t.address;
}

// ── JWT cache ────────────────────────────────────────────────────────────────
// One token per wallet, refreshed a few seconds before it expires. Keys are
// keyed by lowercased address, so a wallet with two tabs shares one token.
type TokenEntry = { token: string; expiresAtMs: number };
const tokenCache = new Map<string, TokenEntry>();

/** expires_at may be seconds or milliseconds; normalise to ms. 0/NaN → short. */
function toMs(expiresAt: unknown): number {
  const n = Number(expiresAt);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

async function generateToken(userAddress: string): Promise<string> {
  const res = await fetchWithRetry(`${BASE}/api/generate-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_address: userAddress }),
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  const token = json?.token;
  if (!res.ok || typeof token !== "string" || token.length === 0) {
    throw new KuruError(json?.message ?? `Kuru auth failed (${res.status})`);
  }
  tokenCache.set(userAddress.toLowerCase(), { token, expiresAtMs: toMs(json?.expires_at) });
  return token;
}

async function getToken(userAddress: string): Promise<string> {
  const hit = tokenCache.get(userAddress.toLowerCase());
  if (hit && hit.expiresAtMs - Date.now() > 5_000) return hit.token;
  return generateToken(userAddress);
}

function requestQuote(body: unknown, token: string): Promise<Response> {
  return fetchWithRetry(`${BASE}/api/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store"
  });
}

export type KuruQuoteParams = {
  sell: TokenMeta;
  buy: TokenMeta;
  sellAmount: string; // base units of `sell`
  taker: `0x${string}`;
  slippageBps: number;
};

/** Route a swap through Kuru Flow. Throws KuruError when no route is available. */
export async function getKuruQuote(params: KuruQuoteParams): Promise<VenueQuote> {
  const { sell, buy, sellAmount, taker, slippageBps } = params;
  const body = {
    userAddress: taker,
    tokenIn: kuruAddress(sell),
    tokenOut: kuruAddress(buy),
    amount: sellAmount,
    // Kuru accepts either autoSlippage or an explicit tolerance (1–10000 bps).
    slippageTolerance: Math.max(1, Math.min(10_000, Math.round(slippageBps)))
  };

  let res = await requestQuote(body, await getToken(taker));
  if (res.status === 401) {
    // Stale/revoked token — drop it and retry once with a fresh one.
    tokenCache.delete(taker.toLowerCase());
    res = await requestQuote(body, await getToken(taker));
  }
  if (res.status === 429) throw new KuruError("Kuru is rate-limiting requests; try again shortly");

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "success" || !json?.transaction?.to) {
    throw new KuruError(json?.message ?? `Kuru quote failed (${res.status})`);
  }

  const raw = String(json.transaction.calldata ?? "");
  return {
    sellAmount,
    buyAmount: String(json.output ?? "0"),
    minBuyAmount: String(json.minOut ?? json.output ?? "0"),
    // Kuru returns gas *prices*, not a MON fee — leave null rather than invent one.
    totalNetworkFee: null,
    transaction: {
      to: json.transaction.to as `0x${string}`,
      data: (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`,
      value: String(json.transaction.value ?? "0"),
      gas: null
    },
    allowanceTarget: sell.isNative ? null : (json.transaction.to as `0x${string}`),
    allowanceNeeded: sell.isNative ? null : sellAmount
  };
}
