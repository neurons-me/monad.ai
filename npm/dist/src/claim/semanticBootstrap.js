"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureRootSemanticBootstrap = ensureRootSemanticBootstrap;
const db_1 = require("../Blockchain/db");
const identity_1 = require("../namespace/identity");
const memoryStore_1 = require("./memoryStore");
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
function getLatestSemanticValue(namespace, path) {
    const row = db_1.db
        .prepare(`
      SELECT data
      FROM semantic_memories
      WHERE namespace = ? AND path = ?
      ORDER BY id DESC
      LIMIT 1
    `)
        .get(namespace, path);
    if (!row)
        return undefined;
    try {
        return JSON.parse(String(row.data || "null"));
    }
    catch {
        return row.data;
    }
}
function ensureSemanticMemory(namespace, path, data, operator = "=", timestamp) {
    const latest = getLatestSemanticValue(namespace, path);
    if (typeof latest !== "undefined" && stableStringify(latest) === stableStringify(data)) {
        return false;
    }
    (0, memoryStore_1.appendSemanticMemory)({
        namespace,
        path,
        operator,
        data,
        timestamp,
    });
    return true;
}
function ensureRootSemanticBootstrap(rootNamespaceInput) {
    const rootNamespace = (0, identity_1.normalizeNamespaceRootName)(rootNamespaceInput);
    if (!rootNamespace)
        return 0;
    const timestamp = Date.now();
    const seeds = [
        { path: "schema.role.group.status", data: "adopted" },
        { path: "schema.role.group.behavior.type", data: "entity" },
        { path: "schema.role.group.suggest.contains", data: ["member", "policy", "channel"] },
        { path: "schema.role.member.status", data: "adopted" },
        { path: "schema.role.member.behavior.type", data: "collection" },
        { path: "schema.role.member.behavior.iterator", data: "username" },
        { path: "schema.role.member.suggest.contains", data: ["identity", "permissions", "joined_at"] },
    ];
    let inserted = 0;
    for (const seed of seeds) {
        if (ensureSemanticMemory(rootNamespace, seed.path, seed.data, seed.operator || "=", timestamp)) {
            inserted += 1;
        }
    }
    return inserted;
}
