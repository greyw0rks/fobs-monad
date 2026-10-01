# fobs · Monad

A **social trading terminal for Monad** with cross-chain liquidity abstraction.
Dark, dense, Bloomberg-style. It proves one loop end to end:

> **See a trade → understand why it matters → fund from another chain → execute on Monad → see the position → share the trade.**

The bridge is infrastructure; the trade is the product.

---

## The loop

```
 Landing ─► Connect wallet ─► Feed ───────────────► Token page ─► Trade drawer
   │            (Monad)      (live social      (price, chart,   (you-pay, funding
   │                          timeline +         activity,        source, route,
   │                          trending)          Fobs Signal)     execute)
   │                                                                   │
   └──────────────────  Share card ◄── Portfolio ◄── position ◄───────┘
                        (/share/[id])   (holdings, PnL)   (filled)
```

Three pillars: **Discover** (feed, trending, token activity), **Trade**
(Monad-native swap with cross-chain funding abstracted away), **Follow**
(wallets, profiles, notifications, shareable trade cards).

## Architecture

Single Next.js 16 app (App Router). Wallet address = identity (no auth). The
whole social + trading surface is read from **one activity graph** (`Trade`
rows); stats like Fobs Signal are **computed at read time**, never stored.

```
app/
  page.tsx              public landing
  share/[id]/           public, shareable trade card (OG metadata)
  (app)/                the terminal: feed, explore, token/[symbol],
                        portfolio, profile/[username], following, notifications
  api/                  force-dynamic routes: feed, trending, tokens, candles,
                        traders, follow, portfolio, trade/{quote,execute,[id]}, search
lib/
  db.ts                 Prisma singleton + tryDb() soft-degrade (empty state if no DB)
  wagmi.ts              Monad testnet via viem defineChain (chainId 10143)
  route.ts              LI.FI-style quote engine + execution state machine (simulated)
  signal.ts             Fobs Signal — deterministic momentum score (0–100), NOT a prediction
  feed/portfolio/profile/tokens/format.ts
prisma/
  schema.prisma         Postgres: User, Follow, Token, Trade, Position, Notification
  seed.ts               the demo engine — tokens, traders, follows, 24h trades, portfolio
contracts/
  FobsRouter.sol        minimal settlement router (swap/swapAndSend/executeRoute → TradeExecuted)
```

### Fobs Signal

A deterministic momentum score (0–100) computed from the last 48h of trades:
volume, buyer growth, unique-wallet growth, buy pressure, and notable-trader
activity. It is **Fobs' own metric, not a price prediction** — labelled as such
everywhere it appears.

### Trading is simulated

All execution is simulated server-side — **no funds move**. `trade/execute`
persists a `Trade` + updates the `Position` and returns a receipt with a
synthetic tx hash. The route engine (`lib/route.ts`) models a LI.FI-style quote
(price impact, bridge/gas fees, slippage, duration) and a
`QUOTING → ROUTE_FOUND → BRIDGING → SWAPPING → CONFIRMED` state machine. This is
a conscious demo choice: real wallet connect to Monad testnet, zero dependency
on live RPC/DEX liquidity. Swapping in a real integration is a drop-in.

## Stack

Next 16 · React 19 · TypeScript · Tailwind 3.4 (preflight off, hand-authored
reset) · wagmi 2 + viem 2 · TanStack Query 5 · recharts 3 · motion 13 ·
Prisma 6 + PostgreSQL · zod 4 · lucide-react. Fonts: Inter (`--font-sans`) +
JetBrains Mono (`--font-mono`, for every number/address/hash).

## Setup

```bash
pnpm install           # or npm install
cp .env.example .env   # set DATABASE_URL (Postgres/Neon); optionally SEED_ADDRESS
pnpm prisma generate
pnpm db:push           # push the schema
pnpm seed              # build the demo activity graph
pnpm dev               # http://localhost:3000
```

Environment (`.env`):

| Var                          | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`               | Postgres connection. App soft-degrades to empty state if unset.  |
| `NEXT_PUBLIC_MONAD_RPC_URL`  | Monad testnet RPC (public default used if unset).                |
| `SEED_ADDRESS`               | Your wallet — seeds a portfolio + notifications for it.          |
| `SEED_USERNAME` / `SEED_DISPLAY_NAME` | Optional handle/name for the demo user.                 |
| `NEXT_PUBLIC_BASE_URL`       | Base URL for share links.                                        |

> No `DATABASE_URL`? The app still builds and runs — it just shows empty state.
> The demo needs the seed, so a local Postgres or Neon URL is required to see
> activity. SQLite is a one-line swap (`provider = "sqlite"` in the schema,
> `DATABASE_URL="file:./dev.db"`).

## Verify

```bash
pnpm typecheck     # tsc --noEmit
pnpm build         # prisma generate && next build
```

Then walk the loop: landing → connect wallet → feed → a token page → **BUY** →
pick a funding source (Base USDC = cross-chain) → watch the route + execution
states → see the position in `/portfolio` → open the share card.

Smart contract (optional, needs [Foundry](https://getfoundry.sh)):

```bash
cd contracts && forge install foundry-rs/forge-std && forge test -vvv
```

## Not building

No custom AMM, bridge, launchpad, copy-trading, lending, perps, governance,
DAO, NFTs, AI agent, multi-chain wallet, or analytics suite. The live indexer is
deferred (the seed stands in); `FobsRouter.sol` ships as a tested reference
artifact rather than a mandatory deploy. Scope is the loop above, done well.
