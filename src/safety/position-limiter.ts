// Position limiter — max concurrent positions

export class PositionLimiter {
  private openPositions = 0;
  private maxPositions: number;

  constructor(maxPositions: number) {
    this.maxPositions = maxPositions;
  }

  canOpen(): boolean {
    return this.openPositions < this.maxPositions;
  }

  open(): void {
    if (!this.canOpen()) throw new Error("Max concurrent positions reached");
    this.openPositions++;
  }

  close(): void {
    if (this.openPositions > 0) this.openPositions--;
  }

  getOpenCount(): number {
    return this.openPositions;
  }
}