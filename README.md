# fobs · Monad

A **social trading terminal for Monad mainnet**. Dark, dense, Bloomberg-style.
It proves one loop end to end:

> **See a trade → understand why it matters → execute on Monad → see the position → share the trade.**

Every number is real and every trade is a real transaction the user signs in
their own wallet. There is no demo data, no simulated execution, and no
server-side signing.

---

## The loop

```
 Landing ─► Connect wallet ─► Feed ───────────────► Token page ─► Trade drawer
   │        (Monad mainnet)  (social timeline    (live price,    (real 0x quote →
   │                          of real swaps)      live OHLCV,      approve + sign in
   │                                             Fobs Signal)     your own wallet)
   │                                                                   │
   └──────────────────  Share card ◄── Portfolio ◄────────────────────┘
                        (/share/[id])  (live on-chain   (tx confirms on Monad,
                                        balances)        server verifies receipt)
```

Three pillars: **Discover** (feed, trending, token activity), **Trade**
(Monad-native swaps routed through 0x), **Follow** (wallets, profiles,
notifications, shareable trade cards).

## Architecture

Single Next.js 16 app (App Router). Wallet address = identity (no auth).

- **Reads** come from one activity graph (`Trade` rows) plus live market data.
- **Market numbers are never stored.** `lib/market.ts` fetches price / 24h /
  volume / mcap / liquidity from GeckoTerminal at request time and merges them
  over token identity; a `null` renders as an em dash, never a fake zero.
- **Execution is client-signed.** The server calls 0x for calldata and returns
  it unsigned; the user approves and signs in their wallet. The server never
  holds a key.

```
app/
  page.tsx              public landing
  share/[id]/           public, shareable trade card (OG metadata)
  (app)/                the terminal: feed, explore, token/[symbol],
                        portfolio, profile/[username], following, notifications
  api/                  force-dynamic routes: feed, trending, tokens, candles,
                        traders, follow, portfolio, trade/{quote,record,[id]}, search
lib/
  chain.ts              Monad mainnet (chainId 143) — shared by client + server
  wagmi.ts              wagmi config (mainnet, injected wallets only)
  registry.ts           the ONLY source of token addresses + decimals (verified)
  market.ts             live price / volume / mcap / liquidity + OHLCV
  zerox.ts              0x Swap API v2 client (server-only; quotes, never signs)
  onchain.ts            read-only viem client: balances + receipt verification
  session.ts            wallet → User (identity)
  signal.ts             Fobs Signal — momentum score (0–100), NOT a prediction
  feed/portfolio/profile/tokens/format.ts
prisma/
  schema.prisma         Postgres: User, Follow, Token, Trade, Position, Notification
  seed-registry.ts      loads the verified token list; clears the old demo graph
contracts/
  FobsRouter.sol        reference artifact only — NOT on the trading path
```

### Fobs Signal

A deterministic momentum score (0–100) computed from the last 48h of trades:
volume, buyer growth, unique-wallet growth, buy pressure, and notable-trader
activity. It is **Fobs' own metric, not a price prediction** — labelled as such
everywhere it appears.

### How a trade executes

1. The drawer asks `/api/trade/quote`; the server quotes 0x (`chainId=143`,
   `allowance-holder`) and returns an **unsigned** transaction plus the ERC20
   spender that needs approval.
2. The client approves the spender (if short) and sends the swap — both signed
   in the user's wallet.
3. On confirmation the client posts the tx hash to `/api/trade/record`; the
   server re-reads the receipt over the public RPC, derives the real token/USD
   amounts from the Transfer logs (and the native leg), and writes the `Trade`.
   Amounts come from the chain, never from the client.

## Stack

Next 16 · React 19 · TypeScript · Tailwind 3.4 (preflight off, hand-authored
reset) · wagmi 2 + viem 2 · TanStack Query 5 · recharts 3 · motion 13 ·
Prisma 6 + PostgreSQL · zod 4 · lucide-react. Fonts: Inter (`--font-sans`) +
JetBrains Mono (`--font-mono`, for every number/address/hash).

## Setup

```bash
pnpm install
cp .env.example .env   # set DATABASE_URL, ZEROX_API_KEY
./node_modules/.bin/prisma generate
pnpm db:push           # push the schema
pnpm seed              # load the verified token registry (no market numbers)
pnpm dev               # http://localhost:3000
```

Environment (`.env`):

| Var                         | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`              | Postgres (Neon) connection. App degrades to honest empty states if unset. |
| `ZEROX_API_KEY`             | **Server-only.** Swap routing on Monad. Free key: dashboard.0x.org.  |
| `NEXT_PUBLIC_MONAD_RPC_URL` | Monad mainnet RPC (public default used if unset).                    |
| `NEXT_PUBLIC_BASE_URL`      | Base URL for share links.                                            |

## Verify

```bash
pnpm typecheck     # tsc --noEmit
pnpm build         # prisma generate && next build
```

Then walk the loop with a **funded Monad wallet**: connect → switch to Monad →
confirm live prices render → execute a small USDC→token swap → approve + sign
in-wallet → watch it confirm on [monadscan](https://monadscan.com) → see it in
`/portfolio` and the feed. Start with a few dollars.

## Security

- The server never custodies keys and never signs. `lib/onchain.ts` and every
  provider call are read-only / quote-only.
- `ZEROX_API_KEY` is server-only and proxied through our API routes.
- Chain is enforced: the trading UI blocks unless the wallet is on chainId 143.
- The exact token, amount, minimum received (slippage) and fees are shown before
  the user signs. `/api/trade/record` trusts the on-chain receipt, not the client.
- No custom fund-touching contract is deployed. If that ever changes, a
  professional audit comes first.

## Status

- **M1 (this build):** mainnet config, live market data, 0x quotes, client-signed
  execution, receipt-verified trade records, live on-chain portfolio.
- **M2 (next):** an on-chain indexer (Envio HyperIndex) to populate the social
  feed from real Monad DEX swaps. Until it lands, the feed shows only trades
  recorded through this app.
- **M3:** LI.FI cross-chain funding.
- **Deferred:** PnL. A real cost basis needs reconstructed history; the portfolio
  says so rather than inventing an average entry. `Position` is kept for that
  milestone.
- `FobsRouter.sol` ships as a tested reference artifact, not a deploy.
