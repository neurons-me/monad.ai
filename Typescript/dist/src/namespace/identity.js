import os from "os";
// @ts-ignore — cleaker ships named exports at runtime but its .d.ts only declares a default
import { composeNamespace, parseNamespaceExpression } from "cleaker";
export const DEFAULT_LOCAL_NAMESPACE_ROOT = "monad.local";
function normalizeRawNamespace(input) {
    return String(input || "").trim().toLowerCase();
}
function stripPort(raw) {
    return String(raw || "").trim().toLowerCase().replace(/:\d+$/i, "");
}
function normalizeHostLike(raw) {
    const value = stripPort(raw)
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return value;
}
function isLoopbackishHost(raw) {
    const host = stripPort(raw);
    return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/.test(host);
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
        return parseNamespaceExpression(raw);
    }
    catch {
        return null;
    }
}
function resolveLocalNamespaceRoot() {
    const configured = normalizeRawNamespace(process.env.MONAD_LOCAL_ALIAS_ROOT ||
        process.env.ME_NAMESPACE ||
        process.env.MONAD_SELF_IDENTITY ||
        process.env.MONAD_SELF_HOSTNAME ||
        "");
    if (configured) {
        const parsed = tryParseNamespace(configured);
        const constant = stripPort(parsed?.constant || configured);
        if (constant)
            return constant;
    }
    const host = normalizeHostLike(String(os.hostname() || ""));
    if (host) {
        return host.includes(".") ? host : `${host}.local`;
    }
    return DEFAULT_LOCAL_NAMESPACE_ROOT;
}
function canonicalizeNamespaceConstant(input) {
    const constant = stripPort(String(input || ""));
    if (!constant)
        return "";
    if (isLoopbackishHost(constant)) {
        return resolveLocalNamespaceRoot();
    }
    return constant;
}
function composeIdentityNamespace(prefix, constant) {
    const normalizedPrefix = String(prefix || "").trim().toLowerCase();
    const normalizedConstant = canonicalizeNamespaceConstant(constant);
    if (!normalizedConstant)
        return normalizedPrefix;
    if (!normalizedPrefix)
        return normalizedConstant;
    try {
        return composeNamespace(normalizedPrefix, normalizedConstant);
    }
    catch {
        return `${normalizedPrefix}.${normalizedConstant}`;
    }
}
export function normalizeNamespaceIdentity(input) {
    const raw = normalizeRawNamespace(input);
    if (!raw)
        return "";
    const legacy = parseLegacyUserNamespace(raw);
    if (legacy)
        return composeIdentityNamespace(legacy.username, legacy.host);
    const parsed = tryParseNamespace(raw);
    if (parsed) {
        return composeIdentityNamespace(parsed.prefix || null, parsed.constant || raw);
    }
    return canonicalizeNamespaceConstant(raw);
}
export function normalizeNamespaceConstant(input) {
    const raw = normalizeRawNamespace(input);
    if (!raw)
        return "";
    const legacy = parseLegacyUserNamespace(raw);
    if (legacy)
        return canonicalizeNamespaceConstant(legacy.host);
    const parsed = tryParseNamespace(raw);
    return canonicalizeNamespaceConstant(parsed?.constant || raw);
}
export function normalizeNamespaceRootName(input) {
    return normalizeNamespaceConstant(input);
}
export function isProjectableNamespaceRoot(input) {
    const raw = normalizeNamespaceIdentity(input);
    if (!raw)
        return false;
    if (parseLegacyUserNamespace(raw))
        return false;
    const parsed = tryParseNamespace(raw);
    if (parsed)
        return !parsed.prefix;
    return Boolean(normalizeNamespaceConstant(raw));
}
export function composeProjectedNamespace(username, rootNamespace) {
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const constant = normalizeNamespaceConstant(rootNamespace);
    if (!normalizedUsername)
        return constant;
    if (!constant)
        return normalizedUsername;
    try {
        return composeNamespace(normalizedUsername, constant);
    }
    catch {
        return `${normalizedUsername}.${constant}`;
    }
}
export function parseNamespaceIdentityParts(input) {
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
