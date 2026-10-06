// Envio HyperIndex — chain-wide ERC20 activity for the registry tokens on Monad.
//
// This is NOT the trade feed. The indexer records raw ERC20 `Transfer` events,
// and a transfer is not a trade: it can be a swap, a CEX deposit, or collateral
// moving between a user's own wallets. Mapping transfers onto TradeDTO would
// invent trade semantics the chain data does not carry, so chain activity is
// kept as its own read model.
//
// Server-only, and it never invents a number. Without ENVIO_INDEXER_URL — or
// when the deployment does not answer — every reader returns `null` and the UI
// renders nothing, rather than an empty list that would read as "no activity".

import "server-only";
import { formatUnits } from "viem";
import { fetchWithRetry } from "./http";
import type { ChainActivityDTO, ChainTransferDTO } from "./types";

/**
 * The deployed indexer's GraphQL endpoint (Envio Cloud, `envio` branch, root
 * dir `indexer`). See indexer/README.md for the deployment's status.
 */
const ENDPOINT = process.env.ENVIO_INDEXER_URL;
const TTL_MS = 30_000;

/** True when an endpoint is configured — says nothing about whether it answers. */
export function indexerConfigured(): boolean {
  return Boolean(ENDPOINT);
}

export type TokenChainStats = { transfers: number; volume: string; lastUpdated: number };

type ChainTransferRow = {
  id: string;
  from: string;
  to: string;
  value: string;
  blockNumber: number;
  timestamp: number;
};

const cache = new Map<string, { at: number; value: unknown }>();

/**
 * Run a GraphQL document. Returns `null` — never throws — when the indexer is
 * unconfigured, unreachable, or answers with errors, so callers degrade to
 * "nothing to show" instead of a 500.
 *
 * Variable types matter: the generated schema takes `String!` for ids. A
 * declared `ID!` is rejected ("used where 'String' is expected").
 */
async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetchWithRetry(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store"
    });
    if (!res.ok) {
      console.error("[indexer] http", res.status);
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (json.errors?.length) {
      console.error("[indexer] graphql:", json.errors[0]?.message);
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[indexer] fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Only a successful read is cached, so one blip can't pin "no data" for the TTL. */
async function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T | null;
  const value = await load();
  if (value !== null) cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Per-token aggregate since the indexer's `start_block`. A missing row means the
 * token has no indexed transfers yet, which is a real answer — not null.
 */
async function getTokenChainStats(address: string): Promise<TokenChainStats | null> {
  const id = address.toLowerCase();
  return cached(`stats:${id}`, async () => {
    const data = await gql<{ TokenStats: TokenChainStats[] }>(
      `query ($id: String!) {
         TokenStats(where: { id: { _eq: $id } }, limit: 1) { transfers volume lastUpdated }
       }`,
      { id }
    );
    return data ? (data.TokenStats[0] ?? null) : null;
  });
}

/** Newest-first transfers for one token. `null` means the read failed. */
async function getRecentTransfers(address: string, limit: number): Promise<ChainTransferRow[] | null> {
  const token = address.toLowerCase();
  return cached(`transfers:${token}:${limit}`, async () => {
    const data = await gql<{ Transfer: ChainTransferRow[] }>(
      `query ($t: String!, $n: Int!) {
         Transfer(where: { token: { _eq: $t } }, order_by: { blockNumber: desc }, limit: $n) {
           id from to value blockNumber timestamp
         }
       }`,
      { t: token, n: limit }
    );
    // `data` is null only on a failed read; an empty array is "nothing indexed".
    return data ? data.Transfer : null;
  });
}

/**
 * Base units → human-readable number. `formatUnits` keeps the precision that
 * `Number(value)` would throw away on an 18-decimal amount.
 */
function toTokenAmount(value: string, decimals: number): number {
  try {
    return Number(formatUnits(BigInt(value), decimals));
  } catch {
    return 0;
  }
}

function toTransferDTO(row: ChainTransferRow, decimals: number): ChainTransferDTO {
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    value: row.value,
    amountToken: toTokenAmount(row.value, decimals),
    blockNumber: row.blockNumber,
    timestamp: row.timestamp
  };
}

/**
 * Chain-wide activity for a registry token — the indexed total plus the newest
 * transfers — or `null` when the indexer is unconfigured or did not answer.
 *
 * Takes identity only (address + decimals) so callers can pass a TokenDTO.
 */
export async function getChainActivity(
  token: { address: string; decimals: number },
  limit = 12
): Promise<ChainActivityDTO | null> {
  const [stats, rows] = await Promise.all([
    getTokenChainStats(token.address),
    getRecentTransfers(token.address, limit)
  ]);
  // A stats row with no transfer list (or vice versa) is a partial read — report
  // nothing rather than a total without the rows behind it.
  if (!stats || !rows) return null;

  return {
    transfers: rows.map((r) => toTransferDTO(r, token.decimals)),
    indexedTransfers: stats.transfers,
    indexedVolumeToken: toTokenAmount(stats.volume, token.decimals),
    lastIndexedAt: stats.lastUpdated,
    source: "envio"
  };
}
