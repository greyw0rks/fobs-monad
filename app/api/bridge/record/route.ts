import { NextResponse } from "next/server";
import { z } from "zod";
import type { Hash } from "viem";
import { prisma, dbConfigured } from "@/lib/db";
import { resolveUser } from "@/lib/session";
import { bridgeSourceById, BRIDGE_DESTINATIONS } from "@/lib/bridge";
import { getRelayStatus } from "@/lib/relay";
import { verifyOriginSpend, verifyDestinationCredit } from "@/lib/bridge-verify";

export const dynamic = "force-dynamic";

const HASH = /^0x[a-fA-F0-9]{64}$/;

const Body = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  originChainId: z.number().int().positive(),
  originTxHash: z.string().regex(HASH),
  // The bridge's own request id. The DESTINATION tx hash is read from the
  // provider, never accepted from the client — that is what ties the leg we
  // credit to the specific bridge request the user started.
  requestId: z.string().regex(HASH),
  destinationSymbol: z.enum(BRIDGE_DESTINATIONS)
});

// POST /api/bridge/record — a bridge delivered tokens to the user on Monad.
// Verify BOTH legs on-chain (the spend on the origin chain, the credit on Monad)
// and persist it as a CROSS_CHAIN Trade carrying the funding chain. Idempotent
// on the destination tx hash.
export async function POST(request: Request) {
  if (!dbConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { originChainId, originTxHash, requestId, destinationSymbol } = parsed.data;
  const address = parsed.data.address.toLowerCase() as `0x${string}`;

  const source = bridgeSourceById(originChainId);
  if (!source) return NextResponse.json({ error: `Unknown source chain ${originChainId}` }, { status: 400 });

  // A same-asset bridge just moves USDC between chains — what the user holds
  // doesn't change, so it is a transfer, not a trade. Recording it as "bought
  // USDC" would be inventing a market action that never happened.
  if (source.symbol === destinationSymbol) {
    return NextResponse.json({
      recorded: false,
      reason: `${source.symbol} → ${destinationSymbol} is a transfer, not a trade`
    });
  }

  // Ask the PROVIDER which Monad tx delivered this request. A client-supplied
  // hash could point at any unrelated transfer.
  let destinationTxHash: string | undefined;
  try {
    const status = await getRelayStatus(requestId);
    destinationTxHash = status.destinationTxHashes[0];
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bridge status is unavailable" },
      { status: 502 }
    );
  }
  if (!destinationTxHash || !HASH.test(destinationTxHash)) {
    return NextResponse.json({ error: "Not delivered on Monad yet" }, { status: 404 });
  }

  const existing = await prisma.trade.findUnique({ where: { txHash: destinationTxHash } }).catch(() => null);
  if (existing) {
    return NextResponse.json({
      recorded: true,
      alreadyRecorded: true,
      tradeId: existing.id,
      symbol: existing.tokenSymbol
    });
  }

  const [spent, received] = await Promise.all([
    verifyOriginSpend(source, originTxHash as Hash, address),
    verifyDestinationCredit(destinationSymbol, destinationTxHash as Hash, address)
  ]);
  if (spent === null) {
    return NextResponse.json(
      { error: `Could not verify the ${source.symbol} spend on ${source.name}` },
      { status: 422 }
    );
  }
  if (received === null) {
    return NextResponse.json(
      { error: `Could not verify the ${destinationSymbol} delivered on Monad` },
      { status: 422 }
    );
  }

  // Both amounts come off the receipts: what was actually paid, and what was
  // actually received. priceUsd is therefore a real fill, not a mark.
  const priceUsd = spent / received;

  try {
    const me = await resolveUser(address);
    const trade = await prisma.trade.create({
      data: {
        userId: me.id,
        tokenSymbol: destinationSymbol,
        side: "BUY",
        amountToken: received,
        amountUsd: spent,
        priceUsd,
        chain: "monad",
        txHash: destinationTxHash,
        source: "CROSS_CHAIN",
        fromChain: source.name
      }
    });
    return NextResponse.json({
      recorded: true,
      tradeId: trade.id,
      symbol: destinationSymbol,
      amountToken: received,
      amountUsd: spent,
      priceUsd,
      fromChain: source.name
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the bridge";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
