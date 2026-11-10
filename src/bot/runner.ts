// JSON-lines IPC runner for Electron / external controllers
// stdin: BotInboundCommand JSON per line
// stdout: BotOutboundEvent JSON per line

import { BotEngine } from "./engine.js";
import { BotEventBus } from "./event-bus.js";
import type { BotInboundCommand } from "./types.js";
import * as readline from "node:readline";

const bus = new BotEventBus();
const engine = new BotEngine({ bus });

function writeEvent(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

bus.onEvent((event) => {
  writeEvent(event);
});

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  void (async () => {
    try {
      const cmd = JSON.parse(trimmed) as BotInboundCommand;
      switch (cmd.type) {
        case "ping":
          writeEvent({ type: "log", level: "info", message: "pong", ts: Date.now() });
          break;
        case "start":
          await engine.start(cmd);
          break;
        case "stop":
          await engine.stop();
          break;
        default: {
          const _exhaustive: never = cmd;
          writeEvent({
            type: "error",
            message: `Unknown command: ${JSON.stringify(_exhaustive)}`,
            ts: Date.now(),
          });
        }
      }
    } catch (err) {
      writeEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
    }
  })();
});

writeEvent({
  type: "log",
  level: "info",
  message: "Runner ready — send {\"type\":\"start\"} to begin",
  ts: Date.now(),
});

async function shutdown(): Promise<void> {
  await engine.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
