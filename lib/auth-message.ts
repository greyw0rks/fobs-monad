// The signature-auth challenge, shared by client and server so both agree
// byte-for-byte on what is signed. Deliberately dependency-free and free of
// `server-only` — the client builds the action label, the server rebuilds it
// from the request body and refuses the write if the two disagree.
//
// A wallet signature authorises ONE action on ONE wallet. The label is what
// binds them: a signature collected for `follow:@alice` must not authorise a
// follow of @bob, so every route recomputes its label from its own parsed body
// and compares. See lib/auth.ts.

/** How long a challenge stays valid. Long enough to sign, short enough to not linger. */
export const AUTH_TTL_MS = 5 * 60 * 1000;

/**
 * The human-readable action a signature authorises. Each label is derived only
 * from fields the route already trusts, so the label cannot be decoupled from
 * the effect it permits.
 */
export const authAction = {
  /** Toggle the follow edge to `username`. */
  follow: (username: string) => `follow:@${username.trim().toLowerCase()}`,
  /** Publish an already-confirmed Monad swap into the feed. */
  publishTrade: (txHash: string) => `publish-trade:${txHash.trim().toLowerCase()}`,
  /** Publish a bridge delivery (by its origin-chain tx) into the feed. */
  publishBridge: (originTxHash: string) => `publish-bridge:${originTxHash.trim().toLowerCase()}`
} as const;

const USERNAME_RE = /^[a-z0-9_.-]{1,40}$/;
const HASH_RE = /^0x[a-f0-9]{64}$/;

/**
 * Server-side gate on the action a challenge can be issued for. The client asks
 * for a label; without this it could ask for any string, and the table (and the
 * wallet prompt) would fill with junk. Only the three real actions are issuable.
 */
export function isValidAuthAction(action: string): boolean {
  if (action.startsWith("follow:@")) return USERNAME_RE.test(action.slice("follow:@".length));
  if (action.startsWith("publish-trade:")) return HASH_RE.test(action.slice("publish-trade:".length));
  if (action.startsWith("publish-bridge:")) return HASH_RE.test(action.slice("publish-bridge:".length));
  return false;
}

/** The exact string the wallet is asked to sign. Rendered verbatim by the wallet. */
export function buildAuthMessage(input: {
  address: string;
  action: string;
  nonce: string;
  issuedAt: Date;
}): string {
  return [
    "fobs — signature request",
    "",
    `Wallet: ${input.address.toLowerCase()}`,
    `Action: ${input.action}`,
    "",
    `Nonce: ${input.nonce}`,
    `Issued: ${input.issuedAt.toISOString()}`,
    "",
    "Signing proves you control this wallet.",
    "It costs no gas and moves no funds."
  ].join("\n");
}

/** A stored challenge. Structural, so the decision below needs no database. */
export type Challenge = {
  nonce: string;
  address: string;
  action: string;
  message: string;
  expiresAt: Date;
  usedAt: Date | null;
};

/**
 * Everything about a challenge except the signature check itself — pure, so
 * tests can cover expiry, reuse and cross-action replay without a database.
 * Lives here rather than in lib/auth.ts so the invariants sit beside the labels
 * they depend on, and so this file stays importable from the client.
 */
export function checkChallenge(
  challenge: Challenge | null,
  claim: { address: string; action: string; nonce: string },
  now: Date
): { ok: true } | { ok: false; error: string } {
  if (!challenge) return { ok: false, error: "Unknown signature request" };
  if (challenge.nonce !== claim.nonce) return { ok: false, error: "Signature request mismatch" };
  if (challenge.usedAt) return { ok: false, error: "This signature has already been used" };
  if (challenge.address !== claim.address.toLowerCase()) {
    return { ok: false, error: "This signature was issued to a different wallet" };
  }
  if (challenge.action !== claim.action) {
    return { ok: false, error: "This signature authorises a different action" };
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "This signature request has expired — try again" };
  }
  return { ok: true };
}

