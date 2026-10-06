// On-chain reads — the server's read-only viem client for Monad mainnet.
//
// READ-ONLY by construction: this module never holds a private key and never
// signs. It powers the real portfolio (ERC20 + native balances via Multicall3)
// and trade verification (receipt lookup + transfer parsing). All writes that
// move funds happen client-side in the user's wallet.

import "server-only";
import { createPublicClient, http, erc20Abi, formatUnits, parseEventLogs, type Hash } from "viem";
import { monad } from "./chain";
import { REGISTRY, ERC20_TOKENS, type TokenMeta } from "./registry";

export const publicClient = createPublicClient({ chain: monad, transport: http() });

export type Balance = { token: TokenMeta; amount: number };

/** Native MON + all ERC20 registry balances for a wallet (one multicall). */
export async function getBalances(wallet: `0x${string}`): Promise<Balance[]> {
  const [native, erc20Results] = await Promise.all([
    publicClient.getBalance({ address: wallet }),
    publicClient.multicall({
      contracts: ERC20_TOKENS.map((t) => ({
        address: t.address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [wallet] as const
      })),
      allowFailure: true
    })
  ]);

  const out: Balance[] = [];

  const mon = REGISTRY.find((t) => t.isNative);
  if (mon) out.push({ token: mon, amount: Number(formatUnits(native, mon.decimals)) });

  ERC20_TOKENS.forEach((t, i) => {
    const r = erc20Results[i];
    if (r.status !== "success") return;
    const amount = Number(formatUnits(r.result as bigint, t.decimals));
    if (amount > 0) out.push({ token: t, amount });
  });

  return out;
}

export type VerifiedSwap = {
  success: boolean;
  from: `0x${string}`;
  /** Net token-unit change the wallet received (+ve) or sent (−ve), by lowercased address. */
  erc20Deltas: Map<string, number>;
  /** Native MON change in token units (+ve received, −ve sent), gas excluded. */
  nativeDelta: number;
  /** False when the native leg could not be read from historical state. */
  nativeExact: boolean;
};

/**
 * Verify a swap tx on-chain and extract the wallet's real deltas. ERC20 legs come
 * from the receipt's Transfer logs; the native leg comes from the receipt's
 * sender value (spend) and a historical balance diff (receive). Values come from
 * the chain, never from client claims.
 */
export async function verifySwap(txHash: Hash, wallet: `0x${string}`): Promise<VerifiedSwap | null> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return null;

  const tx = await publicClient.getTransaction({ hash: txHash }).catch(() => null);

  const w = wallet.toLowerCase();
  const erc20Deltas = new Map<string, number>();

  const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  for (const log of logs) {
    const addr = log.address.toLowerCase();
    const meta = REGISTRY.find((t) => t.address.toLowerCase() === addr);
    if (!meta) continue;
    const { from, to, value } = log.args as { from: string; to: string; value: bigint };
    const units = Number(formatUnits(value, meta.decimals));
    if (to.toLowerCase() === w) erc20Deltas.set(addr, (erc20Deltas.get(addr) ?? 0) + units);
    if (from.toLowerCase() === w) erc20Deltas.set(addr, (erc20Deltas.get(addr) ?? 0) - units);
  }

  // Native leg. Only the tx sender moves native MON in a swap.
  let nativeDeltaWei = BigInt(0);
  let nativeExact = true;
  if (tx && tx.from.toLowerCase() === w) {
    const gas = receipt.gasUsed * (receipt.effectiveGasPrice ?? BigInt(0));
    try {
      // Net change over the tx's block, with the gas the sender paid added back.
      const [before, after] = await Promise.all([
        publicClient.getBalance({ address: wallet, blockNumber: receipt.blockNumber - BigInt(1) }),
        publicClient.getBalance({ address: wallet, blockNumber: receipt.blockNumber })
      ]);
      nativeDeltaWei = after - before + gas;
    } catch {
      // No historical state available. A native SPEND is still exact from the tx
      // value; a native RECEIVE (tx.value === 0) would be invisible, so flag it.
      nativeDeltaWei = -tx.value;
      nativeExact = tx.value > BigInt(0);
    }
  }

  return {
    success: receipt.status === "success",
    from: receipt.from,
    erc20Deltas,
    nativeDelta: Number(formatUnits(nativeDeltaWei, 18)),
    nativeExact
  };
}
