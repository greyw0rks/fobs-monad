# fobs-monad — gap-closing plan: Kuru · Aurora · Envio · Nansen

## Context

`~/fobs-monad` is a working Monad social-trading terminal built on **0x Swap API**
(routing), **GeckoTerminal** (prices) and **Postgres/Neon** (its own recorded
trades). An external MVP checklist names four vendors the app does not use —
**Kuru** (swap venue), **Aurora** (cross-chain funding), **Envio** (indexer) and
**Nansen** (labels/smart-money). This plan makes all four real, without
introducing any simulated or fabricated data.

Non-negotiables that stay true (from the M1 build): the server never holds keys
or signs; provider keys are server-only; chainId 143 is enforced before any
trade; trade amounts are derived from the verified on-chain receipt, never from
client claims.

## Status

- ✅ **Stage 1 — Kuru primary venue: DONE & verified** (2026-10-05). `tsc --noEmit`
  clean, `pnpm build` exits 0, and `/api/trade/quote` returns `venue:"kuru"` live
  for both directions: BUY USDC→MON (`value:"0"`, `allowanceTarget` = router
  `0xb3e6…13cb`) and SELL MON→USDC (`sellIsNative:true`,
  `value:"500000000000000000"` = exactly 0.5 MON, `allowanceTarget:null`). 0x
  fallback retains the existing path.
- 🟢 **Stage 2 — Envio: deployed, indexed, and wired into the app.** `indexer/`
  (`config.yaml` chains: 143 + registry tokens, `schema.graphql`,
  `src/EventHandlers.ts`) runs on **Envio Cloud** — repo `fobs-monad`, branch
  `envio`, root dir `indexer`, Development plan — serving GraphQL at
  `indexer.dev.hyperindex.xyz/a521f92/v1/graphql`. Verified live: 39,585 USDC
  transfers and 43k WMON transfers with real block numbers, aggregated into
  `TokenStats` / `WalletTokenStats`. App side: `lib/indexer.ts` (server-only,
  30s TTL, honest-null) feeds a `chainActivity` read model on
  `/api/tokens/[symbol]`, rendered as its own **Chain activity** card — never
  merged into the trade feed, because a transfer is not a trade.
  **Two things to know.** (1) `start_block` is **111,050,000**, not 0: the six
  tokens emit ~1.32 `Transfer` events/block, so full history is ~147M events.
  (2) The Development tier's **100k-event soft limit is cumulative**, so this
  deployment will be grace-period'd then deleted (~10 days) no matter how
  `start_block` is tuned — it is a working proof, not permanent hosting. A
  permanent indexer needs local `envio dev` (Docker) or a paid plan; both are
  a one-line `ENVIO_INDEXER_URL` swap. See `indexer/README.md`.
- 🟢 **Stage 3 — cross-chain funding: BUILT, verified end-to-end live.** Two
  providers behind one DTO. **Relay is primary** — it is the one that actually
  routes to Monad. **Aurora Intents is the fallback**: its appKey authenticates
  and its token list advertises 3 Monad assets (MON/USDC/USDT0, addresses
  matching `lib/registry.ts`), but its solver has **no Monad pair at all**
  (verified live: `"Quoting for this pair is not available"` for every Monad
  combination, in both directions, while non-Monad pairs quote fine) — so it
  only answers if Relay fails. Files: `lib/relay.ts`, `lib/aurora.ts`,
  `lib/bridge.ts` (6 source chains), `lib/bridge-route.ts` (orchestrator), DTOs,
  routes `/api/bridge/{quote,status}`, `components/fobs/bridge-drawer.tsx`,
  mounted in `app/(app)/layout.tsx` with a "Fund from another chain" trigger in
  the trade drawer. **Verified through the real route**: base/eth/arb/bsc USDC →
  MON and → USDC/USDT0 all return `provider:"relay"` with sane outputs (1 USDC →
  ~33.6 MON), approve+deposit steps, and a `requestId`; status returns
  `{"status":"unknown"}` before deposit and 400s on a malformed id. BSC's
  18-decimal USDC parses correctly (a 10^12 trap avoided). `tsc` + `pnpm build`
  green.
- 🟡 **Stage 4 — Nansen: adapter + wiring DONE & verified (honest-empty).**
  `lib/labels.ts` (cached, server-only), profile label chips, and a
  token smart-money panel. Verified live: `/api/tokens/MON` returns
  `smartMoney: null` with no key, no crash. **Blocked on a paid `NANSEN_API_KEY`
  (+ Monad coverage check) for real labels.**

## Decisions (locked)

| Area | Decision |
|---|---|
| Kuru | **Primary swap venue**; 0x retained as automatic fallback |
| Cross-chain | **Relay primary + Aurora Intents fallback** (Aurora can't route Monad — see below) |
| Nansen | **Adapter now, key later** — honest-empty until `NANSEN_API_KEY` is set |
| Envio | **Envio Cloud** (branch `envio`, root dir `indexer`) — deployed and wired; dev tier, so the deployment expires. Local `envio dev` (Docker) remains the no-quota option |

## Research findings (evidence)

- **Kuru Flow** — public HTTP API at `https://ws.kuru.io`. `POST /api/generate-token
  {user_address}` → `{token, expires_at, rate_limit}` (JWT). `POST /api/quote`
  with `Authorization: Bearer <token>`, body `{userAddress, tokenIn, tokenOut,
  amount, autoSlippage|slippageTolerance, referrerAddress?, referrerFeeBps?}` →
  `{status, output, minOut, transaction:{to, calldata, value}, gasPrices}`.
  Native MON is `0x0`; **`calldata` has no `0x` prefix**; ERC20 needs an approve
  to `transaction.to`; `value` must equal the amount for native swaps.
- **Aurora Intents / NEAR Intents** — `intents-api.aurora.dev`, and the API key
  is a **path segment** (`/api/tokens|quote|transactions/<key>`). Its token list
  *advertises* Monad assets (HOT-Bridge `nep245:` ids) but the solver has **no
  Monad pair**: `POST /api/quote` returns `"Quoting for this pair is not
  available"` for every Monad combination while non-Monad pairs quote normally
  (base USDC → near USDC returned a signed quote). Aurora's own docs never list
  Monad. Corrected 2026-10-06 from the earlier "Monad is a live destination".
- **Relay** — `api.relay.link`, keyless. Covers Monad (chainId 143). `POST /quote`
  returns `{requestId, steps[], details, fees}` where `steps` are origin-chain
  transactions (an ERC20 `approve` when allowance is short, then the `deposit`),
  and `details.currencyIn/currencyOut` carry the real amounts. Status:
  `GET /intents/status?requestId=`. This is the provider that actually funds
  Monad today.
- **Envio** — officially supports Monad: chainId `143`, HyperSync
  `https://monad.hypersync.xyz`. Three files: `config.yaml`, `schema.graphql`,
  `src/EventHandlers.ts`. Deploy via `envio-cloud` CLI + GitHub (deploys from an
  `envio` branch); Cloud has a free dev tier. Self-host via Docker is also
  possible.
- **Nansen** — API at `https://api.nansen.ai`, auth via an **`apikey` header**
  (not Bearer). Endpoints: `/api/v1/profiler/address/labels`,
  `/api/v1/profiler/address/premium-labels`, `/api/v1/smart-money/{holdings,
  netflow,dex-trades}`. **Paid, credit-gated, and Monad coverage is unconfirmed.**
- **0x already supports Monad (143)** — so the current path stays valid as the
  fallback.

## Architecture: a venue adapter

Today `app/api/trade/quote/route.ts` calls `lib/zerox.ts` directly and returns a
`SwapQuoteDTO` (`lib/types.ts:70`). Introduce a thin venue layer so Kuru and 0x
are interchangeable and the route/UI stay almost untouched.

```
lib/venues/types.ts   SwapVenue interface: quote(params) -> VenueQuote
lib/venues/kuru.ts    Kuru Flow client   (NEW)
lib/venues/zerox.ts   current lib/zerox.ts, moved + conformed
lib/swap.ts           getBestQuote(): try Kuru -> catch -> 0x; returns {quote, venue}
```

- `lib/venues/kuru.ts` — `generateToken(userAddress)` (cache JWT per address
  until `expires_at`, in-memory like `lib/market.ts`), then `quote(...)`. Map
  Kuru's response onto `VenueQuote`: `data = "0x" + calldata`,
  `allowanceTarget = transaction.to`, `allowanceNeeded = sellAmount` (ERC20 only),
  `value = transaction.value`. Add a `kuruAddress(t)` helper — native sentinel is
  `0x0`, **not** the 0x `0xEeee…` sentinel.
- `lib/swap.ts` — Kuru first; on any `KuruError` (no route, 429, 5xx) fall back
  to 0x. Attach `venue: "kuru" | "0x"` to the returned quote.
- `app/api/trade/quote/route.ts` — swap the single call for `getBestQuote()`;
  add `venue` to `SwapQuoteDTO` (`lib/types.ts`).
- **Client is nearly untouched** — `components/fobs/trade-drawer.tsx` already
  consumes the DTO. Only change: "Routed by 0x" (line ~359) becomes
  `quote.venue`; the executing-view copy ("Souring through 0x on Monad…") uses it
  too.
- **Recording is venue-agnostic already** — `verifySwap` (`lib/onchain.ts:64`)
  reads Transfer logs + native delta, so no change is needed there.

Env: none required (Kuru Flow is public JWT). Confirm any referrer expectation.

## Stage 1 — Kuru as the primary venue  *(no credentials needed — start here)*

Files: `lib/venues/types.ts`, `lib/venues/kuru.ts`, `lib/venues/zerox.ts`,
`lib/swap.ts`, edit `app/api/trade/quote/route.ts`, `lib/types.ts`,
`components/fobs/trade-drawer.tsx`.

Verify: quote both directions (MON→USDC buy, USDC→MON sell), sign in wallet,
confirm the tx on monadscan, confirm `/api/trade/record` derives amounts from the
receipt. Force a Kuru failure (bad pair) → confirm silent 0x fallback.

## Stage 2 — Envio indexer → real, chain-wide feed

Rationale: the "live feed" today is only trades made *inside fobs*. Envio
indexes swaps/transfers **on-chain**, which is what makes token activity and
wallet activity real (and later feeds `lib/signal.ts` and portfolio PnL).

- New workspace package `indexer/` (`config.yaml`, `schema.graphql`,
  `src/EventHandlers.ts`) indexing the registry tokens (`lib/registry.ts`) plus
  the Kuru router. Schemas: `Swap`, `Transfer`, `TokenActivity`, `WalletActivity`.
- Run locally via `envio dev` (user's choice). It starts its own Postgres +
  Hasura **in Docker**, so it needs a running container daemon. **Blocker: no
  Docker/Podman on this machine** (binaries absent, daemon inactive); installing
  needs interactive sudo, so the user runs it. Env: `ENVIO_INDEXER_URL`.
- App: new `lib/indexer.ts` (GraphQL client, in-memory TTL like `lib/market.ts`);
  rewire `lib/feed.ts` `getFeed`/`getTokenActivity` to read the indexer, keeping
  `tryDb` as the honest fallback. This also unblocks `Position`/PnL
  (`lib/portfolio.ts` `pnlAvailable`).

## Stage 3 — cross-chain funding  *(built, two providers)*

Maps onto the checklist's six rows — detection, quote, route, deposit, execute,
status — with one DTO so the drawer never cares which provider answered.

- `lib/relay.ts` — **primary**. Keyless `POST /quote` returns a `requestId` plus
  approve/deposit transactions for the origin chain; `GET /intents/status` reads
  status. Amounts read from `details.currencyIn/currencyOut` (never recomputed).
- `lib/aurora.ts` — **fallback**. AppKey is a **path segment**, not a header.
  Lists Monad assets but **cannot route them** (see Status). Kept wired: real
  calls, honest errors, and a one-line flip if it ever enables HOT routes.
- `lib/bridge.ts` — the 6 source chains as viem chains with verified USDC
  addresses/decimals (BSC is 18, not 6) and the Monad destination table.
- `lib/bridge-route.ts` — tries Relay, falls back to Aurora, normalises both to
  `steps[]` (Aurora's single transfer is built server-side with `encodeFunctionData`).
- Routes `/api/bridge/quote` (POST) and `/api/bridge/status` (GET, `?provider=`).
  `/api/bridge/assets` was removed — source addresses are now a verified constant
  table instead of a runtime Aurora dependency.
- Client `components/fobs/bridge-drawer.tsx`: source/destination pickers, live
  `useBalance` on the source chain, quote panel with the provider named, the
  step list, then sign-in-own-wallet, then a 6s status poll. Non-transaction
  steps are surfaced, never silently skipped.
- No custody: the user signs from their wallet; fobs only ever reads.
- DB: `Trade.source = CROSS_CHAIN` / `fromChain` wiring is still open (a bridged
  buy is delivered by Relay, not executed through our quote route, so it isn't
  recorded as a fobs trade yet).

## Stage 4 — Nansen labels (adapter, honest-empty)

- `lib/labels.ts` — server-only `getWalletLabels(address)`,
  `getSmartMoneyHoldings(token)`, `getTokenSmartMoneyActivity(token)`. Reads
  `NANSEN_API_KEY`; if unset → returns `null` and the UI renders nothing (never a
  fabricated label). Cache results (labels change slowly) with a TTL.
- Surface: replace the never-written `User.isNotable`
  (`prisma/schema.prisma:52`) with a real label on `profile-view.tsx`; add a
  smart-money panel to `token-view.tsx`; enrich feed rows.
- **Blocker: a paid Nansen key, and Monad coverage must be verified on the first
  live call.** If Monad isn't covered, swap the implementation behind the same
  interface (Arkham / Chainbase / Moralis) — the adapter makes that a one-file
  change.

## Cross-cutting

- Env additions: `ENVIO_INDEXER_URL`, `NANSEN_API_KEY?`, `KURU_FLOW_URL`
  (default `https://ws.kuru.io`), `RELAY_API_URL`, `AURORA_INTENTS_API_URL` +
  `AURORA_INTENTS_API_KEY` (set in `.env` locally). `ZEROX_API_KEY` stays for the
  fallback.

## Unblocking Envio local (Docker)

`envio dev` needs a container runtime. This machine has neither Docker nor
Podman and `sudo` is interactive, so run one of these yourself:

```bash
# WSL2 (Ubuntu 26.04) — Docker Engine, then start it
sudo apt-get update && sudo apt-get install -y docker.io
sudo service docker start        # or: sudo systemctl start docker
sudo usermod -aG docker "$USER"  # then re-open the shell
```

Then:

```bash
cd ~/fobs-monad/indexer
pnpm install --ignore-workspace
pnpm codegen && pnpm dev
```

`pnpm dev` prints a GraphQL endpoint (default `http://localhost:9898/v1/graphql`)
— set that as `ENVIO_INDEXER_URL` and the feed switches to chain-wide indexing.
Without Docker the app keeps reading its own recorded trades (honest fallback),
so nothing is broken meanwhile.
- `contracts/README.md` and `contracts/FobsRouter.sol` are now stale (they
  describe the deleted simulated flow, `lib/route.ts`, `/api/trade/execute`) —
  update or remove as part of this work.
- Repo has **no git remote** and sits on branch `monad-mainnet-real-trading` —
  needs a remote before any PR.

## Suggested order & effort

1. **Kuru** — no credentials, highest visibility, ~1 focused session.
2. **Envio** — real feed; blocked only on your Envio account + GitHub repo.
3. **Cross-chain** — done (Relay primary + Aurora fallback), verified live.
4. **Nansen** — blocked on a paid key (+ Monad coverage check).

## Verification (each stage)

- `./node_modules/.bin/tsc --noEmit` clean and `pnpm build` exits 0 (note: `rm -rf
  .next` after route changes; ES2017 target forbids `0n` BigInt literals).
- Run `pnpm dev` and any Postgres-touching command with the command sandbox
  **disabled** (egress on 5432 is blocked; Google Fonts also fail sandboxed).
- Real end-to-end: a Kuru-routed trade landing on monadscan; an Envio-indexed
  swap appearing in the feed with the app's own trade absent; a small Aurora
  deposit arriving on Monad; a Nansen label rendering for a known smart-money
  address.
