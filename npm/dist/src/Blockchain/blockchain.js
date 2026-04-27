"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllBlocks = getAllBlocks;
exports.getBlocksForIdentity = getBlocksForIdentity;
exports.getBlocksForNamespace = getBlocksForNamespace;
const memoryStore_js_1 = require("../claim/memoryStore.js");
const records_js_1 = require("../claim/records.js");
const manager_js_1 = require("../kernel/manager.js");
const identity_js_1 = require("../namespace/identity.js");
function resolveProjectedNamespaceFromRootMemory(row) {
    const ptr = row.data;
    const fromPtr = String(ptr?.__ptr || "").trim().toLowerCase();
    if (fromPtr)
        return (0, identity_js_1.normalizeNamespaceIdentity)(fromPtr);
    const match = String(row.path || "").match(/^users\.([a-z0-9_-]+)/i);
    const username = String(match?.[1] || "").trim().toLowerCase();
    if (!username)
        return "";
    return (0, identity_js_1.composeProjectedNamespace)(username, (0, manager_js_1.getRootNamespace)());
}
function resolveAuthor(row) {
    const projectedNamespace = row.namespace === (0, manager_js_1.getRootNamespace)()
        ? resolveProjectedNamespaceFromRootMemory(row)
        : (0, identity_js_1.normalizeNamespaceIdentity)(row.namespace);
    const claim = projectedNamespace ? (0, records_js_1.getClaim)(projectedNamespace) : undefined;
    if (!claim)
        return {};
    return {
        authorIdentityHash: String(claim.identityHash || "").trim() || undefined,
        authorPublicKey: String(claim.publicKey || "").trim() || undefined,
    };
}
function semanticRowToBlock(row) {
    return {
        memoryHash: String(row.hash || ""),
        prevMemoryHash: String(row.prevHash || ""),
        timestamp: Number(row.timestamp || 0),
        namespace: (0, identity_js_1.normalizeNamespaceIdentity)(row.namespace),
        path: String(row.path || ""),
        operator: row.operator ?? null,
        value: row.data,
        signature: row.signature ?? null,
        ...resolveAuthor(row),
    };
}
function getAllBlocks() {
    return (0, memoryStore_js_1.listSemanticMemoriesByRootNamespace)((0, manager_js_1.getRootNamespace)(), { limit: 100000 }).map(semanticRowToBlock);
}
function getBlocksForIdentity(identityHash) {
    const target = String(identityHash || "").trim();
    if (!target)
        return [];
    return getAllBlocks().filter((row) => String(row.authorIdentityHash || "") === target);
}
function getBlocksForNamespace(namespace) {
    const target = (0, identity_js_1.normalizeNamespaceIdentity)(namespace);
    if (!target)
        return [];
    return getAllBlocks().filter((row) => row.namespace === target);
}
