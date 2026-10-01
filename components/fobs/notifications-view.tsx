"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { UserPlus, TrendingUp, Check } from "lucide-react";
import { useFobsAddress } from "./connect-wallet-button";
import { Avatar } from "./ui";
import { ago } from "@/lib/format";

type Notif = {
  id: string;
  type: "FOLLOW" | "NOTABLE_TRADE" | "TRADE_FILLED";
  tokenSymbol: string | null;
  read: boolean;
  createdAt: string;
  actor: { username: string; displayName: string; avatar: string | null; isNotable: boolean } | null;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("request failed");
  return r.json();
}

export function NotificationsView() {
  const address = useFobsAddress();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications", address],
    queryFn: () => fetchJSON<{ notifications: Notif[] }>(`/api/notifications?address=${address}`),
    enabled: Boolean(address),
    refetchInterval: 20_000
  });

  if (!address) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <h1 style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>Activity</h1>
        <p className="muted mt-2">Connect your wallet to see follows and notable trades.</p>
      </div>
    );
  }

  const notifs = data?.notifications ?? [];

  return (
    <div className="mx-auto w-full max-w-xl p-4 lg:p-6">
      <h1 className="mb-4" style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>
        Activity
      </h1>
      {isLoading && <div className="p-6 text-center muted">Loading…</div>}
      {!isLoading && notifs.length === 0 && (
        <div className="card p-8 text-center muted">Nothing yet. Follow some traders to get going.</div>
      )}
      {notifs.length > 0 && (
        <div className="card overflow-hidden">
          {notifs.map((n) => (
            <div key={n.id} className="flex items-center gap-3 px-4 py-3 border-b hairline">
              <span className="shrink-0">
                {n.type === "FOLLOW" ? (
                  <UserPlus size={18} className="muted" />
                ) : n.type === "NOTABLE_TRADE" ? (
                  <TrendingUp size={18} className="up" />
                ) : (
                  <Check size={18} className="up" />
                )}
              </span>
              {n.actor && <Avatar name={n.actor.displayName} logo={n.actor.avatar} size={30} />}
              <div className="flex-1 min-w-0">
                <div>
                  {n.type === "FOLLOW" && n.actor && (
                    <>
                      <Link href={`/profile/${n.actor.username}` as Route} className="font-semibold hover:underline">
                        @{n.actor.username}
                      </Link>{" "}
                      <span className="muted">followed you</span>
                    </>
                  )}
                  {n.type === "NOTABLE_TRADE" && (
                    <span className="muted">Notable activity on {n.tokenSymbol}</span>
                  )}
                  {n.type === "TRADE_FILLED" && <span className="muted">Your {n.tokenSymbol} trade filled</span>}
                </div>
                <div className="faint" style={{ fontSize: "var(--t-xs)" }}>
                  {ago(n.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
