// Nansen labels — wallet labels and smart-money signals, behind an honest
// adapter. Server-only, and NEVER invents a label: without NANSEN_API_KEY (or
// when Nansen does not answer / does not cover Monad) every reader returns
// `null`, which callers render as nothing at all.
//
// This is deliberately thin. Nansen's exact response shapes and its Monad
// coverage are to be confirmed on the first live call; because a wrong shape
// degrades to `null` rather than to a fabricated chip, that confirmation is
// safe to do in production. Results are cached briefly — labels change slowly.

import "server-only";
import { fetchWithRetry } from "./http";

const BASE = process.env.NANSEN_API_BASE ?? "https://api.nansen.ai";
const TTL_MS = 5 * 60_000;

/** True when a key is present — i.e. labels *might* load. Says nothing about Monad coverage. */
export function nansenConfigured(): boolean {
  return Boolean(process.env.NANSEN_API_KEY);
}

export type WalletLabels = {
  address: string;
  labels: string[]; // human-readable label names, e.g. "Smart Trader", "Fund"
  smartMoney: boolean; // any label identifying a smart-money cohort
};

export type TokenSmartMoney = {
  tokenAddress: string;
  holders: number; // distinct smart-money wallets holding the token
  netflowUsd: number; // net smart-money flow, USD (0 when Nansen reports none)
};

const cache = new Map<string, { at: number; value: unknown }>();

async function nansenPost<T>(path: string, body: unknown): Promise<T | null> {
  const key = process.env.NANSEN_API_KEY;
  if (!key) return null; // not configured — honest-empty, never a fake label
  try {
    const res = await fetchWithRetry(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (!res.ok) {
      console.error("[nansen]", path, res.status);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error("[nansen] fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Pull label strings out of Nansen's response without assuming one exact shape. */
function extractLabels(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data as
    | { labels?: unknown; list?: unknown }
    | unknown[]
    | undefined;
  const raw: unknown[] = Array.isArray(data)
    ? data
    : ((data?.labels ?? data?.list ?? []) as unknown[]);
  if (!Array.isArray(raw)) return [];
  const out = raw
    .map((r) => (typeof r === "string" ? r : ((r as { label?: string; name?: string })?.label ?? (r as { name?: string })?.name)))
    .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length < 48);
  return [...new Set(out)];
}

/** Labels for a wallet, or null when unconfigured / unavailable. */
export async function getWalletLabels(address: string): Promise<WalletLabels | null> {
  const key = `labels:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as WalletLabels;

  const json = await nansenPost<unknown>("/api/v1/profiler/address/premium-labels", {
    address: address.toLowerCase(),
    chain: "monad"
  });
  if (!json) return null;

  const labels = extractLabels(json);
  const value: WalletLabels = {
    address: address.toLowerCase(),
    labels,
    smartMoney: labels.some((l) => /smart|fund|whale/i.test(l))
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Smart-money activity on a token, or null when unconfigured / unavailable. */
export async function getTokenSmartMoney(tokenAddress: string): Promise<TokenSmartMoney | null> {
  const key = `smart:${tokenAddress.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as TokenSmartMoney;

  const json = await nansenPost<{ data?: unknown[] }>("/api/v1/smart-money/holdings", {
    token_address: tokenAddress.toLowerCase(),
    chain: "monad"
  });
  if (!json) return null;

  const rows = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
  const wallets = new Set<string>();
  let netflowUsd = 0;
  for (const r of rows) {
    const w = (r.wallet_address ?? r.address ?? r.wallet) as string | undefined;
    if (w) wallets.add(w.toLowerCase());
    const nf = Number(r.net_flow_usd ?? r.netflow ?? r.net_flow ?? 0);
    if (Number.isFinite(nf)) netflowUsd += nf;
  }

  const value: TokenSmartMoney = { tokenAddress: tokenAddress.toLowerCase(), holders: wallets.size, netflowUsd };
  cache.set(key, { at: Date.now(), value });
  return value;
}
