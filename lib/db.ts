// Prisma client singleton + a soft-failure wrapper.
//
// The DB is a required dependency for the seeded demo, but a missing/unreachable
// DB degrades to an honest EMPTY state rather than throwing. `tryDb` returns
// null in that case — callers treat null as "unavailable", never as a cue to
// fabricate data.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const dbConfigured = Boolean(process.env.DATABASE_URL);

/** Run a DB query; return null (not throw) when the DB is missing/unreachable. */
export async function tryDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  if (!dbConfigured) return null;
  try {
    return await fn(prisma);
  } catch (error) {
    console.error("[db] query failed, falling back:", error instanceof Error ? error.message : error);
    return null;
  }
}
