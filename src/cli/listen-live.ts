// Prove live PumpPortal WS: receive real new-token events, enrich metrics, optional dry trade-local build

import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { TokenDetector } from "../services/token-detector.js";
import { enrichTokenMetrics } from "../services/token-metrics.js";
import { scoreTokenRisk } from "../services/risk-scorer.js";
import { getRiskProfile } from "../config/risk-profiles.js";
import { buildTradeLocalTx } from "../services/pumpportal-trade.js";

const DURATION_MS = Number(process.env.LISTEN_MS ?? 45000);
const DRY_BUILD = process.env.DRY_BUILD_TX === "true";

async function main() {
  console.log("=== Live PumpPortal listen ===");
  console.log(`Listening up to ${DURATION_MS}ms for real new-token events…`);

  const detector = new TokenDetector();
  const profile = getRiskProfile("sniper");
  let count = 0;
  let lastMint = "";

  detector.onNewToken(async (token) => {
    count += 1;
    const metrics = enrichTokenMetrics(token, Number(process.env.SOL_PRICE_USD ?? 150), token.raw);
    const risk = scoreTokenRisk(metrics.riskInput, {
      minLiquidityUsd: profile.minLiquidityUsd,
      maxTokenAgeSeconds: profile.maxTokenAgeSeconds,
    });
    lastMint = metrics.mint;
    console.log(
      `[#${count}] ${metrics.symbol} ${metrics.mint.slice(0, 12)}… liqSol=${metrics.liquiditySol ?? "?"} ≈$${metrics.liquidityUsd.toFixed(0)} risk=${risk.score} pass=${risk.pass}`
    );

    if (DRY_BUILD && count === 1) {
      const kp = process.env.PRIVATE_KEY
        ? Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY))
        : Keypair.generate();
      console.log(`Dry-building trade-local buy for ${metrics.mint.slice(0, 8)}… as ${kp.publicKey.toBase58().slice(0, 8)}…`);
      const built = await buildTradeLocalTx({
        publicKey: kp.publicKey.toBase58(),
        action: "buy",
        mint: metrics.mint,
        amount: 0.01,
        denominatedInSol: true,
        slippagePct: 10,
        priorityFeeSol: 0.00005,
        pool: "auto",
      });
      console.log(
        built.ok
          ? `trade-local OK — got unsigned VersionedTransaction (${built.rawBytes?.byteLength ?? 0} bytes)`
          : `trade-local FAIL — ${built.error}`
      );
    }
  });

  detector.connect({ mock: false });

  await new Promise((r) => setTimeout(r, DURATION_MS));
  detector.disconnect();

  console.log(`\nDone. real_events=${count} last_mint=${lastMint || "(none)"}`);
  if (count < 1) {
    console.warn("No events in window — PumpPortal may be quiet or blocked; retry later.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
