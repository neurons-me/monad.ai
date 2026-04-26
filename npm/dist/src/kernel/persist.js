"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupPersistence = setupPersistence;
const manager_js_1 = require("./manager.js");
let _registered = false;
function setupPersistence() {
    if (_registered)
        return;
    _registered = true;
    const shutdown = (signal) => {
        console.log(`[kernel] ${signal} — saving snapshot before exit`);
        (0, manager_js_1.saveSnapshot)();
        process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("beforeExit", () => (0, manager_js_1.saveSnapshot)());
}
