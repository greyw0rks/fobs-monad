import { NextResponse } from "next/server";
import { getToken } from "@/lib/tokens";
import { bySymbol } from "@/lib/registry";
import { getTokenActivity } from "@/lib/feed";
import { getSignal } from "@/lib/signal";
import { getTokenSmartMoney } from "@/lib/labels";
import { getChainActivity, getKuruTrades, assetSymbol } from "@/lib/indexer";
import { marketsForToken } from "@/lib/kuru-fill";

export const dynamic = "force-dynamic";

// GET /api/tokens/[symbol]
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const token = await getToken(symbol);
  if (!token) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  // The verified Kuru markets this token trades in. A token in none of them has
  // no order book to show, which is why the card is absent rather than empty.
  // The registry's own isNative flag, not a guess from the address: MON's DTO
  // address is its WMON wrapper, while the market recorded the native sentinel.
  const market = marketsForToken(token.address, bySymbol(token.symbol)?.isNative ?? false)[0] ?? null;

  const [activity, signal, smartMoney, chainActivity, kuruTrades] = await Promise.all([
    getTokenActivity(token.symbol, 30),
    getSignal(token.symbol),
    // null when Nansen is unconfigured / has no Monad coverage — rendered as nothing.
    getTokenSmartMoney(token.address).catch(() => null),
    // Raw on-chain transfers (Envio), a different thing from `activity` above.
    // null when the indexer is unconfigured or did not answer — rendered as nothing.
    getChainActivity(token).catch(() => null),
    // Real fills from the OrderBook (Envio). null when the indexer did not answer
    // OR when it has no Kuru entity at all — the card is absent in both cases.
    market ? getKuruTrades(market[0]).catch(() => null) : Promise.resolve(null)
  ]);

  return NextResponse.json({
    token,
    activity,
    signal,
    smartMoney,
    chainActivity,
    kuruTrades,
    kuruMarket: market
      ? {
          address: market[0],
          baseSymbol: assetSymbol(market[1].baseAsset),
          quoteSymbol: assetSymbol(market[1].quoteAsset)
        }
      : null
  });
}
