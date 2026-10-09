// fobs (Monad) indexer — event handlers (Envio HyperIndex v2 API).
//
// One ERC20 Transfer handler fans out into three read models: the raw Transfer,
// a per-token aggregate, and a per-(wallet, token) net position. Everything is
// derived from the chain — no app input, no seeded numbers.
//
// API note: v2 registers handlers with `indexer.onEvent(...)` and mutates state
// through the context entity API (`context.Entity.set(...)`), which is
// synchronous. Run `pnpm codegen` to generate types before `pnpm dev`.

import { indexer } from "envio";

const ZERO = BigInt(0);

indexer.onEvent({ contract: "ERC20", event: "Transfer" }, async ({ event, context }) => {
  const token = event.srcAddress.toLowerCase();
  const from = event.params.from.toLowerCase();
  const to = event.params.to.toLowerCase();
  const value = event.params.value;
  const blockNumber = event.block.number;
  const timestamp = event.block.timestamp;

  // 1. The raw transfer.
  context.Transfer.set({
    id: `${event.chainId}_${blockNumber}_${event.logIndex}`,
    token,
    from,
    to,
    value,
    blockNumber,
    timestamp
  });

  // 2. Per-token aggregate.
  const t = await context.TokenStats.get(token);
  context.TokenStats.set({
    id: token,
    transfers: (t?.transfers ?? 0) + 1,
    volume: (t?.volume ?? ZERO) + value,
    lastUpdated: timestamp
  });

  // 3. Per-(wallet, token) net position for each side of the transfer.
  const bump = async (wallet: string, sent: boolean) => {
    const id = `${wallet}_${token}`;
    const w = await context.WalletTokenStats.get(id);
    context.WalletTokenStats.set({
      id,
      wallet,
      token,
      sent: (w?.sent ?? ZERO) + (sent ? value : ZERO),
      received: (w?.received ?? ZERO) + (sent ? ZERO : value),
      transfers: (w?.transfers ?? 0) + 1,
      lastUpdated: timestamp
    });
  };
  await bump(from, true);
  await bump(to, false);
});

// Kuru swap indexing. The OrderBook emits
//   Trade(uint40 orderId, address maker, bool isBuy, uint256 price,
//         uint96 updatedSize, address taker, address origin, uint96 filledSize)
// on each market, with NO argument indexed (verified against live logs — the
// published docs show a `uint32 price` with indexed args and are simply wrong).
//
// These numbers are stored RAW — exactly as emitted, so no precision is lost
// here. The scaling into human numbers is established and tested, but it lives
// in one place in the app (../lib/kuru-fill.ts), not here: the indexer's job is
// to hold the exact fill (count, direction, counterparties, market, raw price
// and sizes), and the app's job is to read it. Keeping the division out of the
// indexer keeps a redeploy from re-encoding a scaling rule into stored data.

/** A verified pair for a market registered before the indexer's start block. */
const SEEDED_MARKETS: Record<string, { base: string; quote: string }> = {
  // Decoded from the Router's own MarketRegistered log in this market's creation
  // tx (0x85f4b267…, block 43,660,999) — read off the chain, not from a docs page.
  "0x065c9d28e428a0db40191a54d33d5b7c71a9c394": {
    base: "0x0000000000000000000000000000000000000000", // native MON
    quote: "0x754704bc059f8c67012fed69bc8a327a5aafb603" // USDC
  }
};

indexer.onEvent({ contract: "KuruRouter", event: "MarketRegistered" }, async ({ event, context }) => {
  const market = event.params.market.toLowerCase();
  const existing = await context.KuruMarket.get(market);
  context.KuruMarket.set({
    id: market,
    baseAsset: event.params.baseAsset.toLowerCase(),
    quoteAsset: event.params.quoteAsset.toLowerCase(),
    vault: event.params.vaultAddress.toLowerCase(),
    pricePrecision: event.params.pricePrecision,
    sizePrecision: event.params.sizePrecision,
    tickSize: event.params.tickSize,
    minSize: event.params.minSize,
    maxSize: event.params.maxSize,
    takerFeeBps: event.params.takerFeeBps,
    makerFeeBps: event.params.makerFeeBps,
    kuruAmmSpread: event.params.kuruAmmSpread,
    registeredAt: event.block.timestamp,
    trades: existing?.trades ?? 0
  });
});

indexer.onEvent({ contract: "KuruOrderBook", event: "Trade" }, async ({ event, context }) => {
  const market = event.srcAddress.toLowerCase();
  const blockNumber = event.block.number;

  // Resolve the pair: the Router's own declaration if we indexed it, otherwise
  // the verified constant for a market that predates `start_block`. Anything
  // else stays null rather than being labelled with a guessed pair.
  const declared = await context.KuruMarket.get(market);
  const seeded = SEEDED_MARKETS[market];
  const baseAsset = declared?.baseAsset ?? seeded?.base ?? undefined;
  const quoteAsset = declared?.quoteAsset ?? seeded?.quote ?? undefined;

  context.KuruTrade.set({
    id: `${event.chainId}_${blockNumber}_${event.logIndex}`,
    market,
    baseAsset,
    quoteAsset,
    orderId: event.params.orderId,
    maker: event.params.maker.toLowerCase(),
    taker: event.params.taker.toLowerCase(),
    origin: event.params.origin.toLowerCase(),
    isBuy: event.params.isBuy,
    price: event.params.price,
    updatedSize: event.params.updatedSize,
    filledSize: event.params.filledSize,
    blockNumber,
    timestamp: event.block.timestamp
  });

  if (declared) {
    context.KuruMarket.set({ ...declared, trades: declared.trades + 1 });
  }
});

