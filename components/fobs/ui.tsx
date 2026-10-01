// Presentational primitives shared across pages. Server-safe (no hooks).

import { initials } from "@/lib/format";

/** Monospace number. Use for every price, %, size, address, hash. */
export function Num({
  children,
  className = "",
  style
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`num ${className}`} style={style}>
      {children}
    </span>
  );
}

export function Avatar({
  name,
  logo,
  size = 32
}: {
  name: string;
  logo?: string | null;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={name} className="avatar" style={{ ...style, objectFit: "cover" }} />;
  }
  return (
    <span className="avatar" style={style}>
      {initials(name)}
    </span>
  );
}

/** Fobs Signal strength bar. Labelled by the caller as Fobs' own metric. */
export function SignalBar({ score, className = "" }: { score: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="signal-track flex-1">
        <div className="signal-fill" style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
      </div>
      <span className="num text-ink" style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>
        {score}
      </span>
    </div>
  );
}

export function SideTag({ side }: { side: "BUY" | "SELL" }) {
  return (
    <span
      className="num"
      style={{
        fontSize: "var(--t-xs)",
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: side === "BUY" ? "var(--up)" : "var(--down)"
      }}
    >
      {side}
    </span>
  );
}
