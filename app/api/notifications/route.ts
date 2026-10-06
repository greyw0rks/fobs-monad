import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { viewerQuery } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/notifications?address=0x..
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const viewer = await viewerQuery(searchParams.get("address"));
  // An unreachable DB must not be served as "you have no notifications".
  if (!viewer.ok) {
    return NextResponse.json({ error: "Activity is temporarily unavailable" }, { status: 503 });
  }
  const viewerId = viewer.data;
  // Address connected but has no account yet — genuinely empty.
  if (!viewerId) return NextResponse.json({ notifications: [] });

  const rows = await dbQuery((db) =>
    db.notification.findMany({
      where: { recipientId: viewerId },
      include: { actor: { select: { username: true, displayName: true, avatar: true, isNotable: true } } },
      orderBy: { createdAt: "desc" },
      take: 40
    })
  );
  if (!rows.ok) {
    return NextResponse.json({ error: "Activity is temporarily unavailable" }, { status: 503 });
  }

  const notifications = rows.data.map((n) => ({
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
