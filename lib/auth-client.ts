"use client";

// Client half of signature auth: get a challenge, sign the exact string the
// server gave us, hand back the proof. The signed message is never constructed
// here — it comes off the wire and goes straight to the wallet, so what the
// user sees is precisely what the server will verify.

import { authAction } from "./auth-message";

export type WriteAuth = { address: string; nonce: string; signature: string };

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Ask the wallet to authorise one action. Throws if the user declines. */
export async function authorizeWrite(input: {
  address: string;
  action: string;
  signMessageAsync: (args: { message: string }) => Promise<string>;
}): Promise<WriteAuth> {
  const challenge = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: input.address, action: input.action })
  });
  if (!challenge.ok) {
    throw new Error(await readError(challenge, "Could not start a signature request"));
  }

  const { nonce, message } = (await challenge.json()) as { nonce: string; message: string };

  let signature: string;
  try {
    signature = await input.signMessageAsync({ message });
  } catch (error) {
    // A declined prompt is a decision, not a fault — say so plainly instead of
    // surfacing viem's "User rejected the request. Version: viem@2.x".
    const code = (error as { code?: number })?.code;
    const text = error instanceof Error ? error.message : "";
    if (code === 4001 || /user rejected|user denied|declined/i.test(text)) {
      throw new Error("Signature declined in your wallet");
    }
    throw error;
  }

  return { address: input.address, nonce, signature };
}

export { authAction };
