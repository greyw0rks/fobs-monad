import { NextResponse } from "next/server";
import { auroraConfigured, getAuroraTransfers, AuroraError } from "@/lib/aurora";
import { getRelayStatus, RelayError } from "@/lib/relay";
import type { BridgeTransferDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

// GET /api/bridge/status
//   ?provider=relay&requestId=0x…                      — Relay intent status
//   ?provider=aurora&address=0x…[&deposit=0x…]         — Aurora transfers
// Statuses are each provider's own values, passed through verbatim. Nothing is
// reinterpreted as a success.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") ?? (searchParams.get("requestId") ? "relay" : "aurora");

  if (provider === "relay") {
    const requestId = searchParams.get("requestId");
    if (!requestId || !/^0x[a-fA-F0-9]{64}$/.test(requestId)) {
      return NextResponse.json({ error: "A valid requestId is required" }, { status: 400 });
    }
    try {
      const s = await getRelayStatus(requestId);
      const dto: BridgeTransferDTO[] = [
        {
          depositAddress: null,
          status: s.status,
          destinationTxHashes: s.destinationTxHashes,
          amountInFormatted: null,
          amountOutFormatted: null,
          createdAt: null,
          refundReason: s.refundReason
        }
      ];
      return NextResponse.json({ transfers: dto });
    } catch (err) {
      const status = err instanceof RelayError ? 422 : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Status lookup failed" }, { status });
    }
  }

  if (provider === "aurora") {
    if (!auroraConfigured()) {
      return NextResponse.json({ error: "Cross-chain funding is not configured" }, { status: 503 });
    }
    const address = searchParams.get("address");
    const deposit = searchParams.get("deposit");
    if (!address || !ADDRESS_RE.test(address)) {
      return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
    }
    try {
      const transfers = await getAuroraTransfers(address);
      const filtered = deposit
        ? transfers.filter((t) => t.depositAddress?.toLowerCase() === deposit.toLowerCase())
        : transfers;
      const dto: BridgeTransferDTO[] = filtered.map((t) => ({
        depositAddress: t.depositAddress,
        status: t.status,
        destinationTxHashes: t.destinationTxHashes,
        amountInFormatted: t.amountInFormatted,
        amountOutFormatted: t.amountOutFormatted,
        createdAt: t.createdAt,
        refundReason: t.refundReason
      }));
      return NextResponse.json({ transfers: dto });
    } catch (err) {
      const status = err instanceof AuroraError ? 422 : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Status lookup failed" }, { status });
    }
  }

  return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
}
