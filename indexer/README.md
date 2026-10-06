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
| `config.yaml` | chain 143 + the registry token addresses + the `Transfer` event |
| `schema.graphql` | `Transfer`, `TokenStats`, `WalletTokenStats` entities |
| `src/EventHandlers.ts` | the `Transfer` handler (Envio v2 `indexer.onEvent`) |

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
configured. `start_block: 0` indexes the full history for the six tokens — narrow
it if you want a faster first sync.

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

> **Blocked on:** an Envio account + a GitHub repo for this project. The repo
> currently has no git remote.

## Still to add

- **Kuru swap indexing.** The OrderBook emits
  `Trade(uint40 orderId, address indexed maker, bool isBuy, uint32 price, uint96 updatedSize, address indexed taker, address indexed origin, uint96 filledSize)`
  on each market (discovered via the Router's `MarketRegistered`). This is
  **documented but not yet verified against the deployed contract** — a guessed
  ABI would silently index nothing, so it is deliberately omitted until the
  signature is confirmed against Monadscan / the Kuru ABI.
