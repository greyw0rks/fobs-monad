"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useState, useEffect } from "react";
import { Wallet, LogOut } from "lucide-react";
import { shortAddress } from "@/lib/format";

/** The connected Monad address (lowercased), or undefined. Identity = wallet. */
export function useFobsAddress(): string | undefined {
  const { address } = useAccount();
  return address?.toLowerCase();
}

export function ConnectWalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
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

  if (isConnected && address) {
    return (
      <button
        className={`btn ${compact ? "btn-sm" : ""}`}
        onClick={() => disconnect()}
        title="Disconnect"
      >
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
