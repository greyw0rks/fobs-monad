import { NextResponse } from "next/server";
import { z } from "zod";
import { dbConfigured } from "@/lib/db";
import { isAddress } from "@/lib/session";
import { isValidAuthAction } from "@/lib/auth-message";
import { issueChallenge } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  address: z.string(),
  action: z.string()
});

// POST /api/auth/nonce — hand out a single-use challenge for one action.
// The response body is the exact string the wallet must sign; the same string
// is stored server-side, and verifyAuth() checks the signature against that
// copy rather than anything the client sends back.
export async function POST(request: Request) {
  if (!dbConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { address, action } = parsed.data;
  if (!isAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }
  if (!isValidAuthAction(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const { nonce, message, expiresAt } = await issueChallenge(address, action);
    return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[auth] could not issue a challenge:", detail);
    return NextResponse.json({ error: "Could not start a signature request" }, { status: 503 });
  }
}
