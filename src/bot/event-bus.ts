// Simple typed event bus for bot → UI / CLI

import { EventEmitter } from "node:events";
import type { BotOutboundEvent } from "./types.js";

export class BotEventBus extends EventEmitter {
  emitEvent(event: BotOutboundEvent): void {
    this.emit("event", event);
    if (event.type === "log") {
      this.emit("log", event);
    }
  }

  onEvent(handler: (event: BotOutboundEvent) => void): void {
    this.on("event", handler);
  }

  log(
    level: Extract<BotOutboundEvent, { type: "log" }>["level"],
    message: string
  ): void {
    this.emitEvent({ type: "log", level, message, ts: Date.now() });
  }
}
