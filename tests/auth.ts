// Signature-auth checks — the pure half of lib/auth.ts (lib/auth-message.ts).
//
// The three properties that make signed writes safe are each a case below:
// a challenge cannot be reused, cannot be spent by another wallet, and cannot
// be redirected at a different action. No database and no network: the
// signature check itself is viem's, exercised live against the running server.
// Runs under tsx with no framework: `pnpm test:auth`.

import assert from "node:assert/strict";
import { authAction, buildAuthMessage, checkChallenge, isValidAuthAction, type Challenge } from "../lib/auth-message";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const NONCE = "a".repeat(64);
const TX = `0x${"b".repeat(64)}`;

const NOW = new Date("2026-10-07T12:00:00.000Z");
const LATER = new Date("2026-10-07T12:04:00.000Z");
const EXPIRED = new Date("2026-10-07T11:59:00.000Z");

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  const action = authAction.follow("alice");
  return {
    nonce: NONCE,
    address: ALICE,
    action,
    message: buildAuthMessage({ address: ALICE, action, nonce: NONCE, issuedAt: NOW }),
    expiresAt: LATER,
    usedAt: null,
    ...overrides
  };
}

// 1. The message is deterministic and carries the identity, action and nonce.
//    Both sides rely on this being byte-for-byte reproducible.
{
  const input = { address: ALICE, action: authAction.follow("alice"), nonce: NONCE, issuedAt: NOW };
  const message = buildAuthMessage(input);
  assert.equal(message, buildAuthMessage(input), "must be deterministic");
  assert.ok(message.includes(`Wallet: ${ALICE}`), "names the wallet");
  assert.ok(message.includes(`Action: ${authAction.follow("alice")}`), "names the action");
  assert.ok(message.includes(`Nonce: ${NONCE}`), "carries the nonce");
  assert.ok(message.includes("2026-10-07T12:00:00.000Z"), "carries the issue time");
}

// 2. The wallet is normalised into the message, so a checksummed address and a
//    lowercased one are the SAME challenge (they are the same wallet).
{
  const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const a = buildAuthMessage({ address: checksummed, action: authAction.follow("alice"), nonce: NONCE, issuedAt: NOW });
  const b = buildAuthMessage({
    address: checksummed.toLowerCase(),
    action: authAction.follow("alice"),
    nonce: NONCE,
    issuedAt: NOW
  });
  assert.equal(a, b);
  assert.ok(a.includes(`Wallet: ${checksummed.toLowerCase()}`), "stores the lowercased wallet");
}

// 3. Labels are normalised, so the same action always produces the same label.
{
  assert.equal(authAction.follow(" Alice "), "follow:@alice");
  assert.equal(authAction.publishTrade(TX.toUpperCase().replace("0X", "0x")), `publish-trade:${TX}`);
  assert.equal(authAction.publishBridge(TX), `publish-bridge:${TX}`);
}

// 4. Only the three real actions can be issued a challenge for.
{
  assert.equal(isValidAuthAction(authAction.follow("alice")), true);
  assert.equal(isValidAuthAction(authAction.publishTrade(TX)), true);
  assert.equal(isValidAuthAction(authAction.publishBridge(TX)), true);

  for (const junk of ["", "follow:", "follow:@", "admin:delete", "follow:@Alice", `publish-trade:${TX.slice(0, 20)}`, "nonsense"]) {
    assert.equal(isValidAuthAction(junk), false, `should reject ${JSON.stringify(junk)}`);
  }
}

// 5. A fresh challenge for the same wallet and action is accepted.
{
  const c = challenge();
  assert.deepEqual(checkChallenge(c, { address: ALICE, action: c.action, nonce: NONCE }, NOW), { ok: true });
}

// 6. An unknown nonce is refused.
{
  const verdict = checkChallenge(null, { address: ALICE, action: authAction.follow("alice"), nonce: NONCE }, NOW);
  assert.equal(verdict.ok, false);
}

// 7. A spent challenge cannot be spent again — the single-use rule.
{
  const c = challenge({ usedAt: NOW });
  const verdict = checkChallenge(c, { address: ALICE, action: c.action, nonce: NONCE }, NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.error, /already been used/);
}

// 8. Another wallet cannot spend a challenge issued to someone else.
{
  const c = challenge();
  const verdict = checkChallenge(c, { address: BOB, action: c.action, nonce: NONCE }, NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.error, /different wallet/);
}

// 9. THE replay case: a signature for one follow cannot authorise a follow of a
//    different trader, even with the right wallet and a live nonce.
{
  const c = challenge(); // issued for follow:@alice
  const verdict = checkChallenge(c, { address: ALICE, action: authAction.follow("bob"), nonce: NONCE }, NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.error, /different action/);
}

// 10. A challenge for a trade cannot be spent on a bridge — the labels differ
//     even though both take a tx hash.
{
  const c = challenge({ action: authAction.publishTrade(TX) });
  const verdict = checkChallenge(c, { address: ALICE, action: authAction.publishBridge(TX), nonce: NONCE }, NOW);
  assert.equal(verdict.ok, false);
}

// 11. Expiry: past the deadline it is refused, and the boundary is exclusive —
//     a challenge expiring exactly now is already gone.
{
  const expired = challenge({ expiresAt: EXPIRED });
  assert.equal(checkChallenge(expired, { address: ALICE, action: expired.action, nonce: NONCE }, NOW).ok, false);

  const boundary = challenge({ expiresAt: NOW });
  assert.equal(checkChallenge(boundary, { address: ALICE, action: boundary.action, nonce: NONCE }, NOW).ok, false);

  const stillLive = challenge({ expiresAt: new Date(NOW.getTime() + 1) });
  assert.equal(checkChallenge(stillLive, { address: ALICE, action: stillLive.action, nonce: NONCE }, NOW).ok, true);
}

// 12. The nonce in the claim must be the one the challenge was stored under.
{
  const c = challenge();
  const verdict = checkChallenge(c, { address: ALICE, action: c.action, nonce: "c".repeat(64) }, NOW);
  assert.equal(verdict.ok, false);
}

console.log("auth: 12/12 cases passed");
