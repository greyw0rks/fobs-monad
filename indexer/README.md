# fobs (Monad) indexer — Envio HyperIndex

Real on-chain activity for the fobs terminal on **Monad mainnet (chainId 143)**:
ERC20 transfers for the registry tokens in `../lib/registry.ts`, aggregated into
per-token and per-wallet read models the app queries over GraphQL.

This replaces the app's current feed source (its own recorded trades) with
chain-wide indexing — which is what makes token activity, wallet activity and
portfolio PnL real.

## Files

| File | Purpose |
|---|---|
| `config.yaml` | chain 143 + the registry tokens (`Transfer`) + the Kuru OrderBooks (`Trade`) + the Kuru Router (`MarketRegistered`) |
| `schema.graphql` | `Transfer`, `TokenStats`, `WalletTokenStats`, `KuruTrade`, `KuruMarket` |
| `src/EventHandlers.ts` | the handlers (Envio v2 `indexer.onEvent`) |

## Run locally (no Envio account needed)

```bash
cd indexer
pnpm install
pnpm codegen      # generates .envio/types.d.ts — run before dev/typecheck
pnpm typecheck    # validates handlers against the generated types
pnpm dev          # local indexer + GraphQL playground (needs Docker)
```

`pnpm codegen` and `pnpm typecheck` are verified green here (envio 3.12.1).
`pnpm dev` additionally requires a running **Docker daemon** — envio dev starts a
local Postgres container; without Docker it exits with
`Failed connecting to Docker or Podman`.

Monad is read via HyperSync (`https://monad.hypersync.xyz`), so no RPC is
configured. `start_block` is **not 0**: Monad mainnet is past block 111,000,000
and the six registry tokens emit ~1.32 `Transfer` events per block (measured over
a 100-block sample), so a full-history backfill is roughly 147M events — far past
the hosted Development tier. It currently starts at block 111,050,000
(~54k blocks / ~72k events). Raise it, or run `pnpm dev` locally where there is no
quota, for more history.

## Deploy to Envio Cloud (free dev tier)

Deploys come from a **GitHub repo on an `envio` branch**, via the `envio-cloud`
CLI:

```bash
npm install -g envio-cloud
envio-cloud login                 # authenticates via GitHub
git checkout -b envio && git push -u origin envio
envio-cloud indexer add --name fobs-monad-indexer --repo <owner>/<repo>
envio-cloud deployment status
```

Then set the app's `ENVIO_INDEXER_URL` to the deployed GraphQL endpoint.

The indexer is already added on Envio Cloud: repo `fobs-monad`, active branch
`envio`, **root directory `indexer`** (not `./` — the repo root holds the Next
app's `package.json` and no `config.yaml`), config file `config.yaml`,
Development plan. Envio deploys on **push to `envio`**, so a deployment only
starts once a commit lands on that branch after the indexer was added.

## Kuru swap indexing

Kuru's OrderBook emits a `Trade` event on every fill. Indexing it is what turns
the feed from "tokens moved" into "trades happened". It is wired up and
**verified against live chain data** — but read the two caveats below before
trusting a number out of it.

**The published ABI is wrong; the chain is right.** Kuru's own docs show
`Trade(uint40, address indexed maker, bool, uint32 price, uint96, address
indexed taker, address indexed origin, uint96)` — that signature hashes to
topic0 `0xf701de79…`, which **never appears on Monad**. The deployed contract
emits `price` as **`uint256`** and indexes **nothing**, giving topic0
`0xf16924fb…` (confirmed by decoding 14 live logs; every one carries exactly 1
topic and 8 data words). The published `@devasher/kuru-sdk` is stale too — its
`MarketRegistered` has 11 params where the deployed Router emits **12**.
Because no `Trade` argument is indexed, these logs can only be filtered by
contract address, which is why `config.yaml` lists the OrderBooks explicitly.

| | Address |
|---|---|
| Kuru Router (market factory) | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` |
| MON/USDC OrderBook | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` |
| MON/AUSD OrderBook | `0x131a2e70a5b31a517a74b8c567149bc294470da9` |

Both markets were deployed around block **43.6M**, far below `start_block`
(111,050,000), so only fills from `start_block` forward are indexed. Their
`MarketRegistered` events are outside the window, which is why the handler
carries a verified constant for MON/USDC's pair (decoded from that market's own
creation tx, `0x85f4b267…`) instead of relying on the Router. New markets are
picked up from `MarketRegistered` normally.

### The numbers are raw, on purpose

Every `KuruTrade` amount is stored exactly as emitted. **The scaling is not
established**, so no human amount and no USD value is computed — a converted
figure here would be a guess with a decimal point in front of it.

What the Router declares for MON/USDC (`MarketRegistered`, decoded on-chain):
`pricePrecision 1e8`, `sizePrecision 1e10`, `tickSize 100`, `minSize 2e12`,
`maxSize 2e18`, both fee bps `0`, `kuruAmmSpread 30`.

Against one real fill (`price = 28,702,000,000,000,000`,
`filledSize = 874,664,483,311`):

- **`price` looks like 1e18-scaled and quote-per-base.** `price / 1e18 =
  0.028702` against a live MON price of **$0.028754** — 0.18% apart. Compelling,
  but it is one fill on one market, and `pricePrecision` says 1e8 rather than
  1e18, so it is not yet a verified rule.
- **`filledSize` has no reading that survives.** `filledSize / sizePrecision(1e10)
  = 87.466` base units (≈$2.51 at the live price); `filledSize / 1e18 =
  8.75e-7`. The candidates differ by five orders of magnitude and nothing
  independent distinguishes them.

Settle both by decoding more fills across both markets and checking the implied
notional against the pair's real price — then, and only then, divide.

### Not deployed

The handler is green under `pnpm codegen` and `pnpm typecheck` (envio 3.12.1),
but it has **not been pushed to Envio Cloud.** A push triggers a *new
deployment*, which re-syncs from `start_block` and re-spends the Development
tier's 100k-event budget from zero — the current deployment already spends ~82k
on transfers alone, so a redeploy is likely to blow the soft limit and get the
deployment deleted rather than upgraded. Raise `start_block` (or move to a local
`envio dev` / paid plan) before pushing.

