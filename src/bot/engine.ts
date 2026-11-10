// Bot engine — live PumpPortal listen + real trade path (paper is optional safe mode)

import { SolanaRpcClient } from "../services/rpc-client.js";
import { getRiskProfile, listRiskProfiles } from "../config/risk-profiles.js";
import { Sniper } from "../strategies/sniper.js";
import { ExitManager } from "../strategies/exit-manager.js";
import { TokenDetector } from "../services/token-detector.js";
import { JitoBundler } from "../services/jito-bundler.js";
import { enrichTokenMetrics, DEFAULT_SOL_PRICE_USD } from "../services/token-metrics.js";
import { checkPaperHoneypot } from "../services/paper-honeypot.js";
import { checkLiveHoneypot } from "../services/live-honeypot.js";
import { PriceOracle } from "../services/price-oracle.js";
import { PaperExecutor } from "../execution/paper-executor.js";
import {
  LiveExecutor,
  assertLiveTradingAllowed,
} from "../execution/live-executor.js";
import type { ExecutionAdapter } from "../execution/adapter.js";
import { BotEventBus } from "./event-bus.js";
import type {
  BotStartCommand,
  PositionSnapshot,
  TradingMode,
} from "./types.js";

export interface EngineOptions {
  bus?: BotEventBus;
}

export class BotEngine {
  private bus: BotEventBus;
  private running = false;
  private mode: TradingMode = "live";
  private profileName = "sniper";
  private detector: TokenDetector | null = null;
  private sniper: Sniper | null = null;
  private exitManager = new ExitManager();
  private executor: ExecutionAdapter | null = null;
  private paperExecutor: PaperExecutor | null = null;
  private liveExecutor: LiveExecutor | null = null;
  private priceOracle = new PriceOracle();
  private exitTimer: ReturnType<typeof setInterval> | null = null;
  private solPriceUsd = DEFAULT_SOL_PRICE_USD;
  private walletBalanceSol = 1;
  private processing = new Set<string>();
  private mockFeed = false;
  private dryRun = false;
  private priceCache = new Map<string, number>();

  constructor(options?: EngineOptions) {
    this.bus = options?.bus ?? new BotEventBus();
  }

  getBus(): BotEventBus {
    return this.bus;
  }

  isRunning(): boolean {
    return this.running;
  }

  static profiles(): string[] {
    return listRiskProfiles();
  }

  async start(cmd: BotStartCommand): Promise<void> {
    if (this.running) {
      this.bus.log("warn", "Bot already running");
      return;
    }

    this.mode = cmd.mode === "paper" ? "paper" : "live";
    this.profileName =
      cmd.profile ?? (this.mode === "paper" ? "paper" : "sniper");
    this.walletBalanceSol = cmd.walletBalanceSol ?? Number(process.env.WALLET_BALANCE_SOL ?? 1);
    this.solPriceUsd = cmd.solPriceUsd ?? Number(process.env.SOL_PRICE_USD ?? DEFAULT_SOL_PRICE_USD);
    this.dryRun = cmd.dryRun === true || process.env.DRY_RUN === "true";

    const rpcUrl =
      cmd.rpcUrl ??
      process.env.SOLANA_RPC_URL ??
      "https://api.mainnet-beta.solana.com";
    const fallbackUrl = cmd.fallbackRpcUrl ?? process.env.SOLANA_RPC_FALLBACK_URL;

    if (this.mode === "live") {
      const gate = assertLiveTradingAllowed({
        env: process.env,
        privateKey: cmd.privateKey ?? process.env.PRIVATE_KEY,
        rpcUrl,
        liveConfirmed: cmd.liveTrading === true,
      });
      if (!gate.ok) {
        this.bus.log("error", `Live trading blocked: ${gate.reasons.join("; ")}`);
        this.bus.emitEvent({
          type: "error",
          message: `Live trading blocked: ${gate.reasons.join("; ")}`,
          ts: Date.now(),
        });
        throw new Error(`Live trading blocked: ${gate.reasons.join("; ")}`);
      }
    }

    const profile = getRiskProfile(this.profileName);
    const rpc = new SolanaRpcClient({
      primaryUrl: rpcUrl,
      fallbackUrl,
      commitment: "confirmed",
    });

    this.sniper = new Sniper(rpc, profile, this.walletBalanceSol);
    this.exitManager = new ExitManager();
    this.priceOracle = new PriceOracle();
    this.priceCache.clear();

    if (this.mode === "paper") {
      this.paperExecutor = new PaperExecutor(this.walletBalanceSol);
      this.executor = this.paperExecutor;
      this.liveExecutor = null;
    } else {
      const jitoUrl = cmd.jitoUrl ?? process.env.JITO_BLOCK_ENGINE_URL;
      const jitoTip = cmd.jitoTipLamports ?? parseInt(process.env.JITO_TIP_LAMPORTS ?? "10000", 10);
      const jito = jitoUrl ? new JitoBundler({ blockEngineUrl: jitoUrl, tipLamports: jitoTip }) : null;
      const privateKey = cmd.privateKey ?? process.env.PRIVATE_KEY!;
      const live = new LiveExecutor({
        rpcUrl,
        privateKeyBase58: privateKey,
        jito,
        dryRun: this.dryRun,
      });
      this.liveExecutor = live;
      this.executor = live;
      this.paperExecutor = null;
      this.bus.log(
        "warn",
        `LIVE MODE${this.dryRun ? " (DRY-RUN — no broadcast)" : ""} — wallet ${live.getPublicKey().slice(0, 4)}…${live.getPublicKey().slice(-4)} | exec=PumpPortal trade-local`
      );
      try {
        this.walletBalanceSol = await live.refreshSolBalance();
      } catch {
        this.bus.log("warn", "Could not refresh live SOL balance");
      }
    }

    // Mock feed ONLY when explicitly requested — default is live PumpPortal
    this.mockFeed =
      cmd.useMockFeed === true || process.env.MOCK_FEED === "true";

    this.detector = new TokenDetector();
    this.detector.onNewToken((token) => {
      void this.onNewToken(token);
    });

    this.running = true;
    this.detector.connect({ mock: this.mockFeed });

    this.exitTimer = setInterval(() => {
      void this.tickExits();
    }, 2000);

    this.bus.log(
      "info",
      `Started ${this.mode.toUpperCase()} | profile=${this.profileName} | feed=${this.mockFeed ? "MOCK" : "PumpPortal live"} | balance=${this.walletBalanceSol.toFixed(4)} SOL`
    );
    this.emitStatus();
    this.emitPositions();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.exitTimer) {
      clearInterval(this.exitTimer);
      this.exitTimer = null;
    }
    this.detector?.disconnect();
    this.detector = null;
    this.priceOracle.stop();
    this.bus.log("info", "Bot stopped");
    this.emitStatus();
  }

  private async onNewToken(token: {
    mint: string;
    name: string;
    symbol: string;
    creator: string;
    timestamp: number;
    initialLiquiditySol?: number;
    raw?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.running || !this.sniper || !this.executor) return;
    if (!token.mint || this.processing.has(token.mint)) return;
    if (this.exitManager.getPosition(token.mint)) return;

    this.processing.add(token.mint);
    try {
      const metrics = enrichTokenMetrics(token, this.solPriceUsd, token.raw);
      this.priceOracle.setPrice(metrics.mint, metrics.entryPriceSolPerToken, "bonding-curve");
      this.priceCache.set(metrics.mint, metrics.entryPriceSolPerToken);

      this.bus.log(
        "info",
        `[New] ${metrics.symbol} (${metrics.mint.slice(0, 8)}…) liqSol=${metrics.liquiditySol ?? "?"} liq≈$${metrics.liquidityUsd.toFixed(0)} age=${metrics.tokenAgeSeconds.toFixed(1)}s unknowns=[${metrics.unknowns.join(",") || "none"}]`
      );

      const result = await this.sniper.evaluate({
        mint: metrics.mint,
        liquidityUsd: metrics.liquidityUsd,
        tokenAgeSeconds: metrics.tokenAgeSeconds,
        riskInput: metrics.riskInput,
      });

      if (!result.shouldSnipe) {
        this.bus.log("skip", `[Skip] ${metrics.symbol}: ${result.reasons.join("; ")}`);
        return;
      }

      const profile = this.sniper.getProfile();
      if (profile.honeypotCheck) {
        if (this.mode === "live" && this.liveExecutor) {
          const hp = await checkLiveHoneypot({
            rpc: this.sniper.getRpc(),
            keypair: this.liveExecutor.getKeypair(),
            mint: metrics.mint,
            slippageBps: profile.maxSlippageBps,
          });
          if (hp.status === "fail") {
            this.bus.log("skip", `[Honeypot FAIL] ${metrics.symbol}: ${hp.detail}`);
            return;
          }
          if (hp.status === "unknown") {
            this.bus.log(
              "warn",
              `[Honeypot UNKNOWN] ${metrics.symbol}: ${hp.detail} — continuing (not faking OK)`
            );
          } else {
            this.bus.log("debug", `[Honeypot PASS] ${metrics.symbol}: ${hp.detail}`);
          }
        } else {
          const hp = checkPaperHoneypot({
            risk: metrics.riskInput,
            liquiditySol: metrics.liquiditySol,
            symbol: metrics.symbol,
          });
          if (hp.isHoneypot) {
            this.bus.log(
              "skip",
              `[Honeypot] ${metrics.symbol}: ${hp.sellError ?? hp.buyError ?? "failed"}`
            );
            return;
          }
        }
      }

      const balance =
        this.mode === "live"
          ? (await this.liveExecutor?.refreshSolBalance()) ?? this.walletBalanceSol
          : this.executor.getBalances().sol || this.walletBalanceSol;
      this.walletBalanceSol = balance;

      const solAmount = Math.max(0.001, (balance * profile.maxPositionPct) / 100);
      if (this.mode === "live" && balance < solAmount + 0.005) {
        this.bus.log(
          "error",
          `[Buy skipped] ${metrics.symbol}: insufficient SOL (${balance.toFixed(4)} < ${solAmount.toFixed(4)} + fees)`
        );
        return;
      }

      const buy = await this.executor.buy({
        mint: metrics.mint,
        symbol: metrics.symbol,
        solAmount,
        priceSolPerToken: metrics.entryPriceSolPerToken,
        slippageBps: profile.maxSlippageBps,
      });

      if (!buy.ok) {
        this.bus.log("error", `[Buy failed] ${metrics.symbol}: ${buy.reason}`);
        return;
      }

      this.sniper.getPositionLimiter().open();
      this.exitManager.openPosition({
        mint: metrics.mint,
        symbol: metrics.symbol,
        entryPrice: buy.price,
        amount: buy.tokenAmount,
        costSol: buy.solAmount,
        takeProfitPct: profile.takeProfitPct,
        stopLossPct: profile.stopLossPct,
        trailingPct: profile.trailingStopPct,
        openedAt: Date.now(),
        mode: this.mode,
      });

      this.priceOracle.setPrice(metrics.mint, buy.price, "bonding-curve");
      this.priceCache.set(metrics.mint, buy.price);
      this.priceOracle.ensureTradeFeed([metrics.mint]);

      this.bus.log(
        "trade",
        `[BUY ${this.mode}${buy.simulated ? "/dry" : ""}] ${metrics.symbol} ${buy.solAmount.toFixed(4)} SOL → ~${buy.tokenAmount.toFixed(2)} tok @ ${buy.price.toExponential(3)} via ${buy.reason ?? "exec"} (${buy.signature})`
      );
      this.emitPositions();
      this.emitStatus();
    } catch (err) {
      this.bus.log("error", `Handler error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.processing.delete(token.mint);
    }
  }

  private async tickExits(): Promise<void> {
    if (!this.running || !this.executor || !this.sniper) return;
    const positions = this.exitManager.getOpenPositions();
    if (positions.length === 0) {
      this.emitPositions();
      return;
    }

    this.priceOracle.ensureTradeFeed(positions.map((p) => p.mint));

    for (const pos of positions) {
      const price = this.resolveMarkPrice(pos.mint, pos.entryPrice, pos.openedAt);
      this.priceCache.set(pos.mint, price);

      const action = this.exitManager.evaluate(pos.mint, price);
      if (action === "hold") continue;

      const sell = await this.executor.sell({
        mint: pos.mint,
        symbol: pos.symbol,
        tokenAmount: pos.amount,
        priceSolPerToken: price,
        reason: action,
      });

      if (!sell.ok) {
        this.bus.log("error", `[Sell failed] ${pos.symbol}: ${sell.reason}`);
        continue;
      }

      const closed = this.exitManager.closePosition(pos.mint);
      this.sniper.getPositionLimiter().close();
      const pnl = sell.solAmount - (closed?.costSol ?? pos.costSol);
      if (this.paperExecutor) this.paperExecutor.recordRealizedPnl(pnl);
      if (this.liveExecutor) this.liveExecutor.recordRealizedPnl(pnl);
      if (pnl < 0) this.sniper.getCircuitBreaker().recordLoss(-pnl);

      this.bus.log(
        "trade",
        `[SELL ${this.mode}${sell.simulated ? "/dry" : ""}] ${pos.symbol} via ${action} | PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL (${sell.signature})`
      );
    }

    this.emitPositions();
    this.emitStatus();
  }

  private resolveMarkPrice(mint: string, entryPrice: number, openedAt: number): number {
    if (this.paperExecutor) {
      return this.paperExecutor.simulatePrice(mint, entryPrice, Date.now() - openedAt);
    }
    const quote = this.priceOracle.resolve(mint, this.priceCache.get(mint) ?? entryPrice);
    return quote.priceSolPerToken;
  }

  private buildPositionSnapshots(): PositionSnapshot[] {
    return this.exitManager.getOpenPositions().map((pos) => {
      const currentPrice = this.resolveMarkPrice(pos.mint, pos.entryPrice, pos.openedAt);
      const source = this.paperExecutor
        ? "paper-sim"
        : this.priceOracle.getPrice(pos.mint)?.source ?? "entry-fallback";
      const mtm = pos.amount * currentPrice;
      const unrealized = mtm - pos.costSol;
      const pct = pos.costSol > 0 ? (unrealized / pos.costSol) * 100 : 0;
      return {
        mint: pos.mint,
        symbol: pos.symbol,
        entryPrice: pos.entryPrice,
        currentPrice,
        amountTokens: pos.amount,
        costSol: pos.costSol,
        unrealizedPnlSol: unrealized,
        unrealizedPnlPct: pct,
        takeProfitPct: pos.takeProfitPct,
        stopLossPct: pos.stopLossPct,
        trailingPct: pos.trailingPct,
        openedAt: pos.openedAt,
        mode: pos.mode,
        priceSource: source,
      };
    });
  }

  emitPositions(): void {
    const balances = this.executor?.getBalances() ?? {
      sol: this.walletBalanceSol,
      realizedPnlSol: 0,
    };
    this.bus.emitEvent({
      type: "positions",
      positions: this.buildPositionSnapshots(),
      balanceSol: balances.sol || this.walletBalanceSol,
      realizedPnlSol: balances.realizedPnlSol,
      ts: Date.now(),
    });
  }

  emitStatus(): void {
    this.bus.emitEvent({
      type: "status",
      running: this.running,
      mode: this.mode,
      profile: this.profileName,
      circuitBreakerTripped: this.sniper?.getCircuitBreaker().isTripped() ?? false,
      openPositions: this.exitManager.getOpenPositions().length,
      feed: this.mockFeed ? "mock" : "pumpportal",
      dryRun: this.dryRun,
      ts: Date.now(),
    });
  }
}
