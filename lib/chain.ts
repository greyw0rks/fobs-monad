// Monad mainnet — the single source of chain truth, shared by client (wagmi)
// and server (viem publicClient, receipt verification). Mainnet chainId is 143.
//
// Verified against Monad docs → Network Information (Mainnet):
//   chainId 143, RPC https://rpc.monad.xyz, explorer https://monadscan.com,
//   native MON (18 decimals). Canonical contracts (Multicall3, Permit2) are the
//   standard cross-chain deployments and are present on Monad.

import { defineChain } from "viem";

export const MONAD_CHAIN_ID = 143 as const;

export const MONAD_RPC_URL = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://rpc.monad.xyz";

export const EXPLORER_URL = "https://monadscan.com";

// Standard canonical deployments (same address on every chain they ship to).
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;

// 0x and most aggregators use this sentinel for the native asset (MON here).
export const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_RPC_URL] }
  },
  blockExplorers: {
    default: { name: "Monadscan", url: EXPLORER_URL }
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS }
  }
});
