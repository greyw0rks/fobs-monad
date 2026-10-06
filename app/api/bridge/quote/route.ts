import { NextResponse } from "next/server";
import { z } from "zod";
import { parseUnits } from "viem";
import { bridgeSourceById, BRIDGE_DESTINATIONS, type BridgeDestination } from "@/lib/bridge";
import { getBridgeQuote, BridgeError } from "@/lib/bridge-route";
import type { BridgeQuoteDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const DECIMAL_RE = /^\d+(\.\d+)?$/;

const Body = z.object({
  sourceId: z.number().int(),
  destSymbol: z.string(),
  // Raw user input, exactly as typed — parsed to base units server-side so no
  // float rounding creeps into the amount the user actually sends.
  amount: z.string(),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "A connected wallet address is required"),
  slippageBps: z.number().int().min(1).max(500).default(100)
});

// POST /api/bridge/quote — cross-chain funding INTO Monad. Returns the unsigned
// origin-chain steps the user signs in their OWN wallet (Relay routes to Monad;
// Aurora is the fallback provider). The server only quotes.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { sourceId, destSymbol, amount, recipient, slippageBps } = parsed.data;

  const source = bridgeSourceById(sourceId);
  if (!source) return NextResponse.json({ error: "Unsupported source chain" }, { status: 404 });

  const dest = destSymbol.toUpperCase() as BridgeDestination;
  if (!BRIDGE_DESTINATIONS.includes(dest)) {
    return NextResponse.json({ error: `Unsupported destination ${destSymbol}` }, { status: 404 });
  }

  const clean = amount.trim().replace(/\.$/, "");
  if (!DECIMAL_RE.test(clean) || Number(clean) <= 0) {
    return NextResponse.json({ error: "Enter a valid amount" }, { status: 400 });
  }

  let amountIn: bigint;
  try {
    amountIn = parseUnits(clean, source.decimals);
  } catch {
    return NextResponse.json({ error: `Amount has too many decimals for ${source.symbol}` }, { status: 400 });
  }
  if (amountIn <= BigInt(0)) return NextResponse.json({ error: "Amount is too small" }, { status: 400 });

  try {
    const dto: BridgeQuoteDTO = await getBridgeQuote({
      sourceId: source.id,
      destSymbol: dest,
      amount: amountIn.toString(),
      recipient: recipient as `0x${string}`,
      slippageBps
    });
    return NextResponse.json({ quote: dto });
  } catch (err) {
    const status = err instanceof BridgeError ? 422 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bridge quote failed" }, { status });
  }
}
