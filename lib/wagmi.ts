// wagmi config — Monad mainnet, browser-injected wallets only.
//
// Monad is not a built-in wagmi chain, so the chain is defined once in
// lib/chain.ts (shared with server-side viem) and imported here. The injected()
// connector covers MetaMask / Rabby / OKX and anything else that injects
// window.ethereum — matching Monad's ecosystem without extra wallet SDKs.
//
// Trading moves real funds, so the app enforces chainId 143 before any swap
// (see connect-wallet-button.tsx). The server never holds keys or signs; every
// approval/swap is a client-side wallet signature.

import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { monad, MONAD_CHAIN_ID, MONAD_RPC_URL } from "./chain";

export { monad, MONAD_CHAIN_ID };

export const wagmiConfig = createConfig({
  chains: [monad],
  connectors: [injected()],
  transports: {
    [monad.id]: http(MONAD_RPC_URL)
  },
  ssr: true
});
