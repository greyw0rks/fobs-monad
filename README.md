# fobs · Monad

A **social trading terminal for Monad mainnet**. Dark, dense, Bloomberg-style.

It proves one loop end to end:

> **See a trade → understand why it matters → execute on Monad → see the position → share the trade.**

Every number is real and every trade is a real transaction the user signs in
their own wallet. There is no demo data, no simulated execution, and no
server-side signing.

Built on Next 16 · React 19 · TypeScript · wagmi 2 + viem 2 · Prisma 6 +
PostgreSQL.

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
(Monad-native swaps), **Follow** (wallets, profiles, notifications, shareable
trade cards).

## What makes it different

- **Wallet address is the identity.** No signup, no email, no password. Connect
  and you have a profile, a portfolio, and a following graph.
- **Nothing is fabricated.** Market numbers are never stored or seeded — they
  are fetched live and merged over verified token identity. A figure the
  provider does not have renders as an em dash, never as a fake zero. The same
  rule runs through the portfolio, the feed, and every panel: where a number is
  unknown, the app says so instead of inventing one.
- **The server never holds a key and never signs.** It quotes, returns calldata,
  and reads receipts. The user signs everything.
- **Amounts come off the chain, not the client.** A recorded trade's token and
  USD amounts are derived from the transaction receipt, so what lands in the
  feed is what actually settled.
- **A transfer is not a trade.** Chain-wide token movements are shown in their
  own panel, deliberately separated from the trade feed rather than blended
  into it.

## Architecture

Single Next.js 16 app (App Router). Reads come from one activity graph (`Trade`
rows) plus live market data fetched at request time.

```
app/
  page.tsx              public landing
  share/[id]/           public, shareable trade card (OG metadata)
  (app)/                the terminal: feed, explore, token/[symbol],
                        portfolio, profile/[username], following, notifications
  api/                  force-dynamic routes: feed, trending, tokens, candles,
                        traders, follow, portfolio, search,
                        trade/{quote,record,[id]}, bridge/{quote,status,record}
lib/
  chain.ts              Monad mainnet (chainId 143) — shared by client + server
  registry.ts           the ONLY source of token addresses + decimals (verified)
  market.ts             live price / volume / mcap / liquidity + OHLCV
  kuru.ts               Kuru Flow client — the PRIMARY swap venue
  zerox.ts              0x Swap API v2 client — the FALLBACK when Kuru has no route
  swap.ts               venue selection: Kuru first, then 0x
  onchain.ts            read-only viem client: balances + receipt verification
  relay.ts              cross-chain funding INTO Monad — PRIMARY (keyless)
  aurora.ts             Aurora Intents — fallback (lists Monad assets, cannot route them)
  bridge-verify.ts      reads BOTH legs of a bridge off receipts — spend + Monad credit
  indexer.ts            Envio HyperIndex client — chain-wide transfers (read-only)
  cost-basis.ts         average-cost reconstruction (pure arithmetic)
  labels.ts             Nansen wallet labels / smart money
  signal.ts             Fobs Signal — momentum score (0–100), NOT a prediction
indexer/                Envio HyperIndex — chain-wide ERC20 + Kuru trade activity
prisma/
  schema.prisma         Postgres: User, Follow, Token, Trade, Position, Notification
```

### Fobs Signal

A deterministic momentum score (0–100) computed from the last 48h of trades:
volume, buyer growth, unique-wallet growth, buy pressure, and notable-trader
activity. It is **Fobs' own metric, not a price prediction** — labelled as such
everywhere it appears.

### How a trade executes

1. The drawer asks for a quote. The server tries **Kuru** first — the
   Monad-native venue — and falls back to **0x** when Kuru has no route for the
   pair. Either way it returns an **unsigned** transaction plus the ERC20
   spender that needs approval, and names the venue that answered.
2. The client approves the spender (if short) and sends the swap — both signed
   in the user's wallet.
3. On confirmation the client posts the tx hash back; the server re-reads the
   receipt over the public RPC, derives the real token/USD amounts from the
   Transfer logs (and the native leg), and records the trade.

## Funding from another chain

A wallet with USDC on Base, Ethereum, Arbitrum or BSC can fund itself on Monad
without leaving the app. **Relay** is the primary provider and the one that
actually routes to Monad; Aurora Intents is wired as a fallback and answers
honestly when it cannot route. The user signs the deposit in their own wallet —
fobs still never custodies anything.

When a bridge delivers, the app records it as a real trade **only after
verifying both legs from receipts**: the USDC actually spent on the origin
chain, and the token actually credited on Monad. The destination transaction
hash is taken from the provider's own status, never from the client, so a
caller cannot point the app at an unrelated transfer. A same-asset bridge is
refused outright — moving USDC between chains is a transfer, not a trade.

## Portfolio and PnL

Holdings are the wallet's live on-chain balances, priced at current market
rates.

PnL is an **average cost basis reconstructed from the trades recorded in fobs**
— the only fills attributable to a wallet. It is deliberately narrow, and it
says how narrow:

- A position that was not bought through fobs gets **no** basis rather than a
  guessed one.
- Recorded history containing a sell with no matching buy is treated as
  incomplete and **dropped**, not averaged into a confident-looking number.
- PnL travels with a **coverage** figure — the share of the portfolio the basis
  actually explains — so a PnL covering 20% of a portfolio is never read as
  covering all of it.
- If the trade history cannot be read at all, that is reported as unavailable,
  which is a different fact from having no trades.

## Security

- The server never custodies keys and never signs. Every provider call is
  read-only or quote-only.
- Provider API keys are server-only and proxied through our API routes.
- Chain is enforced: the trading UI blocks unless the wallet is on chainId 143.
- The exact token, amount, minimum received (slippage) and fees are shown before
  the user signs. Trade amounts are trusted from the on-chain receipt, not from
  the client.
- No custom fund-touching contract is deployed. If that ever changes, a
  professional audit comes first.

## Status

- **M1 — trading:** mainnet config, live market data, Kuru-routed quotes with an
  automatic 0x fallback, client-signed execution, receipt-verified trade
  records, live on-chain portfolio.
- **M2 — chain-wide indexer:** an Envio HyperIndex deployment indexes ERC20
  activity for the registry tokens, surfaced on token pages as **Chain
  activity** — a *transfers* read model, kept separate from the trade feed. The
  hosted deployment runs on Envio's free Development tier and is therefore
  **temporary**; see `indexer/README.md`. Kuru `Trade` indexing is written and
  verified against the deployed contract but not yet pushed.
- **M3 — cross-chain funding:** Relay primary, Aurora Intents fallback, with
  two-leg receipt verification before anything is recorded.
- **PnL:** average cost over recorded trades, with coverage.

## What is not proven

Stated plainly, because these are gaps rather than features:

- **No trade has ever been recorded.** The database holds zero trades, so the
  cost basis has never run against real history — only the arithmetic is tested
  (9 hand-computed cases) and the wiring is verified up to the point where
  history is required.
- **No bridge has completed end to end.** Both verifiers are exercised against
  real Monad and Base receipts, but a live deposit needs a funded wallet signing
  on a source chain.
- **The Kuru `Trade` numbers are raw.** Their scaling is not established, so
  they are stored unconverted rather than shown with a decimal point that would
  be a guess. See `indexer/README.md`.
- **Nansen labels are honest-empty.** The adapter is wired, but real labels need
  a paid key and confirmed Monad coverage.

Running the app, environment variables and verification steps live in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
