// Live market data — the real price / volume / mcap / 24h-change / liquidity for
// registry tokens, plus the OHLCV series behind the price chart.
//
// Prices are NEVER seeded or stored; they are fetched live at request time and
// merged over token identity. Provider is GeckoTerminal's keyless public API
// (Monad network slug "monad"), isolated behind this module so swapping to
// 1inch/Codex later is a one-file change. Results are cached in-memory with a
// short TTL to stay under the public rate limit without ever showing a stale
// number as "live".

import { REGISTRY, bySymbol, priceAddress, type TokenMeta } from "./registry";
import { fetchWithRetry } from "./http";

const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK = "monad";
const TTL_MS = 20_000;
const OHLCV_TTL_MS = 60_000;

export type MarketData = {
  priceUsd: number | null;
  change24h: number;
  volume24h: number;
  marketCap: number | null;
  liquidity: number | null;
  /** GeckoTerminal pool id of the token's deepest pool, e.g. "monad_0xabc". */
  poolId: string | null;
};

type CacheEntry = { at: number; data: Map<string, MarketData> };
const cache = new Map<string, CacheEntry>();
const ohlcvCache = new Map<string, { at: number; series: Candle[] }>();

export type Candle = { t: number; price: number };

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Fetch market data for a set of ERC20 addresses, keyed by lowercased address. */
async function fetchByAddress(addresses: string[]): Promise<Map<string, MarketData>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  if (uniq.length === 0) return new Map();
  const key = uniq.join(",");

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const out = new Map<string, MarketData>();
  let ok = false;
  try {
    const url = `${GECKO_BASE}/networks/${NETWORK}/tokens/multi/${uniq.join(",")}?include=top_pools`;
    const res = await fetchWithRetry(url, {
      headers: { accept: "application/json" },
      cache: "no-store" // the in-memory TTL above is the single cache
    });
    if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
    const json = await res.json();

    // Pool id → h24 change, so each token can borrow its top pool's 24h move.
    const poolChange = new Map<string, number>();
    for (const inc of json.included ?? []) {
      if (inc.type !== "pool") continue;
      poolChange.set(inc.id, num(inc.attributes?.price_change_percentage?.h24));
    }

    for (const t of json.data ?? []) {
      const addr = String(t.attributes?.address ?? "").toLowerCase();
      if (!addr) continue;
      const topPoolId = (t.relationships?.top_pools?.data?.[0]?.id as string | undefined) ?? null;
      out.set(addr, {
        priceUsd: numOrNull(t.attributes?.price_usd),
        change24h: topPoolId ? poolChange.get(topPoolId) ?? 0 : 0,
        volume24h: num(t.attributes?.volume_usd?.h24),
        marketCap: numOrNull(t.attributes?.market_cap_usd) ?? numOrNull(t.attributes?.fdv_usd),
        liquidity: numOrNull(t.attributes?.total_reserve_in_usd),
        poolId: topPoolId
      });
    }
    ok = true;
  } catch (err) {
    // Log the underlying cause too: "fetch failed" alone says nothing, while
    // ETIMEDOUT vs ENOTFOUND vs a TLS error is the whole diagnosis.
    const cause = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined;
    console.error(
      "[market] fetch failed:",
      err instanceof Error ? err.message : err,
      cause ? `(${cause})` : ""
    );
    // Degrade honestly: callers render "—" for a null price, never a fake one.
  }

  // Only a successful read is cached. Caching the failure would pin "no data"
  // on this key for the whole TTL, so one network blip would blank the prices
  // for every request that followed it.
  if (ok) cache.set(key, { at: Date.now(), data: out });
  return out;
}

/** Market data for the given symbols (defaults to the whole registry). */
export async function getMarket(symbols?: string[]): Promise<Map<string, MarketData>> {
  const metas: TokenMeta[] = symbols
    ? symbols.map(bySymbol).filter((m): m is TokenMeta => Boolean(m))
    : REGISTRY;
  const byAddr = await fetchByAddress(metas.map((m) => priceAddress(m)));
  const bySym = new Map<string, MarketData>();
  for (const m of metas) {
    const d = byAddr.get(priceAddress(m).toLowerCase());
    if (d) bySym.set(m.symbol.toUpperCase(), d);
  }
  return bySym;
}

/** Live price for a single symbol (null when unavailable). */
export async function getPrice(symbol: string): Promise<number | null> {
  const m = await getMarket([symbol]);
  return m.get(symbol.toUpperCase())?.priceUsd ?? null;
}

/**
 * Live OHLCV close series for a symbol, from its deepest pool. `timeframe` is a
 * GeckoTerminal timeframe (minute|hour|day). Returns [] when unavailable — the
 * chart renders an honest empty state rather than a synthesised line.
 */
export async function getOhlcv(
  symbol: string,
  opts: { timeframe?: "minute" | "hour" | "day"; aggregate?: number; limit?: number } = {}
): Promise<Candle[]> {
  const { timeframe = "hour", aggregate = 1, limit = 48 } = opts;
  const market = await getMarket([symbol]);
  const poolId = market.get(symbol.toUpperCase())?.poolId;
  if (!poolId) return [];

  const meta = bySymbol(symbol);
  if (!meta) return [];

  const key = `${poolId}:${timeframe}:${aggregate}:${limit}:${priceAddress(meta)}`;
  const hit = ohlcvCache.get(key);
  if (hit && Date.now() - hit.at < OHLCV_TTL_MS) return hit.series;

  let series: Candle[] = [];
  let ok = false;
  try {
    const url = `${GECKO_BASE}/networks/${NETWORK}/pools/${poolId}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${priceAddress(meta).toLowerCase()}`;
    const res = await fetchWithRetry(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`GeckoTerminal ohlcv ${res.status}`);
    const json = await res.json();
    const list: unknown[] = json?.data?.attributes?.ohlcv_list ?? [];
    series = list
      .map((row) => {
        const [t, , , , close] = row as [number, number, number, number, number, number];
        return { t: t * 1000, price: Number(close) };
      })
      .filter((c) => Number.isFinite(c.price))
      .sort((a, b) => a.t - b.t);
    ok = true;
  } catch (err) {
    console.error("[market] ohlcv failed:", err instanceof Error ? err.message : err);
  }

  // As above: a failed read is not cached, so a blip can't blank the chart.
  if (ok) ohlcvCache.set(key, { at: Date.now(), series });
  return series;
}
