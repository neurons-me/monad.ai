import { saveSnapshot } from "./manager.js";

let _registered = false;

export function setupPersistence(): void {
  if (_registered) return;
  _registered = true;

  const shutdown = (signal: string) => {
    console.log(`[kernel] ${signal} — saving snapshot before exit`);
    saveSnapshot();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("beforeExit", () => saveSnapshot());
}
