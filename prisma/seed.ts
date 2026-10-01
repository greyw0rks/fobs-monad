// Fobs (Monad) — demo seed. The engine of the demo: without it the app is a
// correct but empty terminal. This builds a believable 24h activity graph —
// Monad tokens, traders (some notable), follow edges, a trade backlog, and a
// portfolio for the connected demo wallet — all from deterministic pseudo-random
// draws so every reseed looks the same. Idempotent: the activity graph (trades,
// positions, follows, notifications) is wiped and rebuilt; users/tokens upsert.
//
//   npm run seed   (reads SEED_ADDRESS / SEED_USERNAME / SEED_DISPLAY_NAME)

import { PrismaClient, type TradeSide, type TradeSource } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic PRNG so reseeds are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eed11);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
const fakeAddress = () => `0x${hex(40)}`;
const fakeTxHash = () => `0x${hex(64)}`;

const HOUR = 3600_000;

// Five Monad tokens. Prices/mcap are demo values, not live quotes.
const TOKENS = [
  { symbol: "MON", name: "Monad", priceUsd: 2.84, change24h: 6.2, marketCap: 2_840_000_000, volume24h: 184_000_000, holders: 412_000 },
  { symbol: "MONAI", name: "Monad AI", priceUsd: 0.0421, change24h: 18.4, marketCap: 42_100_000, volume24h: 9_800_000, holders: 28_400 },
  { symbol: "CHOG", name: "Chog", priceUsd: 0.0135, change24h: -4.1, marketCap: 13_500_000, volume24h: 3_200_000, holders: 19_800 },
  { symbol: "DAK", name: "Molandak", priceUsd: 0.0089, change24h: 11.7, marketCap: 8_900_000, volume24h: 2_100_000, holders: 14_200 },
  { symbol: "YAKI", name: "Moyaki", priceUsd: 0.0021, change24h: -2.3, marketCap: 2_100_000, volume24h: 640_000, holders: 7_600 }
] as const;

// Traders. isNotable powers the "notable trader" surfaces.
const TRADERS = [
  { username: "anonwhale", displayName: "anon whale", isNotable: true, bio: "size speaks. mostly MON + majors." },
  { username: "monadmaxi", displayName: "monad maxi", isNotable: true, bio: "parallel execution enjoyer. long Monad." },
  { username: "chogfather", displayName: "the chogfather", isNotable: true, bio: "memecoin archaeologist." },
  { username: "basedbridger", displayName: "based bridger", isNotable: false, bio: "fund from Base, settle on Monad." },
  { username: "molandak", displayName: "molandak", isNotable: false, bio: "DAK believer since testnet." },
  { username: "degenmon", displayName: "degen mon", isNotable: false, bio: "high conviction, low sleep." },
  { username: "yakisoba", displayName: "yaki soba", isNotable: false, bio: "YAKI floor is a conspiracy." },
  { username: "lpqueen", displayName: "lp queen", isNotable: true, bio: "liquidity is a lifestyle." },
  { username: "fastfinality", displayName: "fast finality", isNotable: false, bio: "sub-second settlement or bust." },
  { username: "coldstorage", displayName: "cold storage", isNotable: false, bio: "accumulating quietly." }
] as const;

async function main() {
  const now = Date.now();
  const seedAddress = process.env.SEED_ADDRESS?.toLowerCase();

  // 1. Reset the activity graph (keep users/tokens; they upsert below).
  await prisma.notification.deleteMany();
  await prisma.position.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.follow.deleteMany();

  // 2. Tokens.
  for (const t of TOKENS) {
    await prisma.token.upsert({
      where: { symbol: t.symbol },
      update: { name: t.name, priceUsd: t.priceUsd, change24h: t.change24h, marketCap: t.marketCap, volume24h: t.volume24h, holders: t.holders },
      create: { ...t, address: fakeAddress(), chain: "monad", decimals: 18 }
    });
  }

  // 3. Trader users (deterministic addresses derived from the handle).
  const users = [];
  for (const tr of TRADERS) {
    const address = `0x${tr.username.padEnd(20, "0").slice(0, 20)}${hex(20)}`.toLowerCase();
    const u = await prisma.user.upsert({
      where: { username: tr.username },
      update: { displayName: tr.displayName, bio: tr.bio, isNotable: tr.isNotable },
      create: { address, username: tr.username, displayName: tr.displayName, bio: tr.bio, isNotable: tr.isNotable }
    });
    users.push(u);
  }

  // 4. Demo user (the connected wallet) — only if SEED_ADDRESS is set.
  let demo: (typeof users)[number] | null = null;
  if (seedAddress && /^0x[a-f0-9]{40}$/.test(seedAddress)) {
    const username = (process.env.SEED_USERNAME ?? `you_${seedAddress.slice(-4)}`).toLowerCase();
    demo = await prisma.user.upsert({
      where: { address: seedAddress },
      update: {},
      create: {
        address: seedAddress,
        username,
        displayName: process.env.SEED_DISPLAY_NAME ?? "you",
        bio: "connected via fobs demo wallet"
      }
    });
  }

  // 5. Follow graph: every trader follows a few others; demo follows the notable.
  const edges = new Set<string>();
  const addFollow = (followerId: string, followingId: string) => {
    if (followerId === followingId) return;
    edges.add(`${followerId}:${followingId}`);
  };
  for (const u of users) {
    const n = Math.floor(between(2, 5));
    for (let i = 0; i < n; i++) addFollow(u.id, pick(users).id);
  }
  if (demo) {
    for (const u of users.filter((x) => x.isNotable)) addFollow(demo.id, u.id);
    addFollow(demo.id, pick(users).id);
    // A couple of traders follow the demo user back (powers notifications).
    addFollow(users[0].id, demo.id);
    addFollow(users[3].id, demo.id);
  }
  await prisma.follow.createMany({
    data: [...edges].map((e) => {
      const [followerId, followingId] = e.split(":");
      return { followerId, followingId };
    }),
    skipDuplicates: true
  });

  // 6. A 24h trade backlog across tokens — the activity graph the feed reads.
  const tokenBySymbol = new Map<string, (typeof TOKENS)[number]>(TOKENS.map((t) => [t.symbol, t]));
  const CROSS_CHAINS = ["base", "arbitrum", "optimism"];
  type TradeData = {
    userId: string;
    tokenSymbol: string;
    side: TradeSide;
    amountToken: number;
    amountUsd: number;
    priceUsd: number;
    chain: string;
    fromChain: string | null;
    txHash: string;
    source: TradeSource;
    createdAt: Date;
  };
  const trades: TradeData[] = [];

  for (let i = 0; i < 64; i++) {
    const u = pick(users);
    const tk = pick(TOKENS);
    const side: TradeSide = rand() < 0.66 ? "BUY" : "SELL";
    const amountUsd = Math.round(between(u.isNotable ? 800 : 60, u.isNotable ? 12_000 : 1_800));
    const priceUsd = tk.priceUsd * between(0.94, 1.06);
    const fromChain = side === "BUY" && rand() < 0.4 ? pick(CROSS_CHAINS) : null;
    trades.push({
      userId: u.id,
      tokenSymbol: tk.symbol,
      side,
      amountToken: amountUsd / priceUsd,
      amountUsd,
      priceUsd,
      chain: "monad",
      fromChain,
      txHash: fakeTxHash(),
      source: fromChain ? "CROSS_CHAIN" : "SEED",
      createdAt: new Date(now - between(0, 24 * HOUR))
    });
  }

  // 7. Demo portfolio: a few funded buys → open positions you can see in /portfolio.
  if (demo) {
    const holdings = [
      { symbol: "MONAI", costUsd: 500, entryMult: 0.82, fromChain: "base" as string | null },
      { symbol: "MON", costUsd: 1_200, entryMult: 0.9, fromChain: null as string | null },
      { symbol: "DAK", costUsd: 300, entryMult: 1.08, fromChain: "arbitrum" as string | null }
    ];
    for (const h of holdings) {
      const tk = tokenBySymbol.get(h.symbol)!;
      const entry = tk.priceUsd * h.entryMult;
      const amountToken = h.costUsd / entry;
      trades.push({
        userId: demo.id,
        tokenSymbol: h.symbol,
        side: "BUY",
        amountToken,
        amountUsd: h.costUsd,
        priceUsd: entry,
        chain: "monad",
        fromChain: h.fromChain,
        txHash: fakeTxHash(),
        source: h.fromChain ? "CROSS_CHAIN" : "SWAP",
        createdAt: new Date(now - between(2 * HOUR, 20 * HOUR))
      });
      await prisma.position.create({
        data: { userId: demo.id, tokenSymbol: h.symbol, amount: amountToken, avgEntryUsd: entry, realizedPnlUsd: 0 }
      });
    }
  }

  await prisma.trade.createMany({ data: trades });

  // 8. A handful of notifications for the demo user.
  if (demo) {
    await prisma.notification.createMany({
      data: [
        { recipientId: demo.id, actorId: users[0].id, type: "FOLLOW", createdAt: new Date(now - 2 * HOUR) },
        { recipientId: demo.id, actorId: users[3].id, type: "FOLLOW", createdAt: new Date(now - 5 * HOUR) },
        { recipientId: demo.id, actorId: users[1].id, type: "NOTABLE_TRADE", tokenSymbol: "MONAI", createdAt: new Date(now - HOUR) },
        { recipientId: demo.id, type: "TRADE_FILLED", tokenSymbol: "MON", createdAt: new Date(now - 90 * 60_000) }
      ]
    });
  }

  console.log(
    `Seeded: ${TOKENS.length} tokens, ${users.length} traders${demo ? " + demo user" : ""}, ` +
      `${edges.size} follows, ${trades.length} trades.`
  );
  if (!seedAddress) {
    console.log("Tip: set SEED_ADDRESS=<your wallet> in .env to get a portfolio + notifications for your connected wallet.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
