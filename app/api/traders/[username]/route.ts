import { NextResponse } from "next/server";
import { getProfile } from "@/lib/profile";
import { viewerIdFromAddress } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// GET /api/traders/[username]?address=0x..
export async function GET(request: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { searchParams } = new URL(request.url);
  const viewerId = await viewerIdFromAddress(searchParams.get("address"));

  const profile = await getProfile(username, viewerId);
  if (!profile) return NextResponse.json({ error: "Trader not found" }, { status: 404 });
  return NextResponse.json(profile);
}
