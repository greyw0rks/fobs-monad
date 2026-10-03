// Resolve the viewer's User id from a connected wallet address WITHOUT creating
// a row (reads only). Write routes use resolveUser (which upserts) instead.
//
// `viewerQuery` keeps "this address has no account" (ok, null) distinct from
// "the DB could not answer" (not ok) — an inbox must not read an outage as
// "you have no notifications". `viewerIdFromAddress` collapses both to null for
// callers where an empty state is genuinely equivalent.

import "server-only";
import { dbQuery, tryDb, type DbResult } from "./db";
import { isAddress } from "./session";

/** The viewer's id, or null when the address simply has no account. */
export async function viewerQuery(address: unknown): Promise<DbResult<string | null>> {
  if (!isAddress(address)) return { ok: true, data: null };
  const user = await dbQuery((db) =>
    db.user.findUnique({ where: { address: address.toLowerCase() }, select: { id: true } })
  );
  return user.ok ? { ok: true, data: user.data?.id ?? null } : user;
}

export async function viewerIdFromAddress(address: unknown): Promise<string | null> {
  if (!isAddress(address)) return null;
  const user = await tryDb((db) =>
    db.user.findUnique({ where: { address: address.toLowerCase() }, select: { id: true } })
  );
  return user?.id ?? null;
}
