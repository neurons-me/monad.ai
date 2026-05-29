import { normalizeNamespaceIdentity, parseNamespaceIdentityParts } from "../namespace/identity.js";
const RESERVED_SHORT_NAMESPACES = new Set(["self", "kernel", "local"]);
export function normalizeOperation(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (raw === "claim" || raw === "open" || raw === "read" || raw === "write") {
        return raw;
    }
    return "write";
}
export function normalizeClaimableNamespace(raw) {
    return normalizeNamespaceIdentity(raw);
}
export function isCanonicalClaimableNamespace(namespace) {
    const ns = normalizeClaimableNamespace(namespace);
    if (!ns)
        return false;
    if (RESERVED_SHORT_NAMESPACES.has(ns))
        return true;
    return ns.includes(".");
}
export function resolveCommandNamespace(operation, body, parsedTarget, fallbackNamespace) {
    const bodyNamespace = normalizeClaimableNamespace(body.namespace);
    if (bodyNamespace)
        return bodyNamespace;
    if ((operation === "claim" || operation === "open") && parsedTarget?.namespace === "kernel") {
        const commandPath = normalizeClaimableNamespace(parsedTarget.pathSlash || parsedTarget.pathDot);
        if (commandPath)
            return commandPath;
    }
    return normalizeClaimableNamespace(parsedTarget?.namespace || fallbackNamespace);
}
export function getDefaultReadPolicy(namespace) {
    const identity = parseNamespaceIdentityParts(namespace);
    const allowed = ["profile/*", "me/public/*", `${namespace}/*`];
    if (identity.host)
        allowed.push(`${identity.host}/*`);
    return { allowed, capabilities: ["read"] };
}
export function parseNamespaceIdentity(namespace) {
    return parseNamespaceIdentityParts(namespace);
}
