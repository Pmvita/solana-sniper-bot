// Circuit breaker — auto-pause on loss threshold

export class CircuitBreaker {
  private dailyLossSol = 0;
  private dailyLossLimitSol: number;
  private tripped = false;
  private resetAt: Date;

  constructor(dailyLossLimitPct: number, walletBalanceSol: number) {
    this.dailyLossLimitSol = (walletBalanceSol * dailyLossLimitPct) / 100;
    this.resetAt = this.nextMidnight();
  }

  private nextMidnight(): Date {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d;
  }

  recordLoss(solAmount: number): void {
    this.dailyLossSol += solAmount;
    if (this.dailyLossSol >= this.dailyLossLimitSol) {
      this.tripped = true;
    }
  }

  isTripped(): boolean {
    if (new Date() >= this.resetAt) {
      this.dailyLossSol = 0;
      this.tripped = false;
      this.resetAt = this.nextMidnight();
    }
    return this.tripped;
  }

  getStatus(): { tripped: boolean; dailyLoss: number; limit: number; resetsAt: string } {
    return {
      tripped: this.tripped,
      dailyLoss: this.dailyLossSol,
      limit: this.dailyLossLimitSol,
      resetsAt: this.resetAt.toISOString(),
    };
  }
}