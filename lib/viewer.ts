// Resolve the viewer's User id from a connected wallet address WITHOUT creating
// a row (reads only). Returns null when the address is absent/invalid or the DB
// is unavailable. Write routes use resolveUser (which upserts) instead.

import "server-only";
import { tryDb } from "./db";
import { isAddress } from "./session";

export async function viewerIdFromAddress(address: unknown): Promise<string | null> {
  if (!isAddress(address)) return null;
  const user = await tryDb((db) =>
    db.user.findUnique({ where: { address: address.toLowerCase() }, select: { id: true } })
  );
  return user?.id ?? null;
}
