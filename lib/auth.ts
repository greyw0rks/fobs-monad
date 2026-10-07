// Signature auth for write routes.
//
// Fobs has no passwords and no login, so the only thing that can authorise a
// write is the wallet it acts for. The flow:
//
//   1. The client asks POST /api/auth/nonce for a challenge for ONE action.
//   2. The server stores the exact message it will accept, and returns it.
//   3. The wallet signs that string; the client returns nonce + signature.
//   4. The route calls verifyAuth(), which checks the signature against the
//      STORED message — never a client-supplied one — and consumes the nonce.
//
// Three properties matter, and each has a test in tests/auth.ts:
//   - the signature is verified over the server's own copy of the message, so a
//     client cannot sign one thing and claim another;
//   - the challenge is bound to an action label the route recomputes from its
//     own parsed body, so `follow:@alice` cannot authorise a follow of @bob;
//   - the challenge is single-use and claimed atomically, so two concurrent
//     requests cannot both spend it.
//
// A failure to reach the DB is reported as 503, never as 401: "we could not
// check" must not render as "you are not who you say you are".

import "server-only";
import { randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { prisma } from "./db";
import { isAddress } from "./session";
import { AUTH_TTL_MS, buildAuthMessage, checkChallenge, type Challenge } from "./auth-message";

const NONCE_RE = /^[a-f0-9]{64}$/;
const SIGNATURE_RE = /^0x[a-fA-F0-9]{130}$/; // 65-byte secp256k1 signature, hex

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 503; error: string };


/**
 * Issue a single-use challenge for one action on one wallet. Also clears that
 * wallet's spent/expired challenges so the table does not grow per click.
 */
export async function issueChallenge(address: string, action: string) {
  const wallet = address.toLowerCase();
  const nonce = randomBytes(32).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + AUTH_TTL_MS);
  const message = buildAuthMessage({ address: wallet, action, nonce, issuedAt });

  await prisma.authNonce.deleteMany({
    where: {
      address: wallet,
      OR: [{ usedAt: { not: null } }, { expiresAt: { lte: issuedAt } }]
    }
  });
  await prisma.authNonce.create({
    data: { nonce, address: wallet, action, message, expiresAt }
  });

  return { nonce, message, expiresAt };
}

/**
 * Verify a wallet signature for `action` and consume its challenge.
 * Returns 400 for a malformed request, 401 for a bad/expired/replayed one, and
 * 503 when the check itself could not be performed.
 */
export async function verifyAuth(input: {
  address: unknown;
  action: string;
  nonce: unknown;
  signature: unknown;
}): Promise<AuthResult> {
  if (!isAddress(input.address)) {
    return { ok: false, status: 400, error: "A valid wallet address is required" };
  }
  if (typeof input.nonce !== "string" || !NONCE_RE.test(input.nonce)) {
    return { ok: false, status: 400, error: "A signature request nonce is required" };
  }
  if (typeof input.signature !== "string" || !SIGNATURE_RE.test(input.signature)) {
    return { ok: false, status: 400, error: "A wallet signature is required" };
  }

  const address = input.address.toLowerCase() as `0x${string}`;
  const signature = input.signature as `0x${string}`;

  let challenge: Challenge | null;
  try {
    challenge = await prisma.authNonce.findUnique({ where: { nonce: input.nonce } });
  } catch (error) {
    console.error("[auth] challenge lookup failed:", error instanceof Error ? error.message : error);
    return { ok: false, status: 503, error: "Signature verification is temporarily unavailable" };
  }

  const verdict = checkChallenge(challenge, { address, action: input.action, nonce: input.nonce }, new Date());
  if (!verdict.ok || !challenge) return { ok: false, status: 401, error: verdict.ok ? "Unknown signature request" : verdict.error };

  // Verified against OUR copy of the message — the client never supplies it.
  let valid = false;
  try {
    valid = await verifyMessage({ address, message: challenge.message, signature });
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, status: 401, error: "Signature does not match this wallet" };
  }

  // Claim it atomically: the conditional update is what makes it single-use even
  // if two requests carry the same signature concurrently.
  try {
    const claimed = await prisma.authNonce.updateMany({
      where: { nonce: input.nonce, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (claimed.count !== 1) {
      return { ok: false, status: 401, error: "This signature has already been used" };
    }
  } catch (error) {
    console.error("[auth] challenge claim failed:", error instanceof Error ? error.message : error);
    return { ok: false, status: 503, error: "Signature verification is temporarily unavailable" };
  }

  return { ok: true };
}
