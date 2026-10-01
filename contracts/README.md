# FobsRouter

Minimal settlement router for the Fobs social trading terminal on **Monad**.

It is deliberately **not** a DEX, AMM, or bridge. It does one job: route an
input token through a whitelisted swap adapter and emit a single canonical
`TradeExecuted` event. That event is the on-chain source of truth a live Fobs
indexer would consume to build the activity graph (feed, profiles, token
activity, Fobs Signal). Cross-chain funding is resolved off-chain by a
LI.FI-style route engine (`lib/route.ts`); by the time value lands here on
Monad, the trade is a local swap.

```
off-chain route engine (quote → bridge)  ──►  FobsRouter.executeRoute(...) on Monad  ──►  TradeExecuted
```

## Entry points

| Function        | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `swap`          | Swap `tokenIn → tokenOut` for the caller on Monad.             |
| `swapAndSend`   | Same, but deliver the output to a different recipient.         |
| `executeRoute`  | Settle a cross-chain route; carries the originating chain id.  |

All three funnel into one internal `_execute` and emit `TradeExecuted(trader, tokenOut, tokenIn, amountIn, amountOut, recipient, srcChainId, routeId)`.

## Status in this build

The demo app **simulates execution server-side — no funds move** (see
`app/api/trade/execute/route.ts`). This contract is therefore a reviewed
reference artifact, not a mandatory live deploy: the app mirrors the
`TradeExecuted` shape conceptually rather than calling a deployed router. Swap
mechanics are delegated to `ISwapAdapter`, so wiring a real Monad aggregator is
a drop-in — the router itself stays liquidity-agnostic.

## Build & test (Foundry)

```bash
# From contracts/ with Foundry installed (https://getfoundry.sh):
forge install foundry-rs/forge-std   # provides forge-std/Test.sol
forge build
forge test -vvv
```

`test/FobsRouter.t.sol` covers: adapter-required constructor guard, the
`TradeExecuted` emission on `swap`, zero-amount and slippage reverts, and that
`executeRoute` carries the source chain id. If Foundry is not installed, the
source is delivered as-is — it is self-contained and dependency-free apart from
`forge-std` in tests.

## Security notes

- Adapter is set once at construction and is the only external call surface.
- `minAmountOut` is enforced after the adapter returns (`SlippageExceeded`).
- No admin keys, no upgradeability, no custody between calls — funds pass
  straight through to the adapter/recipient within a single transaction.
