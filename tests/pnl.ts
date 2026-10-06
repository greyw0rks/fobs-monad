// Cost-basis checks — the average-cost walk in lib/cost-basis.ts.
//
// Pure arithmetic, hand-computed expectations. It runs under tsx with no test
// framework: `pnpm test:pnl`. Every case below is a number checked by hand, not
// by snapshotting whatever the code happened to produce.

import assert from "node:assert/strict";
import { reconstructBasis } from "../lib/cost-basis";

type Row = { tokenSymbol: string; side: "BUY" | "SELL"; amountToken: number; amountUsd: number };
const buy = (t: string, amountToken: number, amountUsd: number): Row => ({ tokenSymbol: t, side: "BUY", amountToken, amountUsd });
const sell = (t: string, amountToken: number, amountUsd: number): Row => ({ tokenSymbol: t, side: "SELL", amountToken, amountUsd });

function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);
}

// 1. A single buy sets the average to its price.
{
  const b = reconstructBasis([buy("MON", 100, 100)]).get("MON")!;
  assert.equal(b.complete, true);
  close(b.qty, 100);
  close(b.cost, 100);
  close(b.cost / b.qty, 1);
}

// 2. Two buys average by USD, not by quantity: 10@$1 then 20@$2 -> 30/20 = $1.50.
{
  const b = reconstructBasis([buy("WMON", 10, 10), buy("WMON", 10, 20)]).get("WMON")!;
  close(b.qty, 20);
  close(b.cost, 30);
  close(b.cost / b.qty, 1.5);
}

// 3. A sell realises against the running average and leaves that average alone.
//    20 @ $1.50 average; sell 5 for $10 -> realised 10 - 7.5 = 2.5, qty 15, cost 22.5.
{
  const b = reconstructBasis([buy("MON", 10, 10), buy("MON", 10, 20), sell("MON", 5, 10)]).get("MON")!;
  assert.equal(b.complete, true);
  close(b.realized, 2.5);
  close(b.qty, 15);
  close(b.cost, 22.5);
  close(b.cost / b.qty, 1.5);
}

// 4. Selling at a loss is a negative realised number, not a clamped one.
{
  const b = reconstructBasis([buy("USDC", 100, 100), sell("USDC", 40, 20)]).get("USDC")!;
  close(b.realized, -20);
  close(b.qty, 60);
  close(b.cost, 60);
}

// 5. Selling everything leaves no position but keeps the realised PnL.
{
  const b = reconstructBasis([buy("MON", 100, 100), sell("MON", 100, 250)]).get("MON")!;
  assert.equal(b.complete, true);
  close(b.qty, 0);
  close(b.cost, 0);
  close(b.realized, 150);
}

// 6. The load-bearing case: a sell with no recorded buy before it means the
//    history is missing fills, so the basis must be marked unusable. Reporting
//    an average here would be inventing one.
{
  const b = reconstructBasis([sell("WETH", 1, 3000), buy("WETH", 1, 2000)]).get("WETH")!;
  assert.equal(b.complete, false);
}

// 7. Once unusable, later buys do not silently repair it — the gap is permanent.
{
  const b = reconstructBasis([sell("MON", 5, 10), buy("MON", 100, 100)]).get("MON")!;
  assert.equal(b.complete, false);
}

// 8. Tokens are tracked independently.
{
  const m = reconstructBasis([buy("MON", 10, 10), buy("USDC", 50, 50)]);
  close(m.get("MON")!.cost, 10);
  close(m.get("USDC")!.cost, 50);
  assert.equal(m.get("WETH"), undefined);
}

// 9. A buy-sell-buy cycle keeps a single running average across the rebuy.
//    10@$1 + 10@$2 = 20/$30; sell 10 -> realised 15, leaves 10/$15 ($1.50);
//    buy 10 for $40 -> 20/$55, average $2.75.
{
  const b = reconstructBasis([buy("MON", 10, 10), buy("MON", 10, 20), sell("MON", 10, 15), buy("MON", 10, 40)]).get("MON")!;
  assert.equal(b.complete, true);
  close(b.realized, 0);
  close(b.qty, 20);
  close(b.cost, 55);
  close(b.cost / b.qty, 2.75);
}

console.log("pnl: 9/9 cases passed");
