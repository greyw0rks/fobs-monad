// Fobs (Monad) — registry seed. NOT a demo: it loads the real supported-token
// list (identity only — address + decimals) and clears the old seeded demo
// activity graph so no fabricated data survives.
//
//   pnpm seed       (or: npx tsx prisma/seed-registry.ts)
//
// Run once against a database that previously held the demo. Prices are never
// written here — the read path fetches them live (lib/market.ts).

import { PrismaClient } from "@prisma/client";
import { REGISTRY } from "../lib/registry";

const prisma = new PrismaClient();

// The handles the old demo seed created. Removed so no synthetic traders remain.
const DEMO_HANDLES = [
  "anonwhale",
  "monadmaxi",
  "chogfather",
  "basedbridger",
  "molandak",
  "degenmon",
  "yakisoba",
  "lpqueen",
  "fastfinality",
  "coldstorage"
];

async function main() {
  // 1. Clear the demo activity graph (all of it — it was synthetic).
  await prisma.notification.deleteMany();
  await prisma.position.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.user.deleteMany({ where: { username: { in: DEMO_HANDLES } } });

  // 2. Drop any token that isn't in the verified registry (cascades its trades).
  const keep = REGISTRY.map((t) => t.symbol);
  const removed = await prisma.token.deleteMany({ where: { symbol: { notIn: keep } } });

  // 3. Upsert the real supported tokens (identity only).
  for (const t of REGISTRY) {
    await prisma.token.upsert({
      where: { symbol: t.symbol },
      update: { name: t.name, address: t.address, chain: "monad", decimals: t.decimals, logo: t.logo },
      create: { symbol: t.symbol, name: t.name, address: t.address, chain: "monad", decimals: t.decimals, logo: t.logo }
    });
  }

  console.log(
    `Registry seeded: ${REGISTRY.length} tokens (${keep.join(", ")}). ` +
      `Removed ${removed.count} non-registry token(s) and the demo activity graph.`
  );
  console.log("No prices were written — market data is fetched live at request time.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
