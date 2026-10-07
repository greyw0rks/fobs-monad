import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, dbConfigured } from "@/lib/db";
import { resolveUser } from "@/lib/session";
import { authAction } from "@/lib/auth-message";
import { verifyAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  address: z.string(), // the wallet acting
  username: z.string(), // the trader to follow/unfollow
  nonce: z.string(), // proof that `address` authorised this toggle
  signature: z.string()
});

// POST /api/follow — toggles the follow edge, returns the new state.
// Signed: the follow graph is the social claim, so a write to it has to be
// authorised by the wallet it is attributed to.
export async function POST(request: Request) {
  if (!dbConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const { address, username, nonce, signature } = parsed.data;
    const auth = await verifyAuth({ address, action: authAction.follow(username), nonce, signature });
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const me = await resolveUser(address);
    const target = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });

    if (!target) return NextResponse.json({ error: "Trader not found" }, { status: 404 });
    if (target.id === me.id) return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: me.id, followingId: target.id } }
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      return NextResponse.json({ following: false });
    }

    await prisma.follow.create({ data: { followerId: me.id, followingId: target.id } });
    await prisma.notification.create({
      data: { recipientId: target.id, actorId: me.id, type: "FOLLOW" }
    });
    return NextResponse.json({ following: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Follow failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
