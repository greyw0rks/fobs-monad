"use client";

import { useEffect, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from "recharts";
import { price } from "@/lib/format";

type Point = { t: number; price: number };

export function PriceChart({ symbol, up, height = 220 }: { symbol: string; up: boolean; height?: number }) {
  const [data, setData] = useState<Point[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/candles/${symbol}?points=72`)
      .then((r) => r.json())
      .then((d) => active && setData(d.series ?? []))
      .catch(() => active && setData([]));
    return () => {
      active = false;
    };
  }, [symbol]);

  const color = up ? "var(--up)" : "var(--down)";

  if (!data) {
    return (
      <div className="flex items-center justify-center muted" style={{ height }}>
        Loading chart…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center faint" style={{ height }}>
        No price history yet
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Tooltip
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12
            }}
            labelFormatter={() => ""}
            formatter={(v) => [price(Number(v)), "Price"]}
            cursor={{ stroke: "var(--border)" }}
          />
          <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#g-${symbol})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
