"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useState, useEffect } from "react";
import { Wallet, LogOut, AlertTriangle } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { MONAD_CHAIN_ID } from "@/lib/wagmi";

/** The connected Monad address (lowercased), or undefined. Identity = wallet. */
export function useFobsAddress(): string | undefined {
  const { address } = useAccount();
  return address?.toLowerCase();
}

/** True only when a wallet is connected AND on Monad mainnet. Trading requires this. */
export function useOnMonad(): boolean {
  const { isConnected, chainId } = useAccount();
  return Boolean(isConnected) && chainId === MONAD_CHAIN_ID;
}

export function ConnectWalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch: wallet state is client-only.
  if (!mounted) {
    return (
      <button className={`btn ${compact ? "btn-sm" : ""}`} disabled>
        <Wallet size={14} /> Connect
      </button>
    );
  }

  if (isConnected && address && chainId !== MONAD_CHAIN_ID) {
    return (
      <button
        className={`btn btn-primary ${compact ? "btn-sm" : ""}`}
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: MONAD_CHAIN_ID })}
        title="This app trades on Monad mainnet"
      >
        <AlertTriangle size={14} />
        {isSwitching ? "Switching…" : "Switch to Monad"}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button className={`btn ${compact ? "btn-sm" : ""}`} onClick={() => disconnect()} title="Disconnect">
        <span className="live-dot" />
        <span className="num">{shortAddress(address)}</span>
        <LogOut size={13} className="muted" />
      </button>
    );
  }

  const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
  return (
    <button
      className={`btn btn-primary ${compact ? "btn-sm" : ""}`}
      disabled={isPending || !injected}
      onClick={() => injected && connect({ connector: injected })}
    >
      <Wallet size={14} />
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
