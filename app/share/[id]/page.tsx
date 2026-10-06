import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink, RefreshCw } from "lucide-react";
import { dbQuery, type DbResult } from "@/lib/db";
import { tradeInclude, toTradeDTO } from "@/lib/feed";
import { Avatar, Num } from "@/components/fobs/ui";
import { money, compactNumber, price, ago, txUrl, shortHash } from "@/lib/format";
import type { TradeDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

// `ok: false` (DB didn't answer) is kept apart from `data: null` (no such
// trade). A publicly shared link must never 404 because of a cold start.
async function getTrade(id: string): Promise<DbResult<TradeDTO | null>> {
  const row = await dbQuery((db) => db.trade.findUnique({ where: { id }, include: tradeInclude }));
  return row.ok ? { ok: true, data: row.data ? toTradeDTO(row.data) : null } : row;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await getTrade(id);
  // Don't emit an OG card for a trade we could not load — an unfurl for a trade
  // we haven't read would be asserting something we don't know.
  if (!result.ok || !result.data) return { title: "Trade · fobs" };
  const trade = result.data;
  const verb = trade.side === "BUY" ? "Bought" : "Sold";
  const title = `${verb} ${compactNumber(trade.amountToken)} ${trade.token.symbol} on Monad · fobs`;
  const description = `@${trade.trader.username} ${verb.toLowerCase()} ${money(trade.amountUsd)} of ${trade.token.symbol} on Monad via fobs.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTrade(id);
  if (!result.ok) return <Unavailable id={id} />;
  if (!result.data) notFound();

  const trade = result.data;
  const verb = trade.side === "BUY" ? "Bought" : "Sold";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <header className="flex items-center justify-between px-5 h-16 border-b hairline">
        <Link href={"/" as Route} className="flex items-center gap-2">
          <span className="num" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em" }}>
            fobs
          </span>
          <span className="chip">Monad</span>
        </Link>
        <Link href={"/feed" as Route} className="btn btn-sm">
          Open app
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full" style={{ maxWidth: 440 }}>
          {/* Share card */}
          <div
            className="rounded-md p-6 flex flex-col gap-5"
            style={{ background: "linear-gradient(160deg, #15131f, #0c0d12)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <span className="num" style={{ fontWeight: 800, letterSpacing: "-0.03em", fontSize: "var(--t-lg)" }}>
                fobs
              </span>
              <span className="chip">
                <span className="live-dot" /> Monad
              </span>
            </div>

            {/* Trader */}
            <Link href={`/profile/${trade.trader.username}` as Route} className="flex items-center gap-2.5 row-hover rounded-md -mx-1 px-1 py-1">
              <Avatar name={trade.trader.displayName} logo={trade.trader.avatar} size={36} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span style={{ fontWeight: 600 }}>@{trade.trader.username}</span>
                  {trade.trader.isNotable && <span className="chip chip-notable">Notable</span>}
                </div>
                <div className="faint" style={{ fontSize: "var(--t-xs)" }}>
                  {ago(trade.createdAt)}
                  {trade.fromChain && trade.fromChain !== "monad" && <> · funded from {trade.fromChain}</>}
                </div>
              </div>
            </Link>

            {/* The trade */}
            <div>
              <div className={trade.side === "BUY" ? "up" : "down"} style={{ fontWeight: 700, fontSize: "var(--t-sm)", letterSpacing: "0.04em" }}>
                {verb.toUpperCase()}
              </div>
              <div className="num flex items-center gap-2 flex-wrap" style={{ fontSize: "var(--t-2xl)", fontWeight: 700 }}>
                <span>{money(trade.amountUsd)}</span>
                <ArrowRight size={20} className="faint" />
                <span>
                  {compactNumber(trade.amountToken)} {trade.token.symbol}
                </span>
              </div>
            </div>

            {/* Facts */}
            <div className="card-2 p-3 flex flex-col gap-2" style={{ fontSize: "var(--t-sm)" }}>
              <Fact label="Token">
                <Num>{trade.token.symbol}</Num> <span className="muted">{trade.token.name}</span>
              </Fact>
              <Fact label="Fill price">
                <Num>{price(trade.priceUsd)}</Num>
              </Fact>
              <Fact label="Settled on">
                <Num>Monad</Num>
              </Fact>
              {trade.txHash && (
                <Fact label="Tx">
                  <a href={txUrl(trade.txHash)} target="_blank" rel="noreferrer" className="num hover:underline inline-flex items-center gap-1">
                    {shortHash(trade.txHash)} <ExternalLink size={12} />
                  </a>
                </Fact>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Link href={`/token/${trade.token.symbol}` as Route} className="btn btn-primary flex-1" style={{ height: 44 }}>
              Trade {trade.token.symbol} <ArrowRight size={15} />
            </Link>
            <Link href={"/feed" as Route} className="btn flex-1" style={{ height: 44 }}>
              Explore fobs
            </Link>
          </div>

          <p className="faint text-center mt-4" style={{ fontSize: "var(--t-xs)" }}>
            A real, user-signed swap on Monad. Fobs never holds your keys or your funds.
          </p>
        </div>
      </main>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

// Shown when the trade could not be READ — deliberately not a 404, and it makes
// no claim about the trade (not "expired", not "deleted"). Renders with a 200
// because App Router has no way to set a status on a rendered page; the honesty
// here is in the message, and the state is never cached (force-dynamic).
function Unavailable({ id }: { id: string }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <header className="flex items-center justify-between px-5 h-16 border-b hairline">
        <Link href={"/" as Route} className="flex items-center gap-2">
          <span className="num" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em" }}>
            fobs
          </span>
          <span className="chip">Monad</span>
        </Link>
        <Link href={"/feed" as Route} className="btn btn-sm">
          Open app
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full text-center" style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>Couldn&apos;t load this trade</h1>
          <p className="muted mt-2">
            We couldn&apos;t reach our data right now, so we can&apos;t show you what happened. This trade link is
            unchanged — try again in a moment.
          </p>
          <div className="flex gap-2 mt-5 justify-center">
            <Link href={`/share/${id}` as Route} className="btn btn-primary" style={{ height: 44 }}>
              <RefreshCw size={15} /> Try again
            </Link>
            <Link href={"/feed" as Route} className="btn" style={{ height: 44 }}>
              Explore fobs
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
