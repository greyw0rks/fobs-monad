// Prisma client singleton + soft-failure wrappers.
//
// The DB backs the social graph and trade records. A missing/unreachable DB
// degrades rather than throwing (token/market pages still work off the registry
// + live prices).
//
// Two wrappers, because "the DB did not answer" and "the answer is empty" are
// different facts and must not render the same:
//   - `dbQuery` reports WHICH happened. Use it wherever a missing row would be
//     read as a claim — a 404 on a shared trade, an empty inbox — so an outage
//     surfaces as "temporarily unavailable" instead of "nothing here".
//   - `tryDb` collapses both to null. Use it only where the caller genuinely
//     cannot distinguish the two and an empty state is acceptable.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const dbConfigured = Boolean(process.env.DATABASE_URL);

/** Why the DB could not answer: never configured, or configured but unreachable. */
export type DbFailure = "unconfigured" | "unreachable";

/**
 * `ok: false` means the DB did not answer — the caller knows nothing, and must
 * say so. It is NOT an empty result.
 */
export type DbResult<T> = { ok: true; data: T } | { ok: false; reason: DbFailure };

/** Run a DB query; never throws. Distinguishes "no answer" from "empty answer". */
export async function dbQuery<T>(fn: (db: PrismaClient) => Promise<T>): Promise<DbResult<T>> {
  if (!dbConfigured) return { ok: false, reason: "unconfigured" };
  try {
    return { ok: true, data: await fn(prisma) };
  } catch (error) {
    console.error("[db] query failed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "unreachable" };
  }
}

/** Run a DB query; return null when the DB is missing/unreachable. */
export async function tryDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  const result = await dbQuery(fn);
  return result.ok ? result.data : null;
}
