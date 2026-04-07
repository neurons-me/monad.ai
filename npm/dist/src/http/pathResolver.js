"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNamespacePathValue = resolveNamespacePathValue;
exports.createPathResolverHandler = createPathResolverHandler;
const blockchain_1 = require("../Blockchain/blockchain");
const memoryStore_1 = require("../claim/memoryStore");
const namespace_1 = require("./namespace");
const meTarget_1 = require("./meTarget");
const envelope_1 = require("./envelope");
function decodeBlockPayload(block) {
    const rawJson = block?.json;
    const outer = typeof rawJson === "string"
        ? JSON.parse(rawJson)
        : rawJson;
    if (!outer || typeof outer !== "object")
        return null;
    const embedded = outer.json;
    if (typeof embedded === "string") {
        try {
            const inner = JSON.parse(embedded);
            if (inner && typeof inner === "object") {
                return inner;
            }
        }
        catch {
        }
    }
    return outer;
}
function getByPath(obj, path) {
    const parts = String(path || "").split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur == null)
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function setDeep(obj, path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
        const key = parts[i];
        const isLast = i === parts.length - 1;
        if (isLast) {
            if (!(key in cur))
                cur[key] = value;
        }
        else {
            if (typeof cur[key] !== "object" || cur[key] == null || Array.isArray(cur[key])) {
                cur[key] = {};
            }
            cur = cur[key];
        }
    }
}
function normalizeDotPath(input) {
    return String(input || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\//g, ".")
        .split(".")
        .filter(Boolean)
        .join(".");
}
async function resolveNamespacePathValue(namespaceInput, dotPathInput) {
    const namespace = String(namespaceInput || "").trim();
    const dotPath = normalizeDotPath(dotPathInput);
    if (!dotPath) {
        return {
            namespace,
            path: dotPath,
            found: false,
        };
    }
    const semanticResolved = (0, memoryStore_1.readSemanticBranchForNamespace)(namespace, dotPath);
    if (typeof semanticResolved !== "undefined") {
        return {
            namespace,
            path: dotPath,
            value: semanticResolved,
            found: true,
        };
    }
    const all = await (0, blockchain_1.getAllBlocks)();
    const blocks = all
        .filter((b) => String(b?.namespace || "") === namespace)
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
    const state = {};
    for (const bRaw of blocks) {
        const b = bRaw;
        try {
            const payload = decodeBlockPayload(b);
            if (!payload)
                continue;
            const expr = String(payload.expression || b?.expression || "").trim();
            if (!expr)
                continue;
            const value = Object.prototype.hasOwnProperty.call(payload ?? {}, "value")
                ? payload.value
                : payload;
            if (!(expr in state))
                state[expr] = value;
        }
        catch {
        }
    }
    if (dotPath in state) {
        return {
            namespace,
            path: dotPath,
            value: state[dotPath],
            found: true,
        };
    }
    const tree = {};
    for (const [expr, value] of Object.entries(state)) {
        setDeep(tree, expr, value);
    }
    const resolved = getByPath(tree, dotPath);
    if (typeof resolved === "undefined") {
        return {
            namespace,
            path: dotPath,
            found: false,
        };
    }
    return {
        namespace,
        path: dotPath,
        value: resolved,
        found: true,
    };
}
function createPathResolverHandler() {
    return async (req, res) => {
        const rawPath = String(req.path || "");
        const trimmed = rawPath.replace(/^\/+/, "").replace(/\/+$/, "");
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        if (!trimmed) {
            return res.status(404).json((0, envelope_1.createErrorEnvelope)(target, { error: "NOT_FOUND" }));
        }
        const namespace = (0, namespace_1.resolveNamespace)(req);
        const segments0 = trimmed.split("/").filter(Boolean);
        let segments = segments0;
        if (segments.length > 0 && segments[0].startsWith("@")) {
            segments = segments.slice(1);
            if (segments.length > 0 && segments0.length > 1 && segments0[1].startsWith("@")) {
                segments = segments.slice(1);
            }
        }
        const dotPath = normalizeDotPath(segments.join("/"));
        if (!dotPath) {
            return res.status(404).json((0, envelope_1.createErrorEnvelope)(target, { error: "NOT_FOUND" }));
        }
        const resolved = await resolveNamespacePathValue(namespace, dotPath);
        if (!resolved.found) {
            return res.status(404).json((0, envelope_1.createErrorEnvelope)(target, {
                namespace,
                path: dotPath,
                error: "PATH_NOT_FOUND",
            }));
        }
        return res.json((0, envelope_1.createEnvelope)(target, {
            namespace: resolved.namespace,
            path: resolved.path,
            value: resolved.value,
        }));
    };
}
