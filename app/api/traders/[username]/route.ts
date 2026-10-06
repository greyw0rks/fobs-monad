import { NextResponse } from "next/server";
import { getProfile } from "@/lib/profile";
import { viewerIdFromAddress } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/traders/[username]?address=0x..
export async function GET(request: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { searchParams } = new URL(request.url);
  const viewerId = await viewerIdFromAddress(searchParams.get("address"));

  const result = await getProfile(username, viewerId);
  // "No such trader" and "the DB did not answer" are different facts: a real
  // account must not 404 just because the database is having a bad minute.
  if (!result.ok) {
    return NextResponse.json({ error: "Profile is temporarily unavailable" }, { status: 503 });
  }
  if (!result.data) return NextResponse.json({ error: "Trader not found" }, { status: 404 });
  return NextResponse.json(result.data);
}
