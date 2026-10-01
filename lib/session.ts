// Session/identity — wallet-first. Fobs identity is the connected Monad
// address: no password, no mandatory login. Write routes call resolveUser,
// which upserts a User keyed on the lowercased address and derives a readable
// handle on first sight (editable later).

import "server-only";
import { prisma } from "./db";
import { shortAddress } from "./format";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

export function deriveUsername(address: string): string {
  return `fobs_${address.slice(2, 6)}${address.slice(-4)}`.toLowerCase();
}

/** Resolve (or create) the User that owns actions from this wallet. */
export async function resolveUser(walletAddress: string) {
  if (!isAddress(walletAddress)) throw new Error("A valid Monad wallet address is required");
  const address = walletAddress.toLowerCase();
  return prisma.user.upsert({
    where: { address },
    update: {},
    create: {
      address,
      username: deriveUsername(address),
      displayName: shortAddress(address)
    }
  });
}
