// Cross-chain funding routing — one entry point, two providers, same DTO.
//
// Relay answers first: it is the provider that actually routes to Monad today
// (Aurora lists Monad assets but its solver has no Monad pair, verified
// 2026-10-06). Aurora is kept wired as the fallback so the checklist's vendor
// is real code with real calls, and so flipping the order is a one-line change
// if Aurora enables HOT-Bridge routes.
//
// Server-only, and it only ever ROUTES: every returned step is unsigned calldata
// the user signs in their own wallet.

import "server-only";
import { encodeFunctionData, erc20Abi, formatUnits } from "viem";
import { getRelayQuote, RelayError } from "./relay";
import { getAuroraQuote, findAuroraAsset, auroraConfigured, AuroraError } from "./aurora";
import { bridgeSourceById, bridgeDestination, type BridgeDestination } from "./bridge";
import type { BridgeQuoteDTO, BridgeStepDTO } from "./types";

export class BridgeError extends Error {}

export type BridgeQuoteRequest = {
  sourceId: number;
  destSymbol: BridgeDestination;
  amount: string; // base units of the source token
  recipient: `0x${string}`;
  slippageBps: number;
};

export async function getBridgeQuote(req: BridgeQuoteRequest): Promise<BridgeQuoteDTO> {
  const source = bridgeSourceById(req.sourceId);
  if (!source) throw new BridgeError("Unsupported source chain");
  const dest = bridgeDestination(req.destSymbol);

  const common = {
    sourceId: source.id,
    sourceName: source.name,
    sourceSymbol: source.symbol,
    destSymbol: req.destSymbol
  };

  // ── Relay (primary — routes to Monad) ─────────────────────────────────────
  let relayError: unknown = null;
  try {
    const q = await getRelayQuote({
      source,
      destAddress: dest.address,
      destSymbol: req.destSymbol,
      amount: req.amount,
      recipient: req.recipient,
      slippageBps: req.slippageBps
    });
    return {
      provider: "relay",
      requestId: q.requestId,
      ...common,
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      amountInToken: Number(formatUnits(BigInt(q.amountIn), source.decimals)),
      amountOutToken: Number(formatUnits(BigInt(q.amountOut), dest.decimals)),
      amountInUsd: q.amountInUsd,
      amountOutUsd: q.amountOutUsd,
      steps: q.steps,
      depositAddress: null,
      depositMemo: null,
      deadline: null,
      timeEstimateSec: q.timeEstimateSec
    };
  } catch (err) {
    if (!(err instanceof RelayError)) throw err;
    relayError = err;
  }

  // ── Aurora Intents (fallback) ─────────────────────────────────────────────
  if (auroraConfigured()) {
    try {
      const [origin, destAsset] = await Promise.all([
        findAuroraAsset(source.auroraKey, source.symbol),
        findAuroraAsset("monad", req.destSymbol)
      ]);
      if (origin && destAsset) {
        const q = await getAuroraQuote({
          originAsset: origin.assetId,
          destinationAsset: destAsset.assetId,
          amount: req.amount,
          recipient: req.recipient,
          refundTo: req.recipient,
          slippageBps: req.slippageBps
        });
        // Aurora's flow is a single ERC20 transfer to the deposit address; build
        // that calldata server-side so the client needs no token ABI.
        const transfer = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [q.depositAddress as `0x${string}`, BigInt(req.amount)]
        });
        const steps: BridgeStepDTO[] = [
          {
            label: `Send ${source.symbol}`,
            kind: "transaction",
            to: source.address,
            data: transfer,
            value: "0",
            chainId: source.id
          }
        ];
        return {
          provider: "aurora",
          requestId: null,
          ...common,
          amountIn: q.amountIn,
          amountOut: q.amountOut,
          amountInToken: Number(formatUnits(BigInt(q.amountIn), source.decimals)),
          amountOutToken: Number(formatUnits(BigInt(q.amountOut), dest.decimals)),
          amountInUsd: q.amountInUsd,
          amountOutUsd: q.amountOutUsd,
          steps,
          depositAddress: q.depositAddress,
          depositMemo: q.depositMemo,
          deadline: q.deadline,
          timeEstimateSec: q.timeEstimateSec
        };
      }
    } catch (err) {
      if (!(err instanceof AuroraError)) throw err;
      // Fall through — report the Relay failure, which is the primary provider.
    }
  }

  throw new BridgeError(
    relayError instanceof Error ? relayError.message : "No cross-chain route to Monad is available right now"
  );
}
