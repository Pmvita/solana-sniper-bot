// OFFLINE ONLY — mock feed smoke test (not the product path)

import "dotenv/config";
import { BotEngine } from "../bot/engine.js";
import { BotEventBus } from "../bot/event-bus.js";

async function main() {
  console.log("=== Offline smoke (MOCK_FEED) — not live trading ===");
  const bus = new BotEventBus();
  let trades = 0;

  bus.onEvent((event) => {
    if (event.type === "log") {
      console.log(`[${event.level}] ${event.message}`);
      if (event.level === "trade") trades += 1;
    }
  });

  const engine = new BotEngine({ bus });
  await engine.start({
    type: "start",
    mode: "paper",
    profile: "paper",
    useMockFeed: true,
    walletBalanceSol: 1,
  });

  await new Promise((r) => setTimeout(r, 18_000));
  await engine.stop();
  console.log(`offline_smoke trade_events=${trades}`);
  if (trades < 1) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
