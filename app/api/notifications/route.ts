import { NextResponse } from "next/server";
import { tryDb } from "@/lib/db";
import { viewerIdFromAddress } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/notifications?address=0x..
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const viewerId = await viewerIdFromAddress(searchParams.get("address"));
  if (!viewerId) return NextResponse.json({ notifications: [] });

  const rows = await tryDb((db) =>
    db.notification.findMany({
      where: { recipientId: viewerId },
      include: { actor: { select: { username: true, displayName: true, avatar: true, isNotable: true } } },
      orderBy: { createdAt: "desc" },
      take: 40
    })
  );

  const notifications = (rows ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    tokenSymbol: n.tokenSymbol,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor
      ? {
          username: n.actor.username,
          displayName: n.actor.displayName,
          avatar: n.actor.avatar,
          isNotable: n.actor.isNotable
        }
      : null
  }));

  return NextResponse.json({ notifications });
}
