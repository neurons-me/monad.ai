"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeNamespaceIdentity = normalizeNamespaceIdentity;
exports.normalizeNamespaceConstant = normalizeNamespaceConstant;
exports.isProjectableNamespaceRoot = isProjectableNamespaceRoot;
exports.composeProjectedNamespace = composeProjectedNamespace;
exports.parseNamespaceIdentityParts = parseNamespaceIdentityParts;
const cleaker_1 = require("cleaker");
function normalizeRawNamespace(input) {
    return String(input || "").trim().toLowerCase();
}
function parseLegacyUserNamespace(raw) {
    const match = String(raw || "").trim().toLowerCase().match(/^([^/\[]+)\/users\/([^/\[]+)$/i);
    if (!match)
        return null;
    const host = String(match[1] || "").trim().toLowerCase();
    const username = String(match[2] || "").trim().toLowerCase();
    if (!host || !username)
        return null;
    return {
        host,
        username,
        namespace: `${host}/users/${username}`,
    };
}
function tryParseNamespace(raw) {
    try {
        return (0, cleaker_1.parseNamespaceExpression)(raw);
    }
    catch {
        return null;
    }
}
function normalizeNamespaceIdentity(input) {
    const raw = normalizeRawNamespace(input);
    if (!raw)
        return "";
    const legacy = parseLegacyUserNamespace(raw);
    if (legacy)
        return legacy.namespace;
    const parsed = tryParseNamespace(raw);
    return parsed?.fqdn || raw;
}
function normalizeNamespaceConstant(input) {
    const raw = normalizeRawNamespace(input);
    if (!raw)
        return "";
    const legacy = parseLegacyUserNamespace(raw);
    if (legacy)
        return legacy.host;
    const parsed = tryParseNamespace(raw);
    return parsed?.constant || raw;
}
function isProjectableNamespaceRoot(input) {
    const raw = normalizeNamespaceIdentity(input);
    if (!raw)
        return false;
    if (parseLegacyUserNamespace(raw))
        return false;
    const parsed = tryParseNamespace(raw);
    if (parsed)
        return !parsed.prefix;
    const parts = raw.split(".").filter(Boolean);
    if (parts.length === 1 && parts[0] === "localhost")
        return true;
    if (parts.length === 2 && parts[1] === "localhost")
        return false;
    return parts.length === 2;
}
function composeProjectedNamespace(username, rootNamespace) {
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const constant = normalizeNamespaceConstant(rootNamespace);
    if (!normalizedUsername)
        return constant;
    if (!constant)
        return normalizedUsername;
    try {
        return (0, cleaker_1.composeNamespace)(normalizedUsername, constant);
    }
    catch {
        return `${normalizedUsername}.${constant}`;
    }
}
function parseNamespaceIdentityParts(input) {
    const namespace = normalizeNamespaceIdentity(input);
    if (!namespace) {
        return {
            host: "unknown",
            username: "",
            effective: "unclaimed",
        };
    }
    const legacy = parseLegacyUserNamespace(namespace);
    if (legacy) {
        return {
            host: legacy.host,
            username: legacy.username,
            effective: `@${legacy.username}.${legacy.host}`,
        };
    }
    const parsed = tryParseNamespace(namespace);
    if (parsed) {
        const host = parsed.constant || namespace;
        const username = parsed.prefix || "";
        return {
            host,
            username,
            effective: username ? `@${username}.${host}` : `@${host}`,
        };
    }
    return {
        host: namespace,
        username: "",
        effective: `@${namespace}`,
    };
}
