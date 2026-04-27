"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureRootSemanticBootstrap = ensureRootSemanticBootstrap;
const identity_1 = require("../namespace/identity");
const memoryStore_1 = require("./memoryStore");
const semanticCatalog_1 = require("./semanticCatalog");
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
function ensureSemanticMemory(namespace, path, data, operator = "=", timestamp) {
    const latest = (0, memoryStore_1.readSemanticValueForNamespace)(namespace, path);
    if (typeof latest !== "undefined" && stableStringify(latest) === stableStringify(data)) {
        return false;
    }
    (0, memoryStore_1.appendSemanticMemory)({ namespace, path, operator, data, timestamp });
    return true;
}
function ensureRootSemanticBootstrap(rootNamespaceInput) {
    const rootNamespace = (0, identity_1.normalizeNamespaceRootName)(rootNamespaceInput);
    if (!rootNamespace)
        return 0;
    const timestamp = Date.now();
    let inserted = 0;
    for (const seed of semanticCatalog_1.ROOT_SCHEMA_SEEDS) {
        if (ensureSemanticMemory(rootNamespace, seed.path, seed.data, seed.operator || "=", timestamp)) {
            inserted += 1;
        }
    }
    return inserted;
}
