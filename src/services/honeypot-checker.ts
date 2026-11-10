// Honeypot checker — simulate buy + sell before committing real capital

import { VersionedTransaction } from "@solana/web3.js";
import { SolanaRpcClient } from "./rpc-client.js";

export interface HoneypotResult {
  isHoneypot: boolean;
  buySimOk: boolean;
  sellSimOk: boolean;
  buyError?: string;
  sellError?: string;
  estimatedOutput?: bigint;
}

export class HoneypotChecker {
  private rpc: SolanaRpcClient;

  constructor(rpc: SolanaRpcClient) {
    this.rpc = rpc;
  }

  async check(
    buyTx: VersionedTransaction,
    sellTx: VersionedTransaction
  ): Promise<HoneypotResult> {
    // Simulate buy
    const buySim = await this.rpc.simulateTransaction(buyTx);
    if (buySim.hasError) {
      return {
        isHoneypot: true,
        buySimOk: false,
        sellSimOk: false,
        buyError: String(buySim.error),
      };
    }

    // Simulate sell (the critical check — honeypots block sells)
    const sellSim = await this.rpc.simulateTransaction(sellTx);
    if (sellSim.hasError) {
      return {
        isHoneypot: true,
        buySimOk: true,
        sellSimOk: false,
        sellError: String(sellSim.error),
      };
    }

    // Check for insufficient funds in logs (another honeypot signal)
    if (!buySim.hasFunds || !sellSim.hasFunds) {
      return {
        isHoneypot: true,
        buySimOk: buySim.hasFunds,
        sellSimOk: sellSim.hasFunds,
        buyError: buySim.hasFunds ? undefined : "Insufficient funds in buy sim",
        sellError: sellSim.hasFunds ? undefined : "Insufficient funds in sell sim",
      };
    }

    return {
      isHoneypot: false,
      buySimOk: true,
      sellSimOk: true,
    };
  }
}