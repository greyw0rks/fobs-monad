"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { Route } from "next";
import { Avatar, Num } from "./ui";
import { price, pct } from "@/lib/format";
import type { TokenDTO, TraderDTO } from "@/lib/types";

type SearchResult = { tokens: TokenDTO[]; traders: TraderDTO[] };

export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<SearchResult>({ tokens: [], traders: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 1) {
      setRes({ tokens: [], traders: [] });
      return;
    }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (r.ok) setRes(await r.json());
      } catch {
        /* ignore */
      }
    }, 180);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (href: Route) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  const hasResults = res.tokens.length > 0 || res.traders.length > 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 px-3 h-9 rounded-md card-2">
        <Search size={15} className="muted" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search tokens, wallets…"
          className="bg-transparent outline-none flex-1 placeholder:text-faint"
          style={{ fontSize: "var(--t-md)" }}
        />
        {q && (
          <button onClick={() => setQ("")} className="muted">
            <X size={14} />
          </button>
        )}
      </div>

      {open && q.trim() && (
        <div
          className="absolute top-11 left-0 right-0 card z-50 overflow-hidden"
          style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
        >
          {!hasResults && <div className="px-3 py-4 muted text-center">No matches</div>}
          {res.tokens.length > 0 && (
            <div className="py-1">
              <div className="eyebrow px-3 py-1">Tokens</div>
              {res.tokens.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => go(`/token/${t.symbol}` as Route)}
                  className="w-full flex items-center gap-3 px-3 py-2 row-hover text-left"
                >
                  <Avatar name={t.symbol} logo={t.logo} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="num" style={{ fontWeight: 600 }}>
                      {t.symbol}
                    </div>
                    <div className="muted truncate" style={{ fontSize: "var(--t-xs)" }}>
                      {t.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <Num>{price(t.priceUsd)}</Num>
                    <div className={t.change24h >= 0 ? "up" : "down"} style={{ fontSize: "var(--t-xs)" }}>
                      <Num>{pct(t.change24h)}</Num>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {res.traders.length > 0 && (
            <div className="py-1 border-t hairline">
              <div className="eyebrow px-3 py-1">Traders</div>
              {res.traders.map((u) => (
                <button
                  key={u.id}
                  onClick={() => go(`/profile/${u.username}` as Route)}
                  className="w-full flex items-center gap-3 px-3 py-2 row-hover text-left"
                >
                  <Avatar name={u.displayName} logo={u.avatar} size={28} />
                  <div className="flex-1 min-w-0">
                    <div style={{ fontWeight: 600 }}>@{u.username}</div>
                    <div className="muted truncate" style={{ fontSize: "var(--t-xs)" }}>
                      {u.displayName}
                    </div>
                  </div>
                  {u.isNotable && <span className="chip chip-notable">Notable</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
