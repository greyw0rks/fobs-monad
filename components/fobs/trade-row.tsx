"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import { Avatar, Num, SideTag } from "./ui";
import { money, compactMoney, ago } from "@/lib/format";
import type { TradeDTO } from "@/lib/types";

// A single trade in the social timeline. Reads like a feed post, not a table row.
export function TradeRow({ trade, onTrade }: { trade: TradeDTO; onTrade?: (symbol: string) => void }) {
  const verb = trade.side === "BUY" ? "bought" : "sold";
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b hairline row-hover">
      <Link href={`/profile/${trade.trader.username}` as Route}>
        <Avatar name={trade.trader.displayName} logo={trade.trader.avatar} size={36} />
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/profile/${trade.trader.username}` as Route} className="font-semibold hover:underline">
            @{trade.trader.username}
          </Link>
          {trade.trader.isNotable && <span className="chip chip-notable">Notable</span>}
          <span className="muted">{verb}</span>
          <SideTag side={trade.side} />
          <Link href={`/token/${trade.token.symbol}` as Route} className="num font-semibold hover:underline">
            {trade.token.symbol}
          </Link>
          {trade.fromChain && (
            <span className="chip" title="Cross-chain funded">
              via {trade.fromChain}
            </span>
          )}
          <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
            · {ago(trade.createdAt)}
          </span>
        </div>

        <div className="mt-1 flex items-baseline gap-3">
          <Num className={trade.side === "BUY" ? "up" : "down"} >
            <span style={{ fontSize: "var(--t-lg)", fontWeight: 700 }}>{money(trade.amountUsd)}</span>
          </Num>
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
            <Num>{compactMoney(trade.amountToken * trade.priceUsd)}</Num> at <Num>{money(trade.priceUsd)}</Num>
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Link href={`/token/${trade.token.symbol}` as Route} className="btn btn-sm">
            View <ArrowUpRight size={13} />
          </Link>
          {onTrade && (
            <button className="btn btn-sm btn-buy" onClick={() => onTrade(trade.token.symbol)}>
              Trade
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
