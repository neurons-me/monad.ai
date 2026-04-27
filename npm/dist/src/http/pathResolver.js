"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNamespacePathValue = resolveNamespacePathValue;
exports.createPathResolverHandler = createPathResolverHandler;
const memoryStore_1 = require("../claim/memoryStore");
const namespace_1 = require("./namespace");
const meTarget_1 = require("./meTarget");
const envelope_1 = require("./envelope");
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
    return {
        namespace,
        path: dotPath,
        found: false,
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
