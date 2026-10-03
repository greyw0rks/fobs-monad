import { NextResponse } from "next/server";
import { getFeed } from "@/lib/feed";
import { viewerQuery } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/feed?address=0x..&scope=following|global
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const scope = searchParams.get("scope") ?? "global";

  if (scope === "following") {
    const viewer = await viewerQuery(address);
    // Resolving the viewer failed, so we can't know who "following" means.
    // Serving the global feed here would silently show a different feed than
    // the one that was asked for.
    if (!viewer.ok) {
      return NextResponse.json({ error: "Feed is temporarily unavailable" }, { status: 503 });
    }
    // Connected, but no account yet — following nothing is genuinely empty.
    if (!viewer.data) return NextResponse.json({ trades: [] });
    return NextResponse.json({ trades: await getFeed({ viewerId: viewer.data, limit: 40 }) });
  }

  return NextResponse.json({ trades: await getFeed({ limit: 40 }) });
}
