import { getBlocksForIdentity } from "./blockchain.js";
import { getClaim } from "../claim/records.js";
import { appendSemanticMemory, buildSemanticTreeForNamespace, listSemanticMemoriesByNamespace } from "../claim/memoryStore.js";
import { getRootNamespace } from "../kernel/manager.js";
import { composeProjectedNamespace, normalizeNamespaceRootName } from "../namespace/identity.js";
function normalizeUsername(raw) {
    return String(raw || "").trim().toLowerCase();
}
function getProjectedUsersForConfiguredRoot() {
    return getUsersForRootNamespace(getRootNamespace());
}
export function getAllUsers() {
    return getProjectedUsersForConfiguredRoot().sort((a, b) => a.createdAt - b.createdAt);
}
function readProjectedUsersMetadata(rootNamespace) {
    const tree = buildSemanticTreeForNamespace(rootNamespace);
    const usersBranch = tree.users;
    const records = {};
    if (!usersBranch || typeof usersBranch !== "object" || Array.isArray(usersBranch)) {
        return records;
    }
    for (const [username, record] of Object.entries(usersBranch)) {
        if (!record || typeof record !== "object" || Array.isArray(record))
            continue;
        records[username] = record;
    }
    return records;
}
export function getUsersForRootNamespace(rootNamespaceInput) {
    const rootNamespace = normalizeNamespaceRootName(rootNamespaceInput);
    if (!rootNamespace)
        return [];
    const rows = listSemanticMemoriesByNamespace(rootNamespace);
    const pointerRows = rows.filter((row) => /^users\.[a-z0-9_-]+$/i.test(row.path));
    const seen = new Set();
    const users = [];
    const projectedMetadata = readProjectedUsersMetadata(rootNamespace);
    for (const row of pointerRows) {
        const match = row.path.match(/^users\.([a-z0-9_-]+)$/i);
        const username = normalizeUsername(String(match?.[1] || ""));
        if (!username || seen.has(username))
            continue;
        seen.add(username);
        const ptr = row.data;
        const projectedNamespace = String(ptr?.__ptr || "").trim().toLowerCase()
            || composeProjectedNamespace(username, rootNamespace);
        const claim = projectedNamespace ? getClaim(projectedNamespace) : undefined;
        const metadata = projectedMetadata[username] || {};
        users.push({
            username,
            identityHash: String(claim?.identityHash || metadata.identityHash || "").trim(),
            publicKey: String(claim?.publicKey || metadata.publicKey || "").trim(),
            createdAt: Number(claim?.createdAt || metadata.createdAt || row.timestamp || 0),
            updatedAt: Number(claim?.updatedAt || metadata.updatedAt || row.timestamp || 0),
        });
    }
    return users;
}
export function getUser(username) {
    const normalized = normalizeUsername(username);
    if (!normalized)
        return undefined;
    return getAllUsers().find((user) => user.username === normalized);
}
export function claimUser(username, identityHash, publicKey) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedIdentityHash = String(identityHash || "").trim();
    const normalizedPublicKey = String(publicKey || "").trim();
    if (!normalizedUsername)
        return { ok: false, error: "USERNAME_REQUIRED" };
    if (!normalizedIdentityHash)
        return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
    if (!normalizedPublicKey)
        return { ok: false, error: "PUBLIC_KEY_REQUIRED" };
    if (getUser(normalizedUsername)) {
        return { ok: false, error: "USERNAME_TAKEN" };
    }
    const now = Date.now();
    const rootNamespace = getRootNamespace();
    const projectedNamespace = composeProjectedNamespace(normalizedUsername, rootNamespace);
    const nextUser = {
        username: normalizedUsername,
        identityHash: normalizedIdentityHash,
        publicKey: normalizedPublicKey,
        createdAt: now,
        updatedAt: now,
    };
    appendSemanticMemory({
        namespace: rootNamespace,
        path: `users.${normalizedUsername}`,
        operator: "__",
        data: { __ptr: projectedNamespace },
        timestamp: now,
    });
    appendSemanticMemory({
        namespace: rootNamespace,
        path: `users.${normalizedUsername}.identityHash`,
        data: normalizedIdentityHash,
        timestamp: now,
    });
    appendSemanticMemory({
        namespace: rootNamespace,
        path: `users.${normalizedUsername}.publicKey`,
        data: normalizedPublicKey,
        timestamp: now,
    });
    appendSemanticMemory({
        namespace: rootNamespace,
        path: `users.${normalizedUsername}.createdAt`,
        data: now,
        timestamp: now,
    });
    appendSemanticMemory({
        namespace: rootNamespace,
        path: `users.${normalizedUsername}.updatedAt`,
        data: now,
        timestamp: now,
    });
    return { ok: true, user: nextUser };
}
export function countBlocksForUser(identityHash) {
    return getBlocksForIdentity(identityHash).length;
}
