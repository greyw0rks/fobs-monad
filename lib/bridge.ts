// Bridge vocabulary — the chains fobs can be funded FROM and the tokens it
// delivers ON Monad. Client-safe (no secrets): the drawer reads balances with
// wagmi, the server resolves nothing here.
//
// USDC addresses are the canonical Circle deployments on each chain, each
// cross-checked against Aurora's own token list (which reports the same
// contract + decimals). Decimals are NOT uniform: BSC's USDC is 18, every other
// source is 6 — hard-coding 6 would mis-parse a BNB Chain deposit by 10^12.
//
// Monad destinations are the registry's verified addresses; native MON is the
// zero address as both Relay and Kuru expect.

import { mainnet, base, arbitrum, optimism, polygon, bsc, type Chain } from "viem/chains";
import { USDC_ADDRESS, bySymbol } from "./registry";

export type BridgeSource = {
  id: number; // EIP-155 chain id
  name: string;
  auroraKey: string; // Aurora's `blockchain` value (fallback provider)
  symbol: string; // origin asset we fund with
  decimals: number; // verified per-chain (BSC differs)
  address: `0x${string}`; // origin token contract on that chain
  chain: Chain; // viem chain — wagmi balance reads + wallet switching
};

export const BRIDGE_SOURCES: BridgeSource[] = [
  {
    id: base.id,
    name: "Base",
    auroraKey: "base",
    symbol: "USDC",
    decimals: 6,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chain: base
  },
  {
    id: arbitrum.id,
    name: "Arbitrum",
    auroraKey: "arb",
    symbol: "USDC",
    decimals: 6,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    chain: arbitrum
  },
  {
    id: mainnet.id,
    name: "Ethereum",
    auroraKey: "eth",
    symbol: "USDC",
    decimals: 6,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chain: mainnet
  },
  {
    id: optimism.id,
    name: "Optimism",
    auroraKey: "op",
    symbol: "USDC",
    decimals: 6,
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    chain: optimism
  },
  {
    id: polygon.id,
    name: "Polygon",
    auroraKey: "pol",
    symbol: "USDC",
    decimals: 6,
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    chain: polygon
  },
  {
    id: bsc.id,
    name: "BNB Chain",
    auroraKey: "bsc",
    symbol: "USDC",
    decimals: 18, // BSC's USDC is 18dp — the one source that isn't 6
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    chain: bsc
  }
];

export function bridgeSourceById(id: number): BridgeSource | undefined {
  return BRIDGE_SOURCES.find((s) => s.id === id);
}

// Destination assets the user receives on Monad. The zero address is the native
// MON sentinel both bridges expect.
export const BRIDGE_DESTINATIONS = ["MON", "USDC", "USDT0"] as const;
export type BridgeDestination = (typeof BRIDGE_DESTINATIONS)[number];

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function bridgeDestination(symbol: BridgeDestination): {
  address: `0x${string}`;
  decimals: number;
  isNative: boolean;
} {
  if (symbol === "MON") return { address: ZERO, decimals: 18, isNative: true };
  const meta = bySymbol(symbol);
  return {
    address: (meta?.address ?? USDC_ADDRESS) as `0x${string}`,
    decimals: meta?.decimals ?? 6,
    isNative: false
  };
}

export const DEFAULT_BRIDGE_SOURCE = "base";
export const DEFAULT_BRIDGE_DESTINATION: BridgeDestination = "MON";
