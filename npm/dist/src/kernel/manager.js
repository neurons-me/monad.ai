"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKernel = getKernel;
exports.saveSnapshot = saveSnapshot;
exports.kernelReady = kernelReady;
const this_me_1 = __importDefault(require("this.me"));
const fs_1 = require("fs");
const path_1 = require("path");
const ME_STATE_DIR = (0, path_1.resolve)(process.cwd(), "me-state");
const SNAPSHOT_PATH = (0, path_1.resolve)(ME_STATE_DIR, "snapshot.json");
let _kernel = null;
function getKernel() {
    if (_kernel)
        return _kernel;
    const seed = process.env.ME_SEED;
    if (!seed)
        throw new Error("ME_SEED is required — set it in your environment before starting monad.ai");
    (0, fs_1.mkdirSync)(ME_STATE_DIR, { recursive: true });
    _kernel = new this_me_1.default(seed, {
        store: new this_me_1.default.DiskStore({ baseDir: ME_STATE_DIR }),
    });
    if ((0, fs_1.existsSync)(SNAPSHOT_PATH)) {
        try {
            const raw = (0, fs_1.readFileSync)(SNAPSHOT_PATH, "utf8");
            _kernel.hydrate(JSON.parse(raw));
            console.log("[kernel] hydrated from snapshot");
        }
        catch (e) {
            console.warn("[kernel] snapshot hydration failed, starting fresh:", e);
        }
    }
    return _kernel;
}
function saveSnapshot() {
    if (!_kernel)
        return;
    try {
        (0, fs_1.mkdirSync)(ME_STATE_DIR, { recursive: true });
        const snapshot = _kernel.exportSnapshot();
        (0, fs_1.writeFileSync)(SNAPSHOT_PATH, JSON.stringify(snapshot), "utf8");
        console.log("[kernel] snapshot saved to", SNAPSHOT_PATH);
    }
    catch (e) {
        console.error("[kernel] snapshot save failed:", e);
    }
}
function kernelReady() {
    return _kernel !== null;
}
