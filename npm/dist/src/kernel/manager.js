"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKernelStateDir = getKernelStateDir;
exports.getKernelStatePath = getKernelStatePath;
exports.getKernel = getKernel;
exports.saveSnapshot = saveSnapshot;
exports.kernelReady = kernelReady;
exports.getRootNamespace = getRootNamespace;
exports.namespaceToKernelPrefix = namespaceToKernelPrefix;
exports.kernelPathFor = kernelPathFor;
exports.resetKernelStateForTests = resetKernelStateForTests;
const this_me_1 = __importDefault(require("this.me"));
const fs_1 = require("fs");
const path_1 = require("path");
const DEFAULT_ME_STATE_DIR = (0, path_1.resolve)(process.cwd(), "me-state");
let _kernel = null;
function getKernelStateDir() {
    const configured = String(process.env.ME_STATE_DIR || "").trim();
    return configured ? (0, path_1.resolve)(configured) : DEFAULT_ME_STATE_DIR;
}
function getKernelStatePath(...segments) {
    return (0, path_1.resolve)(getKernelStateDir(), ...segments);
}
function getKernel() {
    if (_kernel)
        return _kernel;
    const seed = process.env.ME_SEED;
    if (!seed)
        throw new Error("ME_SEED is required — set it in your environment before starting monad.ai");
    (0, fs_1.mkdirSync)(getKernelStateDir(), { recursive: true });
    _kernel = new this_me_1.default(seed, {
        store: new this_me_1.default.DiskStore({ baseDir: getKernelStateDir() }),
    });
    const snapshotPath = getKernelStatePath("snapshot.json");
    if ((0, fs_1.existsSync)(snapshotPath)) {
        try {
            const raw = (0, fs_1.readFileSync)(snapshotPath, "utf8");
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
        const snapshotPath = getKernelStatePath("snapshot.json");
        (0, fs_1.mkdirSync)(getKernelStateDir(), { recursive: true });
        const snapshot = _kernel.exportSnapshot();
        (0, fs_1.writeFileSync)(snapshotPath, JSON.stringify(snapshot), "utf8");
        console.log("[kernel] snapshot saved to", snapshotPath);
    }
    catch (e) {
        console.error("[kernel] snapshot save failed:", e);
    }
}
function kernelReady() {
    return _kernel !== null;
}
function getRootNamespace() {
    return String(process.env.ME_NAMESPACE || process.env.MONAD_SELF_IDENTITY || "localhost").trim().toLowerCase();
}
function namespaceToKernelPrefix(namespace) {
    const ns = namespace.trim().toLowerCase();
    const root = getRootNamespace();
    if (ns === root)
        return "";
    if (ns.endsWith(`.${root}`)) {
        const username = ns.slice(0, -(root.length + 1)).split(".")[0] ?? ns;
        return `users.${username}`;
    }
    // Unknown domain — not a managed namespace, do not assume identity
    return "";
}
function kernelPathFor(namespace, path) {
    const prefix = namespaceToKernelPrefix(namespace);
    return prefix ? `${prefix}.${path}` : path;
}
function resetKernelStateForTests() {
    _kernel = null;
    (0, fs_1.rmSync)(getKernelStateDir(), { recursive: true, force: true });
}
