// Verify the two on-chain legs of a cross-chain funding: the USDC the user spent
// on the origin chain, and the token they were credited on Monad.
//
// Both legs are read from RECEIPTS — never from the client, the bridge quote, or
// the bridge's own status payload. That is the same rule the swap path follows
// (`lib/onchain.ts`), and it is the reason a bridged buy can be recorded as a
// real trade at all. A leg that cannot be verified returns `null`, and the
// caller records nothing rather than a number somebody claimed.
//
// Trust boundary, stated plainly: this proves "this wallet spent X on chain A"
// and "this wallet was credited Y on Monad". It does not prove the two events
// came from one bridge request — Relay's status supplies the destination hash
// (see the record route), which is what ties them together.

import "server-only";
import { createPublicClient, http, erc20Abi, formatUnits, parseEventLogs, type Hash } from "viem";
import { publicClient } from "./onchain";
import { bridgeDestination, type BridgeSource, type BridgeDestination } from "./bridge";

/**
 * USDC the wallet actually spent on the origin chain, or `null` when the tx is
 * missing, reverted, or contains no transfer out of this wallet.
 */
export async function verifyOriginSpend(
  source: BridgeSource,
  txHash: Hash,
  wallet: `0x${string}`
): Promise<number | null> {
  try {
    // Keyless public RPC for whichever chain the deposit came from.
    const client = createPublicClient({ chain: source.chain, transport: http() });
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return null;

    const w = wallet.toLowerCase();
    const want = source.address.toLowerCase();
    let spent = 0;
    for (const log of parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })) {
      if (log.address.toLowerCase() !== want) continue;
      const { from, value } = log.args as { from: string; to: string; value: bigint };
      if (from.toLowerCase() === w) spent += Number(formatUnits(value, source.decimals));
    }
    return spent > 0 ? spent : null;
  } catch (err) {
    console.error("[bridge] origin verify failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The destination token the wallet was credited on Monad, or `null` when the tx
 * is missing, reverted, or did not credit this wallet.
 */
export async function verifyDestinationCredit(
  dest: BridgeDestination,
  txHash: Hash,
  wallet: `0x${string}`
): Promise<number | null> {
  const { address, decimals, isNative } = bridgeDestination(dest);
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return null;
    const w = wallet.toLowerCase();

    if (!isNative) {
      let got = 0;
      for (const log of parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue;
        const { to, value } = log.args as { from: string; to: string; value: bigint };
        if (to.toLowerCase() === w) got += Number(formatUnits(value, decimals));
      }
      return got > 0 ? got : null;
    }

    // Native MON. A delivery tx is SENT by the bridge's relayer, not the user, so
    // there is no sender leg to read — the credit exists only as a balance diff
    // across the block. Monad's public RPC serves recent historical state, which
    // is all a just-completed bridge needs.
    const [before, after] = await Promise.all([
      publicClient.getBalance({ address: wallet, blockNumber: receipt.blockNumber - BigInt(1) }),
      publicClient.getBalance({ address: wallet, blockNumber: receipt.blockNumber })
    ]);
    const delta = Number(formatUnits(after - before, 18));
    return delta > 0 ? delta : null;
  } catch (err) {
    console.error("[bridge] destination verify failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
