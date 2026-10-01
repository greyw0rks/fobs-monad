import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Zap, Users, Radio } from "lucide-react";
import { ConnectWalletButton } from "@/components/fobs/connect-wallet-button";

export default function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      {/* Nav */}
      <header className="flex items-center justify-between px-5 h-16 border-b hairline">
        <div className="flex items-center gap-2">
          <span className="num" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em" }}>
            fobs
          </span>
          <span className="chip">Monad</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={"/feed" as Route} className="btn btn-sm">
            Open app
          </Link>
          <ConnectWalletButton compact />
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-5 pt-24 pb-20 text-center">
          <div className="chip mx-auto mb-6" style={{ height: 26 }}>
            <span className="live-dot" /> Social trading, live on Monad
          </div>
          <h1 style={{ fontSize: "clamp(34px, 6vw, 56px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
            See a trade.
            <br />
            Act on it instantly.
          </h1>
          <p className="muted mx-auto mt-5" style={{ fontSize: "var(--t-lg)", maxWidth: 560 }}>
            Discover tokens through other traders&apos; activity, fund from any chain, and execute on Monad — without
            ever thinking about a bridge.
          </p>
          <div className="flex items-center justify-center gap-3 mt-8">
            <Link href={"/feed" as Route} className="btn btn-primary" style={{ height: 44, padding: "0 20px" }}>
              Enter the terminal <ArrowRight size={16} />
            </Link>
            <Link href={"/explore" as Route} className="btn" style={{ height: 44, padding: "0 20px" }}>
              Browse markets
            </Link>
          </div>
        </div>
      </section>

      {/* The loop */}
      <section className="mx-auto max-w-4xl px-5 pb-20">
        <div className="eyebrow text-center mb-6">One magical loop</div>
        <div className="flex flex-wrap items-center justify-center gap-2 num muted" style={{ fontSize: "var(--t-sm)" }}>
          {["Discover a trade", "See why it matters", "Fund from any chain", "Execute on Monad", "Share it"].map(
            (step, i, arr) => (
              <span key={step} className="flex items-center gap-2">
                <span className="chip" style={{ color: "var(--ink)" }}>
                  {step}
                </span>
                {i < arr.length - 1 && <ArrowRight size={13} className="faint" />}
              </span>
            )
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-12">
          <Feature icon={<Radio size={18} />} title="Discover" body="A live feed of real on-chain activity — trending tokens, notable buys, trader profiles." />
          <Feature icon={<Zap size={18} />} title="Trade" body="Monad-native swaps with cross-chain funding abstracted away. The bridge is infrastructure; the trade is the product." />
          <Feature icon={<Users size={18} />} title="Follow" body="Follow wallets, watch what they trade, and share your own moves with a card built to travel." />
        </div>
      </section>

      <footer className="border-t hairline py-8 text-center muted" style={{ fontSize: "var(--t-sm)" }}>
        fobs · a social trading terminal for Monad · demo build
      </footer>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: "var(--primary)" }}>{icon}</span>
        <span style={{ fontWeight: 700 }}>{title}</span>
      </div>
      <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
        {body}
      </p>
    </div>
  );
}
