import { listSemanticMemoriesByRootNamespace } from "../claim/memoryStore.js";
import { getClaim } from "../claim/records.js";
import { getRootNamespace } from "../kernel/manager.js";
import { composeProjectedNamespace, normalizeNamespaceIdentity } from "../namespace/identity.js";
function resolveProjectedNamespaceFromRootMemory(row) {
    const ptr = row.data;
    const fromPtr = String(ptr?.__ptr || "").trim().toLowerCase();
    if (fromPtr)
        return normalizeNamespaceIdentity(fromPtr);
    const match = String(row.path || "").match(/^users\.([a-z0-9_-]+)/i);
    const username = String(match?.[1] || "").trim().toLowerCase();
    if (!username)
        return "";
    return composeProjectedNamespace(username, getRootNamespace());
}
function resolveAuthor(row) {
    const projectedNamespace = row.namespace === getRootNamespace()
        ? resolveProjectedNamespaceFromRootMemory(row)
        : normalizeNamespaceIdentity(row.namespace);
    const claim = projectedNamespace ? getClaim(projectedNamespace) : undefined;
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
        namespace: normalizeNamespaceIdentity(row.namespace),
        path: String(row.path || ""),
        operator: row.operator ?? null,
        value: row.data,
        signature: row.signature ?? null,
        ...resolveAuthor(row),
    };
}
export function getAllBlocks() {
    return listSemanticMemoriesByRootNamespace(getRootNamespace(), { limit: 100000 }).map(semanticRowToBlock);
}
export function getBlocksForIdentity(identityHash) {
    const target = String(identityHash || "").trim();
    if (!target)
        return [];
    return getAllBlocks().filter((row) => String(row.authorIdentityHash || "") === target);
}
export function getBlocksForNamespace(namespace) {
    const target = normalizeNamespaceIdentity(namespace);
    if (!target)
        return [];
    return getAllBlocks().filter((row) => row.namespace === target);
}
