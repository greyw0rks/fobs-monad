# Development

Running fobs locally, environment variables, and how to verify a change.
For what the app *is*, see the [README](../README.md).

## Setup

```bash
pnpm install
cp .env.example .env   # set DATABASE_URL, ZEROX_API_KEY
./node_modules/.bin/prisma generate
pnpm db:push           # push the schema
pnpm seed              # load the verified token registry (no market numbers)
pnpm dev               # http://localhost:3000  (on WSL2 use: pnpm dev:wsl)
pnpm test:pnl          # cost-basis arithmetic (no DB, no network)
```

## Environment

| Var                         | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`              | Postgres (Neon) **pooled** connection used at runtime. App degrades to honest empty states if unset. |
| `DIRECT_URL`                | Neon **unpooled** connection — DDL only (`prisma db push` / `migrate`). |
| `ZEROX_API_KEY`             | **Server-only.** FALLBACK swap routing on Monad. Free key: dashboard.0x.org. |
| `KURU_FLOW_URL`             | Kuru Flow base URL (default `https://ws.kuru.io`). PRIMARY venue; no key. |
| `RELAY_API_URL`             | Relay base URL (default `https://api.relay.link`). Cross-chain funding; no key. |
| `AURORA_INTENTS_API_URL` / `AURORA_INTENTS_API_KEY` | Aurora Intents **fallback**. The appKey is a **path segment** and stays server-side. |
| `ENVIO_INDEXER_URL`         | Envio GraphQL endpoint. Unset → the Chain activity card renders nothing. |
| `NANSEN_API_KEY`            | Nansen labels / smart money. **Paid**; unset → honest-empty, never faked. |
| `NEXT_PUBLIC_MONAD_RPC_URL` | Monad mainnet RPC (public default used if unset).                    |
| `NEXT_PUBLIC_BASE_URL`      | Base URL for share links.                                            |

## Verify

```bash
pnpm typecheck     # tsc --noEmit
pnpm test:pnl      # cost-basis cases
pnpm build         # prisma generate && next build
```

Then walk the loop with a **funded Monad wallet**: connect → switch to Monad →
confirm live prices render → execute a small USDC→token swap → approve + sign
in-wallet → watch it confirm on [monadscan](https://monadscan.com) → see it in
`/portfolio` and the feed. Start with a few dollars.

## WSL2: prices render as "—" unless you use `pnpm dev:wsl`

GeckoTerminal is dual-stack. WSL2 blackholes its IPv6 route, and Node's
Happy-Eyeballs connection autoselection picks that route, so `fetch` to it hangs
and dies with `ETIMEDOUT` while `curl` (which falls back per-address) succeeds.
Every price, and therefore every PnL figure, silently becomes `null`.

`pnpm dev:wsl` sets `NODE_OPTIONS=--no-network-family-autoselection`, which makes
Node take the IPv4 address it already resolved first.

`--dns-result-order=ipv4first` does **not** fix this — autoselection overrides
the ordering. Deployed builds are unaffected.

## Notes

- Run anything touching Postgres, and `pnpm dev`, with the command sandbox
  **disabled** (egress on 5432 is blocked; Google Fonts also fail sandboxed).
- `tsconfig` targets **ES2017**: no `0n` BigInt literals (use `BigInt(0)`), and
  viem's `formatUnits` decimals argument must be a `number`, not a bigint.
- `pnpm build` runs `prisma generate`. If you keep a separate client for dev,
  regenerate it afterwards.
- Pushing to the `envio` branch triggers an Envio indexer **redeploy**, which
  re-syncs from `start_block` and re-spends the Development tier's event budget.
  Read `indexer/README.md` before pushing there.
