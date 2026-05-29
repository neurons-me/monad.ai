import { saveSnapshot } from "./manager.js";
let _registered = false;
export function setupPersistence() {
    if (_registered)
        return;
    _registered = true;
    const shutdown = (signal) => {
        console.log(`[kernel] ${signal} — saving snapshot before exit`);
        saveSnapshot();
        process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("beforeExit", () => saveSnapshot());
}
