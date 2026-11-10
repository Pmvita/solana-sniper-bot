// RPC client — implements Jupiter's transaction pipeline patterns
// Fee estimation → Simulation → Send → Confirm

import {
  Connection,
  Transaction,
  VersionedTransaction,
  PublicKey,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

export interface RpcConfig {
  primaryUrl: string;
  fallbackUrl?: string;
  commitment?: "processed" | "confirmed" | "finalized";
}

export class SolanaRpcClient {
  private connection: Connection;
  private fallbackConnection: Connection | null = null;
  private commitment: "processed" | "confirmed" | "finalized";

  constructor(config: RpcConfig) {
    this.connection = new Connection(config.primaryUrl, config.commitment ?? "confirmed");
    this.commitment = config.commitment ?? "confirmed";
    if (config.fallbackUrl) {
      this.fallbackConnection = new Connection(config.fallbackUrl, config.commitment ?? "confirmed");
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  // Fee estimation — always call before sending (Jupiter pattern)
  async estimateFee(tx: VersionedTransaction | Transaction): Promise<bigint> {
    try {
      const message = tx instanceof VersionedTransaction ? tx.message : tx.compileMessage();
      const { value } = await this.connection.getFeeForMessage(message, this.commitment);
      return BigInt(value ?? 0);
    } catch {
      if (this.fallbackConnection) {
        const message = tx instanceof VersionedTransaction ? tx.message : tx.compileMessage();
        const { value } = await this.fallbackConnection.getFeeForMessage(message, this.commitment);
        return BigInt(value ?? 0);
      }
      throw new Error("Fee estimation failed on all RPCs");
    }
  }

  // Dynamic priority fee — Helius getPriorityFeeEstimate pattern
  async getPriorityFeeEstimate(accounts: PublicKey[]): Promise<number> {
    try {
      const response = await fetch(this.connection.rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getPriorityFeeEstimate",
          params: [
            {
              accountKeys: accounts.map((a) => a.toBase58()),
              options: { recommended: true },
            },
          ],
        }),
      });
      const data = (await response.json()) as { result?: { priorityFeeEstimate?: number } };
      return data.result?.priorityFeeEstimate ?? 0;
    } catch {
      return 0; // Fall back to 0 if estimate fails
    }
  }

  // Simulation — catch errors before sending (Jupiter pattern)
  async simulateTransaction(
    tx: VersionedTransaction,
    replaceBlockhash = false
  ): Promise<{ logs: string[]; error: unknown; hasError: boolean; hasFunds: boolean }> {
    try {
      const { value } = await this.connection.simulateTransaction(tx, {
        commitment: "confirmed",
        replaceRecentBlockhash: replaceBlockhash,
      });
      const logs = value.logs ?? [];
      const hasFunds = logs.every(
        (l) => !/insufficient funds/gi.test(l) && !/insufficient lamports/gi.test(l)
      );
      return {
        logs,
        error: value.err,
        hasError: !!value.err,
        hasFunds,
      };
    } catch (err) {
      if (!replaceBlockhash && String(err).includes("BlockhashNotFound")) {
        return this.simulateTransaction(tx, true);
      }
      throw err;
    }
  }

  // Send transaction with preflight
  async sendTransaction(tx: VersionedTransaction): Promise<string> {
    const signature = await this.connection.sendTransaction(tx, {
      preflightCommitment: "confirmed",
    });
    return signature;
  }

  // Confirm with timeout (Jupiter: 10s)
  async confirmTransaction(signature: string, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.connection.getSignatureStatus(signature);
      if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
        return true;
      }
      if (status.value?.err) {
        return false;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Transaction confirmation timed out");
  }

  // Build priority fee instructions
  buildPriorityFeeInstructions(
    computeUnits: number,
    priorityFeeMicroLamports: number
  ): ReturnType<typeof ComputeBudgetProgram.setComputeUnitLimit>[] {
    return [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }),
    ];
  }
}