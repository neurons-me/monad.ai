"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeHttpRequestToMeTarget = normalizeHttpRequestToMeTarget;
const namespace_1 = require("./namespace");
function normalizePathSegments(rawPath) {
    const trimmed = String(rawPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed)
        return "";
    const segments0 = trimmed.split("/").filter(Boolean);
    let segments = segments0;
    if (segments.length > 0 && segments[0].startsWith("@")) {
        segments = segments.slice(1);
        if (segments.length > 0 && segments0.length > 1 && segments0[1].startsWith("@")) {
            segments = segments.slice(1);
        }
    }
    return segments.join(".");
}
function inferOperation(req) {
    if (req.method === "POST" && req.path === "/claims")
        return "claim";
    if (req.method === "POST" && req.path === "/claims/open")
        return "open";
    if (req.method === "POST")
        return "write";
    return "read";
}
function inferNamespace(req) {
    const operation = inferOperation(req);
    const body = (req.body ?? {});
    const hinted = String(body.namespace || "").trim();
    if (hinted)
        return hinted;
    if (operation === "claim" || operation === "open") {
        return (0, namespace_1.resolveNamespace)(req);
    }
    return (0, namespace_1.resolveNamespace)(req);
}
function normalizeHttpRequestToMeTarget(req) {
    const host = (0, namespace_1.resolveTransportHost)(req);
    const operation = inferOperation(req);
    const namespace = inferNamespace(req);
    const path = operation === "claim" || operation === "open"
        ? ""
        : normalizePathSegments(req.path);
    return {
        host,
        namespace,
        operation,
        path,
        nrp: `me://${namespace}:${operation}/${path || "_"}`,
    };
}
