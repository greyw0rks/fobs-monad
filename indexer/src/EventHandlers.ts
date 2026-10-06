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

// Kuru swap indexing — the OrderBook emits
//   Trade(uint40 orderId, address indexed maker, bool isBuy, uint32 price,
//         uint96 updatedSize, address indexed taker, address indexed origin,
//         uint96 filledSize)
// on each market (discovered via the Router's MarketRegistered). Left out until
// the signature is verified against the deployed OrderBook: shipping a guessed
// ABI would silently index nothing. See indexer/README.md.
