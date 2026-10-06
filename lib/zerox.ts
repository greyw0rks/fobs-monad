// 0x Swap API v2 client — the real on-chain routing engine. Server-only: the
// ZEROX_API_KEY never leaves the server, and this module only ever REQUESTS
// calldata — it does not sign. The returned transaction{to,data,value} is handed
// to the client to sign in the user's wallet (see trade-drawer.tsx). Monad
// mainnet is chainId 143.
//
// Endpoint: allowance-holder (approve the AllowanceHolder, then send the tx —
// no Permit2 signature needed). Docs: docs.0x.org (Swap API v2).

import "server-only";
import { MONAD_CHAIN_ID } from "./chain";
import { fetchWithRetry } from "./http";

const BASE = "https://api.0x.org/swap/allowance-holder";

export class ZeroExError extends Error {}

export type ZeroExQuote = {
  liquidityAvailable: boolean;
  buyAmount: string; // base units
  sellAmount: string; // base units
  minBuyAmount: string; // base units, after slippage
  totalNetworkFee: string | null; // wei of native MON
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string; gas: string | null } | null;
  // issues.allowance.spender is the address the client must ERC20-approve.
  allowanceTarget: `0x${string}` | null;
  allowanceNeeded: string | null; // required allowance (base units) if short
};

type QuoteParams = {
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellAmount: string; // base units of sellToken
  taker: `0x${string}`;
  slippageBps: number;
};

export async function getSwapQuote(params: QuoteParams): Promise<ZeroExQuote> {
  const apiKey = process.env.ZEROX_API_KEY;
  if (!apiKey) throw new ZeroExError("Swap routing is not configured (missing ZEROX_API_KEY)");

  const qs = new URLSearchParams({
    chainId: String(MONAD_CHAIN_ID),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
    taker: params.taker,
    slippageBps: String(params.slippageBps)
  });

  // Retries only on a network failure (a dropped keep-alive connection), never
  // on an HTTP error — so a rejected quote is not silently re-requested.
  const res = await fetchWithRetry(`${BASE}/quote?${qs}`, {
    headers: { "0x-api-key": apiKey, "0x-version": "v2", accept: "application/json" },
    cache: "no-store"
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.message ?? json?.reason ?? `0x quote failed (${res.status})`;
    throw new ZeroExError(typeof msg === "string" ? msg : "0x quote failed");
  }
  if (json?.liquidityAvailable === false) {
    throw new ZeroExError("No liquidity available for this pair/size right now");
  }

  const allowance = json?.issues?.allowance ?? null;

  return {
    liquidityAvailable: Boolean(json?.liquidityAvailable),
    buyAmount: String(json?.buyAmount ?? "0"),
    sellAmount: String(json?.sellAmount ?? params.sellAmount),
    minBuyAmount: String(json?.minBuyAmount ?? json?.buyAmount ?? "0"),
    totalNetworkFee: json?.totalNetworkFee != null ? String(json.totalNetworkFee) : null,
    transaction: json?.transaction
      ? {
          to: json.transaction.to,
          data: json.transaction.data,
          value: String(json.transaction.value ?? "0"),
          gas: json.transaction.gas != null ? String(json.transaction.gas) : null
        }
      : null,
    allowanceTarget: allowance?.spender ?? null,
    allowanceNeeded: allowance?.actual != null ? String(allowance.actual) : null
  };
}
