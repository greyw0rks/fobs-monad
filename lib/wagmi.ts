// wagmi config — Monad testnet, browser-injected wallets only.
//
// Monad is not a built-in wagmi chain, so we define it with viem's
// defineChain. The injected() connector covers MetaMask / Rabbit / OKX and
// anything else that injects window.ethereum — matching Monad's current
// ecosystem without pulling in extra wallet abstractions.

import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] }
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" }
  },
  testnet: true
});

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http(rpcUrl)
  },
  ssr: true
});

export const MONAD_CHAIN_ID = monadTestnet.id; // 10143
