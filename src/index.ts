// CLI entry — Live PumpPortal by default when LIVE_TRADING + key present; else paper (real feed)

import "dotenv/config";
import { BotEngine } from "./bot/engine.js";
import { BotEventBus } from "./bot/event-bus.js";
import type { TradingMode } from "./bot/types.js";

async function main() {
  const wantLive =
    process.env.LIVE_TRADING === "true" || process.env.LIVE === "true";
  const mode: TradingMode = wantLive ? "live" : "paper";
  const profile = process.env.RISK_PROFILE ?? (mode === "live" ? "sniper" : "paper");
  const useMockFeed = process.env.MOCK_FEED === "true";

  const bus = new BotEventBus();
  bus.onEvent((event) => {
    if (event.type === "log") {
      console.log(`[${event.level.toUpperCase().padEnd(5)}] ${event.message}`);
      return;
    }
    if (event.type === "positions") {
      console.log(
        `[POS  ] open=${event.positions.length} bal=${event.balanceSol.toFixed(4)} realized=${event.realizedPnlSol.toFixed(4)}`
      );
      return;
    }
    if (event.type === "status") {
      console.log(
        `[STAT ] running=${event.running} mode=${event.mode} feed=${event.feed} dryRun=${event.dryRun} positions=${event.openPositions}`
      );
      return;
    }
    if (event.type === "error") console.error(`[ERROR] ${event.message}`);
  });

  const engine = new BotEngine({ bus });

  console.log("=== Solana Sniper Bot ===");
  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`Feed: ${useMockFeed ? "MOCK (offline)" : "PumpPortal LIVE WS"}`);
  console.log(`Profile: ${profile}`);

  await engine.start({
    type: "start",
    mode,
    profile,
    useMockFeed,
    liveTrading: wantLive,
    dryRun: process.env.DRY_RUN === "true",
    rpcUrl: process.env.SOLANA_RPC_URL,
    fallbackRpcUrl: process.env.SOLANA_RPC_FALLBACK_URL,
    walletBalanceSol: parseFloat(process.env.WALLET_BALANCE_SOL ?? "1"),
    privateKey: process.env.PRIVATE_KEY,
  });

  process.on("SIGINT", () => {
    void engine.stop().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void engine.stop().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
