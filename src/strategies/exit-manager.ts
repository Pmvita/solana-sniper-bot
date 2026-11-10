// Exit manager — take-profit, stop-loss, trailing

export type ExitAction = "hold" | "take-profit" | "stop-loss" | "trailing-stop";

export interface Position {
  mint: string;
  symbol: string;
  entryPrice: number;
  amount: number;
  costSol: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingPct?: number;
  highestPrice?: number;
  openedAt: number;
  mode: "paper" | "live";
}

export class ExitManager {
  private positions: Map<string, Position> = new Map();

  openPosition(pos: Position): void {
    this.positions.set(pos.mint, { ...pos, highestPrice: pos.entryPrice });
  }

  closePosition(mint: string): Position | undefined {
    const pos = this.positions.get(mint);
    this.positions.delete(mint);
    return pos;
  }

  getPosition(mint: string): Position | undefined {
    return this.positions.get(mint);
  }

  /** Returns action needed for this mint at currentPrice */
  evaluate(mint: string, currentPrice: number): ExitAction {
    const pos = this.positions.get(mint);
    if (!pos) return "hold";

    const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

    if (pnlPct >= pos.takeProfitPct) {
      return "take-profit";
    }

    if (pnlPct <= -pos.stopLossPct) {
      return "stop-loss";
    }

    if (pos.trailingPct && pos.highestPrice !== undefined) {
      if (currentPrice > pos.highestPrice) {
        pos.highestPrice = currentPrice;
      }
      const drawdown = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;
      if (drawdown >= pos.trailingPct) {
        return "trailing-stop";
      }
    }

    return "hold";
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values());
  }
}
