import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, dbConfigured } from "@/lib/db";
import { resolveUser } from "@/lib/session";
import { verifySwap } from "@/lib/onchain";
import { bySymbol, QUOTE_SYMBOL } from "@/lib/registry";
import { authAction } from "@/lib/auth-message";
import { verifyAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  nonce: z.string(), // proof that `address` published this trade
  signature: z.string()
});

// POST /api/trade/record — after the user's swap confirms on Monad, verify the
// receipt on-chain and persist the real Trade. Amounts come from the chain, NOT
// from client claims. Idempotent: a given txHash is recorded at most once.
//
// The receipt check already binds the tx to its sender, so a valid signature is
// not what authenticates the TRADE — it authorises the WRITE, i.e. it is what
// stops someone publishing another wallet's activity into that wallet's profile.
export async function POST(request: Request) {
  if (!dbConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { txHash, symbol, side } = parsed.data;
  const address = parsed.data.address.toLowerCase();

  const auth = await verifyAuth({
    address: parsed.data.address,
    action: authAction.publishTrade(txHash),
    nonce: parsed.data.nonce,
    signature: parsed.data.signature
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });


  const existing = await prisma.trade.findUnique({ where: { txHash } }).catch(() => null);
  if (existing) {
    return NextResponse.json({
      tradeId: existing.id,
      txHash: existing.txHash,
      amountToken: existing.amountToken,
      amountUsd: existing.amountUsd,
      priceUsd: existing.priceUsd,
      symbol: existing.tokenSymbol
    });
  }

  const subject = bySymbol(symbol);
  const quote = bySymbol(QUOTE_SYMBOL);
  if (!subject || !quote) return NextResponse.json({ error: `Unsupported token ${symbol}` }, { status: 404 });

  const verified = await verifySwap(txHash as `0x${string}`, address as `0x${string}`);
  if (!verified) return NextResponse.json({ error: "Transaction not found on Monad yet" }, { status: 404 });
  if (!verified.success) return NextResponse.json({ error: "Transaction reverted on-chain" }, { status: 422 });
  if (verified.from.toLowerCase() !== address) {
    return NextResponse.json({ error: "Transaction was not sent by this wallet" }, { status: 422 });
  }

  // Subject leg: ERC20 delta from logs, or the native leg (with its exactness flag).
  let subjectDelta: number;
  if (subject.isNative) {
    if (!verified.nativeExact && verified.nativeDelta === 0) {
      return NextResponse.json(
        { error: "Could not verify the native MON leg of this transaction" },
        { status: 422 }
      );
    }
    subjectDelta = verified.nativeDelta;
  } else {
    subjectDelta = verified.erc20Deltas.get(subject.address.toLowerCase()) ?? 0;
  }

  const usdcDelta = verified.erc20Deltas.get(quote.address.toLowerCase()) ?? 0;

  const bought = side === "BUY";
  const ok = bought ? subjectDelta > 0 && usdcDelta < 0 : subjectDelta < 0 && usdcDelta > 0;
  if (!ok) {
    return NextResponse.json(
      { error: "On-chain amounts don't match the claimed trade" },
      { status: 422 }
    );
  }

  const amountToken = Math.abs(subjectDelta);
  const amountUsd = Math.abs(usdcDelta);
  if (amountToken <= 0 || amountUsd <= 0) {
    return NextResponse.json({ error: "Could not derive trade amounts from the receipt" }, { status: 422 });
  }
  const priceUsd = amountUsd / amountToken;

  try {
    const me = await resolveUser(address);
    const trade = await prisma.trade.create({
      data: {
        userId: me.id,
        tokenSymbol: subject.symbol,
        side,
        amountToken,
        amountUsd,
        priceUsd,
        chain: "monad",
        txHash,
        source: "SWAP"
      }
    });
    return NextResponse.json({
      tradeId: trade.id,
      txHash: trade.txHash,
      amountToken,
      amountUsd,
      priceUsd,
      symbol: subject.symbol
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record trade";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
