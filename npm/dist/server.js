"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const os_1 = __importDefault(require("os"));
const manager_js_1 = require("./src/kernel/manager.js");
const persist_js_1 = require("./src/kernel/persist.js");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const blockchain_1 = require("./src/Blockchain/blockchain");
const users_1 = require("./src/Blockchain/users");
const records_1 = require("./src/claim/records");
const semanticBootstrap_1 = require("./src/claim/semanticBootstrap");
const replay_1 = require("./src/claim/replay");
const records_2 = require("./src/claim/records");
const replay_2 = require("./src/claim/replay");
const memoryStore_1 = require("./src/claim/memoryStore");
const namespace_1 = require("./src/http/namespace");
const meTarget_1 = require("./src/http/meTarget");
const envelope_1 = require("./src/http/envelope");
const pathResolver_1 = require("./src/http/pathResolver");
const claims_1 = require("./src/http/claims");
const session_1 = require("./src/http/session");
const legacy_1 = require("./src/http/legacy");
const selfMapping_1 = require("./src/http/selfMapping");
const surfaceTelemetry_1 = require("./src/http/surfaceTelemetry");
const provider_1 = require("./src/http/provider");
const identity_1 = require("./src/namespace/identity");
const cleaker_1 = require("cleaker");
const shell_1 = require("./src/http/shell");
const PORT = process.env.PORT || 8161;
const NODE_HOSTNAME = os_1.default.hostname();
const NODE_DISPLAY_NAME = `${NODE_HOSTNAME}:${PORT}`;
const FETCH_PROXY_TIMEOUT_MS = Number(process.env.MONAD_FETCH_TIMEOUT_MS || 15000);
const ME_PKG_DIST_DIR = process.env.ME_PKG_DIST_DIR
    ? path_1.default.resolve(process.env.ME_PKG_DIST_DIR)
    : path_1.default.resolve(process.cwd(), "../../../this/.me/npm/dist");
const CLEAKER_PKG_DIST_DIR = process.env.CLEAKER_PKG_DIST_DIR
    ? path_1.default.resolve(process.env.CLEAKER_PKG_DIST_DIR)
    : path_1.default.resolve(process.cwd(), "../../cleaker/npm/dist");
const LOCAL_REACT_UMD_DIR = process.env.LOCAL_REACT_UMD_DIR
    ? path_1.default.resolve(process.env.LOCAL_REACT_UMD_DIR)
    : path_1.default.resolve(process.cwd(), "../../../this/GUI/npm/node_modules/react/umd");
const LOCAL_REACTDOM_UMD_DIR = process.env.LOCAL_REACTDOM_UMD_DIR
    ? path_1.default.resolve(process.env.LOCAL_REACTDOM_UMD_DIR)
    : path_1.default.resolve(process.cwd(), "../../../this/GUI/npm/node_modules/react-dom/umd");
const MONAD_ROUTES_PATH = process.env.MONAD_ROUTES_PATH
    ? path_1.default.resolve(process.env.MONAD_ROUTES_PATH)
    : path_1.default.resolve(process.cwd(), "../routes.js");
const SELF_NODE_CONFIG = (0, selfMapping_1.loadSelfNodeConfig)({
    cwd: process.cwd(),
    env: process.env,
    hostname: NODE_HOSTNAME,
    port: PORT,
});
const LOCAL_NAMESPACE_ROOT = (0, identity_1.normalizeNamespaceIdentity)(SELF_NODE_CONFIG?.identity || "localhost");
const app = (0, express_1.default)();
app.set("trust proxy", true);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const rebuiltProjectedClaims = (0, records_1.rebuildProjectedNamespaceClaims)();
if (rebuiltProjectedClaims > 0) {
    console.log(`↺ Rebuilt ${rebuiltProjectedClaims} projected user pointers into root namespaces`);
}
const semanticBootstrapRoot = (0, identity_1.normalizeNamespaceRootName)(SELF_NODE_CONFIG?.identity || LOCAL_NAMESPACE_ROOT);
const seededSemanticBootstrap = (0, semanticBootstrap_1.ensureRootSemanticBootstrap)(semanticBootstrapRoot);
if (seededSemanticBootstrap > 0) {
    console.log(`∷ Seeded ${seededSemanticBootstrap} root semantic memories in ${semanticBootstrapRoot}`);
}
const RESERVED_SHORT_NAMESPACES = new Set(["self", "kernel", "local"]);
function resolveRequestOrigin(req, fallbackHost) {
    const host = (0, namespace_1.resolveTransportHost)(req);
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host || host;
    return `${req.protocol}://${String(hostHeader || fallbackHost || host).trim()}`;
}
function resolveRequestSurfaceRoute(req) {
    const hinted = String(req.query?.route || "").trim();
    return (0, provider_1.normalizeSurfaceRoute)(hinted || req.path || "/");
}
function buildRequestSurfaceEntry(req, namespace) {
    const origin = resolveRequestOrigin(req, NODE_HOSTNAME);
    return (0, selfMapping_1.buildSelfSurfaceEntry)({
        self: SELF_NODE_CONFIG,
        origin,
        fallbackHost: NODE_HOSTNAME,
        requestNamespace: namespace,
    });
}
function buildRequestProviderBoot(req, namespace) {
    return (0, provider_1.buildNamespaceProviderBoot)({
        namespace,
        route: resolveRequestSurfaceRoute(req),
        origin: resolveRequestOrigin(req, NODE_HOSTNAME),
        resolverHostName: NODE_HOSTNAME,
        resolverDisplayName: NODE_DISPLAY_NAME,
        surfaceEntry: buildRequestSurfaceEntry(req, namespace),
    });
}
function extractNamespaceSelector(namespace) {
    const raw = String(namespace || "").trim();
    if (!raw)
        return { base: "", selectorRaw: null };
    const match = raw.match(/^([^\[]+)(?:\[(.*)\])?$/);
    if (!match)
        return { base: raw, selectorRaw: null };
    return {
        base: String(match[1] || "").trim(),
        selectorRaw: match[2] === undefined ? null : String(match[2] || "").trim(),
    };
}
function findSelectorValue(selectorRaw, selectorType) {
    const type = String(selectorType || "").trim().toLowerCase();
    if (!type)
        return null;
    const groups = selectorRaw
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
    for (const group of groups) {
        const parts = group
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean);
        for (const part of parts) {
            const colon = part.indexOf(":");
            if (colon < 0)
                continue;
            const head = part.slice(0, colon).trim().toLowerCase();
            if (!head || head !== type)
                continue;
            const rest = part.slice(colon + 1).trim();
            if (!rest)
                continue;
            const value = rest.split(",")[0]?.trim();
            if (value)
                return value;
        }
    }
    return null;
}
function normalizeWebUrl(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return null;
    if (/^https?:\/\//i.test(raw))
        return raw;
    return `https://${raw.replace(/^\/+/, "")}`;
}
function parseHttpFetchUrl(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return null;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function getNamespaceSelectorInfo(namespace) {
    const { base, selectorRaw } = extractNamespaceSelector(namespace);
    if (!selectorRaw) {
        return {
            base,
            selectorRaw: null,
            webTarget: null,
            hasDevice: false,
        };
    }
    const webValue = findSelectorValue(selectorRaw, "web");
    const webTarget = webValue ? normalizeWebUrl(webValue) : null;
    const deviceValue = findSelectorValue(selectorRaw, "device");
    const hostValue = findSelectorValue(selectorRaw, "host");
    const hasDevice = !!(deviceValue || hostValue);
    return {
        base,
        selectorRaw,
        webTarget,
        hasDevice,
    };
}
function parseBridgeTarget(rawInput) {
    const raw = String(rawInput || "").trim();
    if (!raw)
        return null;
    try {
        const parsed = (0, cleaker_1.parseTarget)(raw.startsWith("me://") ? raw : `me://${raw}`, { allowShorthandRead: true });
        const namespace = (0, identity_1.normalizeNamespaceIdentity)(parsed.namespace.fqdn);
        if (!namespace)
            return null;
        const selector = String(parsed.operation || parsed.intent.selector || "read").trim() || "read";
        const pathSlash = String(parsed.path || "").trim().replace(/^\/+/, "");
        const pathDot = pathSlash
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean)
            .join(".");
        const nrp = `me://${namespace}:${selector}/${pathDot || "_"}`;
        return {
            namespace,
            selector,
            pathSlash,
            pathDot,
            nrp,
        };
    }
    catch {
        return null;
    }
}
function toStableJson(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => toStableJson(item)).join(",")}]`;
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${toStableJson(obj[key])}`);
    return `{${entries.join(",")}}`;
}
function computeProofId(input) {
    return (0, crypto_1.createHash)("sha256").update(toStableJson(input)).digest("hex");
}
function parseNamespaceIdentity(namespace) {
    return (0, identity_1.parseNamespaceIdentityParts)(namespace);
}
function getDefaultReadPolicy(namespace) {
    const identity = parseNamespaceIdentity(namespace);
    const allowed = ["profile/*", "me/public/*", `${namespace}/*`];
    if (identity.host) {
        allowed.push(`${identity.host}/*`);
    }
    return {
        allowed,
        capabilities: ["read"],
    };
}
function normalizeOperation(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (raw === "claim" || raw === "open" || raw === "read" || raw === "write") {
        return raw;
    }
    return "write";
}
function normalizeClaimableNamespace(raw) {
    return (0, identity_1.normalizeNamespaceIdentity)(raw);
}
function isCanonicalClaimableNamespace(namespace) {
    const ns = normalizeClaimableNamespace(namespace);
    if (!ns)
        return false;
    if (RESERVED_SHORT_NAMESPACES.has(ns))
        return true;
    return ns.includes(".");
}
function buildKernelCommandTarget(req, operation, path) {
    const host = (0, namespace_1.resolveTransportHost)(req) || "unknown";
    const normalizedPath = String(path || "").trim();
    const relation = (0, namespace_1.resolveObserverRelation)(req);
    return {
        host,
        namespace: "kernel",
        operation,
        path: normalizedPath || "_",
        nrp: (0, meTarget_1.buildMeTargetNrp)("kernel", operation, normalizedPath || "_", relation),
        relation,
    };
}
function resolveCommandNamespace(operation, body, parsedTarget, fallbackNamespace) {
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
function buildBridgeTarget(resolved, requestHost, relation, rawFallback = "") {
    const namespaceMe = resolved?.namespace || "unknown";
    const nrp = resolved
        ? (0, meTarget_1.buildMeTargetNrp)(namespaceMe, "read", resolved.pathDot || "", relation)
        : rawFallback || (0, meTarget_1.buildMeTargetNrp)(namespaceMe, "read", "", relation);
    return {
        namespace: {
            me: namespaceMe,
            host: requestHost,
        },
        operation: "read",
        path: resolved?.pathDot || "",
        nrp,
        relation,
    };
}
function buildNormalizedTarget(req, namespace, operation, path) {
    const host = (0, namespace_1.resolveTransportHost)(req) || "unknown";
    const relation = (0, namespace_1.resolveObserverRelation)(req);
    return {
        host,
        namespace,
        operation,
        path,
        nrp: (0, meTarget_1.buildMeTargetNrp)(namespace, operation, path, relation),
        relation,
    };
}
function createNoCacheStaticOptions() {
    return {
        etag: false,
        lastModified: false,
        maxAge: 0,
        setHeaders(res) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        },
    };
}
// Serve built GUI assets from this.GUI package dist.
// During local development we want the browser to always fetch the latest bundle,
// otherwise Cleaker can keep rendering a stale UMD after a rebuild.
app.use("/gui", express_1.default.static(shell_1.GUI_PKG_DIST_DIR, createNoCacheStaticOptions()));
app.use("/me", express_1.default.static(ME_PKG_DIST_DIR, createNoCacheStaticOptions()));
app.use("/cleaker", express_1.default.static(CLEAKER_PKG_DIST_DIR, createNoCacheStaticOptions()));
app.use("/vendor/react", express_1.default.static(LOCAL_REACT_UMD_DIR, createNoCacheStaticOptions()));
app.use("/vendor/react-dom", express_1.default.static(LOCAL_REACTDOM_UMD_DIR, createNoCacheStaticOptions()));
app.get("/routes.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return res.sendFile(MONAD_ROUTES_PATH);
});
// NamespaceProvider boot endpoint (semantic runtime injection)
app.get("/__bootstrap", (req, res) => {
    const namespace = (0, namespace_1.resolveNamespace)(req);
    const host = (0, namespace_1.resolveTransportHost)(req);
    const origin = resolveRequestOrigin(req, host);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const surfaceEntry = buildRequestSurfaceEntry(req, namespace);
    const provider = buildRequestProviderBoot(req, namespace);
    const telemetry = (0, surfaceTelemetry_1.getSurfaceTelemetrySnapshot)();
    return res.json((0, envelope_1.createEnvelope)(target, {
        host,
        namespace,
        apiOrigin: origin,
        resolverHostName: NODE_HOSTNAME,
        resolverDisplayName: NODE_DISPLAY_NAME,
        provider,
        surfaceEntry: {
            ...surfaceEntry,
            ...telemetry,
        },
    }));
});
app.get("/__provider", (req, res) => {
    const namespace = String(req.query?.namespace || "").trim() || (0, namespace_1.resolveNamespace)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const provider = buildRequestProviderBoot(req, namespace);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace,
        provider,
    }));
});
app.get("/__provider/resolve", async (req, res) => {
    const namespace = String(req.query?.namespace || "").trim() || (0, namespace_1.resolveNamespace)(req);
    const rawPath = String(req.query?.path || "").trim();
    const route = resolveRequestSurfaceRoute(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    if (!rawPath) {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            namespace,
            path: "",
            route,
            error: "PATH_REQUIRED",
            detail: "NamespaceProvider.resolve requires ?path=",
        }));
    }
    const resolved = await (0, pathResolver_1.resolveNamespacePathValue)(namespace, rawPath);
    if (!resolved.found) {
        return res.status(404).json((0, envelope_1.createErrorEnvelope)(target, {
            namespace,
            path: resolved.path || rawPath,
            route,
            error: "PATH_NOT_FOUND",
        }));
    }
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: resolved.namespace,
        path: resolved.path,
        route,
        value: resolved.value,
    }));
});
app.get("/__provider/surface", (req, res) => {
    const namespace = String(req.query?.namespace || "").trim() || (0, namespace_1.resolveNamespace)(req);
    const route = resolveRequestSurfaceRoute(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const surfaceEntry = buildRequestSurfaceEntry(req, namespace);
    const surface = (0, provider_1.resolveNamespaceSurfaceSpec)({
        namespace,
        route,
        surfaceEntry,
    });
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace,
        path: route,
        route,
        surface,
        surfaceEntry,
    }));
});
app.get("/__surface", (req, res) => {
    const namespace = (0, namespace_1.resolveNamespace)(req);
    const host = (0, namespace_1.resolveTransportHost)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const surfaceEntry = buildRequestSurfaceEntry(req, namespace);
    return res.json((0, envelope_1.createEnvelope)(target, {
        host,
        namespace,
        surfaceEntry: {
            ...surfaceEntry,
            ...(0, surfaceTelemetry_1.getSurfaceTelemetrySnapshot)(),
        },
    }));
});
app.get("/__surface/events", (req, res) => {
    (0, surfaceTelemetry_1.attachSurfaceStreamClient)(req, res);
});
app.get("/__fetch", async (req, res) => {
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const remoteUrl = parseHttpFetchUrl(req.query?.url);
    if (!remoteUrl) {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "FETCH_URL_INVALID",
            detail: "Provide an absolute http(s) URL via ?url=",
        }));
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_PROXY_TIMEOUT_MS);
    try {
        const response = await fetch(remoteUrl.toString(), {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "user-agent": "monad.ai/1.0 this.DOM fetch proxy",
            },
        });
        const contentType = String(response.headers.get("content-type") || "text/html; charset=utf-8");
        const bodyText = await response.text();
        return res.status(response.status).json((0, envelope_1.createEnvelope)(target, {
            value: {
                url: remoteUrl.toString(),
                finalUrl: response.url || remoteUrl.toString(),
                status: response.status,
                ok: response.ok,
                contentType,
                body: bodyText,
            },
        }));
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const isTimeout = error instanceof Error && error.name === "AbortError";
        return res.status(isTimeout ? 504 : 502).json((0, envelope_1.createErrorEnvelope)(target, {
            error: isTimeout ? "FETCH_TIMEOUT" : "FETCH_PROXY_FAILED",
            detail,
            value: {
                url: remoteUrl.toString(),
            },
        }));
    }
    finally {
        clearTimeout(timeoutId);
    }
});
const resolveBridgeHandler = async (req, res) => {
    const rawTarget = String(req.query?.target || "").trim();
    const decodedTarget = rawTarget ? decodeURIComponent(rawTarget) : "";
    const parsed = parseBridgeTarget(decodedTarget);
    const requestHost = (0, namespace_1.resolveTransportHost)(req) || NODE_HOSTNAME || "localhost";
    const relation = (0, namespace_1.resolveObserverRelation)(req);
    if (!parsed) {
        return res.status(400).json({
            ok: false,
            operation: "read",
            target: buildBridgeTarget(null, requestHost, relation, decodedTarget),
            error: "TARGET_REQUIRED",
        });
    }
    const bridgeTarget = buildBridgeTarget(parsed, requestHost, relation, decodedTarget);
    let selectorDispatch = null;
    if (!parsed.pathSlash) {
        return res.status(400).json({
            ok: false,
            operation: "read",
            target: bridgeTarget,
            error: "TARGET_PATH_REQUIRED",
        });
    }
    if (parsed.namespace.includes("[") || parsed.namespace.includes("]")) {
        const selectorInfo = getNamespaceSelectorInfo(parsed.namespace);
        const dispatch = (0, selfMapping_1.resolveSelfDispatch)(selectorInfo.base, selectorInfo.selectorRaw, SELF_NODE_CONFIG);
        selectorDispatch = dispatch;
        if (dispatch.mode === "local") {
            parsed.namespace = selectorInfo.base;
        }
        if (dispatch.mode !== "local" && selectorInfo.webTarget) {
            const webTarget = {
                host: requestHost,
                namespace: parsed.namespace,
                operation: "read",
                path: parsed.pathDot || "",
                nrp: (0, meTarget_1.buildMeTargetNrp)(parsed.namespace, "read", parsed.pathDot || "", relation),
                relation,
            };
            try {
                const response = await fetch(selectorInfo.webTarget, { method: "GET" });
                const contentType = String(response.headers.get("content-type") || "text/html; charset=utf-8");
                const wantsJson = String(req.headers.accept || "").includes("application/json");
                const bodyText = await response.text();
                if (!wantsJson) {
                    res.setHeader("Content-Type", contentType);
                    return res.status(response.status).send(bodyText);
                }
                return res.status(response.status).json({
                    ...(0, envelope_1.createEnvelope)(webTarget, {
                        value: {
                            url: selectorInfo.webTarget,
                            status: response.status,
                            contentType,
                            body: bodyText,
                            overlay: parsed.pathDot || "",
                        },
                    }),
                    dispatch,
                });
            }
            catch (error) {
                return res.status(502).json({
                    ...(0, envelope_1.createErrorEnvelope)(webTarget, {
                        error: "WEB_FETCH_FAILED",
                        detail: error instanceof Error ? error.message : String(error),
                    }),
                    dispatch,
                });
            }
        }
        if (dispatch.hasInstanceSelector) {
            return res.status(422).json({
                ok: false,
                operation: "read",
                target: bridgeTarget,
                dispatch,
                error: "INSTANCE_SELECTOR_UNRESOLVED",
                hint: "Selector targets the same identity, but this node is not the requested instance.",
            });
        }
        if (selectorInfo.selectorRaw) {
            return res.status(422).json({
                ok: false,
                operation: "read",
                target: bridgeTarget,
                dispatch,
                error: "SELECTOR_BINDING_UNRESOLVED",
                hint: "Namespace selector requires an instance or transport resolver before HTTP dispatch.",
            });
        }
    }
    if (parsed.pathSlash.startsWith("resolve")) {
        return res.status(400).json({
            ok: false,
            operation: "read",
            target: bridgeTarget,
            error: "RESOLVE_PATH_BLOCKED",
        });
    }
    try {
        const origin = `http://localhost:${PORT}`;
        const url = new URL(`/${parsed.pathSlash}`, origin);
        for (const [key, value] of Object.entries(req.query || {})) {
            if (key === "target")
                continue;
            if (Array.isArray(value)) {
                for (const item of value) {
                    url.searchParams.append(key, String(item));
                }
                continue;
            }
            if (typeof value !== "undefined") {
                url.searchParams.set(key, String(value));
            }
        }
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "x-forwarded-host": parsed.namespace,
                "x-forwarded-proto": "http",
                host: parsed.namespace,
            },
        });
        const contentType = String(response.headers.get("content-type") || "");
        if (contentType.includes("application/json")) {
            const payload = await response.json();
            const patched = payload && typeof payload === "object"
                ? {
                    ...payload,
                    target: bridgeTarget,
                    ...(selectorDispatch ? { dispatch: selectorDispatch } : {}),
                }
                : {
                    ok: response.ok,
                    operation: "read",
                    target: bridgeTarget,
                    value: payload,
                    ...(selectorDispatch ? { dispatch: selectorDispatch } : {}),
                };
            return res.status(response.status).json(patched);
        }
        const text = await response.text();
        return res.status(response.status).send(text);
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            operation: "read",
            target: bridgeTarget,
            error: "BRIDGE_FETCH_FAILED",
            detail: error instanceof Error ? error.message : String(error),
        });
    }
};
// --- Local Bridge: me:// -> http://localhost:<port>/resolve?target=...
// Allows browser testing of me:// targets without registering a protocol handler.
app.get("/resolve", resolveBridgeHandler);
app.post("/me/*", async (req, res) => {
    const rawTarget = decodeURIComponent(String(req.params[0] || "").trim());
    const parsedTarget = parseBridgeTarget(rawTarget.startsWith("me://") ? rawTarget : `me://${rawTarget}`);
    if (!parsedTarget) {
        const target = buildKernelCommandTarget(req, "claim", "");
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "TARGET_REQUIRED",
            detail: "Expected a me target after /me/.",
        }));
    }
    if (parsedTarget.namespace !== "kernel" || (parsedTarget.selector !== "claim" && parsedTarget.selector !== "open")) {
        const target = buildKernelCommandTarget(req, parsedTarget.selector === "open" ? "open" : "claim", parsedTarget.pathSlash || parsedTarget.pathDot);
        return res.status(501).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "KERNEL_COMMAND_UNSUPPORTED",
            detail: "Only kernel claim/open commands are implemented on /me/* for now.",
        }));
    }
    const operation = parsedTarget.selector;
    const body = (req.body ?? {});
    const namespace = normalizeClaimableNamespace(body.namespace || parsedTarget.pathSlash || parsedTarget.pathDot);
    const target = buildKernelCommandTarget(req, operation, namespace);
    if (!namespace) {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "NAMESPACE_REQUIRED",
        }));
    }
    if (!isCanonicalClaimableNamespace(namespace)) {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "FULL_NAMESPACE_REQUIRED",
            detail: "Public claims should use a full namespace such as username.cleaker.me.",
        }));
    }
    if (operation === "claim") {
        const out = await (0, records_1.claimNamespace)({
            namespace,
            secret: String(body.secret || ""),
            identityHash: String(body.identityHash || "").trim(),
            publicKey: String(body.publicKey || "").trim() || null,
            privateKey: String(body.privateKey || "").trim() || null,
            proof: (body.proof && typeof body.proof === "object") ? body.proof : null,
        });
        if (!out.ok) {
            const status = out.error === "NAMESPACE_TAKEN"
                ? 409
                : out.error === "NAMESPACE_REQUIRED"
                    || out.error === "SECRET_REQUIRED"
                    || out.error === "IDENTITY_HASH_REQUIRED"
                    || out.error === "CLAIM_KEY_INVALID"
                    || out.error === "CLAIM_KEYPAIR_MISMATCH"
                    || out.error === "PROOF_MESSAGE_INVALID"
                    || out.error === "PROOF_NAMESPACE_MISMATCH"
                    || out.error === "PROOF_TIMESTAMP_INVALID"
                    ? 400
                    : out.error === "PROOF_INVALID"
                        ? 403
                        : 500;
            return res.status(status).json((0, envelope_1.createErrorEnvelope)(target, { error: out.error }));
        }
        return res.status(201).json((0, envelope_1.createEnvelope)(target, {
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            publicKey: out.record.publicKey,
            createdAt: out.record.createdAt,
            persistentClaim: out.persistentClaim,
        }));
    }
    const out = (0, records_1.openNamespace)({
        namespace,
        secret: String(body.secret || ""),
        identityHash: String(body.identityHash || "").trim(),
    });
    if (!out.ok) {
        const status = out.error === "CLAIM_NOT_FOUND"
            ? 404
            : out.error === "CLAIM_VERIFICATION_FAILED" || out.error === "IDENTITY_MISMATCH"
                ? 403
                : out.error === "NAMESPACE_REQUIRED"
                    || out.error === "SECRET_REQUIRED"
                    || out.error === "IDENTITY_HASH_REQUIRED"
                    ? 400
                    : 500;
        return res.status(status).json((0, envelope_1.createErrorEnvelope)(target, { error: out.error }));
    }
    const memories = (0, replay_1.getMemoriesForNamespace)(out.record.namespace);
    const openedAt = Date.now();
    const policy = getDefaultReadPolicy(out.record.namespace);
    const identity = parseNamespaceIdentity(out.record.namespace);
    const audit = {
        proofId: computeProofId({
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            noise: out.noise,
            memories,
        }),
        openedAt,
    };
    return res.json((0, envelope_1.createEnvelope)(target, {
        verified: true,
        reasonCode: null,
        reason: null,
        identity,
        policy,
        audit,
        namespace: out.record.namespace,
        identityHash: out.record.identityHash,
        noise: out.noise,
        memories,
        openedAt,
    }));
});
// HTML shell for root and any deep route when Accept: text/html
app.get("/", (req, res, next) => {
    if (req.query?.target) {
        return resolveBridgeHandler(req, res);
    }
    if (!(0, shell_1.wantsHtml)(req))
        return next();
    const namespace = (0, namespace_1.resolveNamespace)(req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send((0, shell_1.htmlShell)({
        providerBoot: buildRequestProviderBoot(req, namespace),
    }));
});
// Minimal request logger (no identity semantics, only transport info)
app.use((req, _res, next) => {
    const transportHost = (0, namespace_1.resolveTransportHost)(req);
    const forwardedHost = (0, namespace_1.resolveHostNamespace)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const lens = (0, namespace_1.formatObserverRelationLabel)(target.relation);
    const startedAt = Date.now();
    const forwardedSuffix = forwardedHost && forwardedHost !== transportHost
        ? ` xf=${forwardedHost}`
        : "";
    console.log(`→ ${req.method} ${req.url} host=${transportHost || "unknown"} ns=${target.namespace} lens=${lens} op=${target.operation} nrp=${target.nrp}${forwardedSuffix}`);
    _res.on("finish", () => {
        if (req.path === "/__surface/events")
            return;
        (0, surfaceTelemetry_1.recordSurfaceRequest)({
            method: req.method,
            url: req.url,
            status: _res.statusCode,
            durationMs: Date.now() - startedAt,
            host: transportHost || "unknown",
            namespace: target.namespace,
            operation: target.operation,
            nrp: target.nrp,
            lens,
            forwardedHost: forwardedHost && forwardedHost !== transportHost ? forwardedHost : null,
            timestamp: startedAt,
        });
    });
    next();
});
// --- Universal Ledger Write Surface ---------------------------------
// Accept ANY ME block (or arbitrary JSON) and append me to the ledger.
app.post("/", async (req, res) => {
    const body = req.body;
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const rawTarget = String(body?.target || req.query?.target || "").trim();
    const parsedTarget = rawTarget ? parseBridgeTarget(rawTarget) : null;
    const operation = normalizeOperation(body?.operation || body?.op || parsedTarget?.selector);
    const resolvedNamespace = resolveCommandNamespace(operation, (body ?? {}), parsedTarget, (0, namespace_1.resolveNamespace)(req));
    const commandTarget = (operation === "claim" || operation === "open") && parsedTarget?.namespace === "kernel"
        ? buildKernelCommandTarget(req, operation, resolvedNamespace)
        : null;
    if (!body || typeof body !== "object") {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "Expected JSON block in request body",
        }));
    }
    if (operation === "claim") {
        if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(commandTarget, {
                error: "FULL_NAMESPACE_REQUIRED",
                detail: "Public claims should use a full namespace such as username.cleaker.me.",
            }));
        }
        const out = await (0, records_1.claimNamespace)({
            namespace: resolvedNamespace,
            secret: String(body?.secret || ""),
            identityHash: String(body?.identityHash || "").trim(),
            publicKey: String(body?.publicKey || "").trim() || null,
            privateKey: String(body?.privateKey || "").trim() || null,
            proof: (body?.proof && typeof body.proof === "object")
                ? body.proof
                : null,
        });
        const claimTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "claim", "");
        if (!out.ok) {
            const status = out.error === "NAMESPACE_TAKEN"
                ? 409
                : out.error === "NAMESPACE_REQUIRED"
                    || out.error === "SECRET_REQUIRED"
                    || out.error === "IDENTITY_HASH_REQUIRED"
                    || out.error === "CLAIM_KEY_INVALID"
                    || out.error === "CLAIM_KEYPAIR_MISMATCH"
                    || out.error === "PROOF_MESSAGE_INVALID"
                    || out.error === "PROOF_NAMESPACE_MISMATCH"
                    || out.error === "PROOF_TIMESTAMP_INVALID"
                    ? 400
                    : out.error === "PROOF_INVALID"
                        ? 403
                        : 500;
            return res.status(status).json((0, envelope_1.createErrorEnvelope)(claimTarget, { error: out.error }));
        }
        return res.status(201).json((0, envelope_1.createEnvelope)(claimTarget, {
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            publicKey: out.record.publicKey,
            createdAt: out.record.createdAt,
            persistentClaim: out.persistentClaim,
        }));
    }
    if (operation === "open") {
        if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(commandTarget, {
                error: "FULL_NAMESPACE_REQUIRED",
                detail: "Public opens should use a full namespace such as username.cleaker.me.",
            }));
        }
        const out = (0, records_1.openNamespace)({
            namespace: resolvedNamespace,
            secret: String(body?.secret || ""),
            identityHash: String(body?.identityHash || "").trim(),
        });
        const openTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "open", "");
        if (!out.ok) {
            const status = out.error === "CLAIM_NOT_FOUND"
                ? 404
                : out.error === "CLAIM_VERIFICATION_FAILED" || out.error === "IDENTITY_MISMATCH"
                    ? 403
                    : out.error === "NAMESPACE_REQUIRED"
                        || out.error === "SECRET_REQUIRED"
                        || out.error === "IDENTITY_HASH_REQUIRED"
                        ? 400
                        : 500;
            return res.status(status).json((0, envelope_1.createErrorEnvelope)(openTarget, { error: out.error }));
        }
        const memories = (0, replay_1.getMemoriesForNamespace)(out.record.namespace);
        const openedAt = Date.now();
        const policy = getDefaultReadPolicy(out.record.namespace);
        const identity = parseNamespaceIdentity(out.record.namespace);
        const audit = {
            proofId: computeProofId({
                namespace: out.record.namespace,
                identityHash: out.record.identityHash,
                noise: out.noise,
                memories,
            }),
            openedAt,
        };
        return res.json((0, envelope_1.createEnvelope)(openTarget, {
            verified: true,
            reasonCode: null,
            reason: null,
            identity,
            policy,
            audit,
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            noise: out.noise,
            memories,
            openedAt,
        }));
    }
    const timestamp = Date.now();
    const namespace = resolvedNamespace;
    const claim = (0, records_2.getClaim)(namespace);
    if (claim) {
        const authorized = (0, replay_2.isNamespaceWriteAuthorized)({
            claimIdentityHash: claim.identityHash,
            claimPublicKey: claim.publicKey,
            body,
        });
        if (!authorized) {
            return res.status(403).json((0, envelope_1.createErrorEnvelope)(target, {
                error: "NAMESPACE_WRITE_FORBIDDEN",
            }));
        }
    }
    const blockIdentityHash = claim
        ? claim.identityHash
        : String(body.identityHash || "").trim();
    const entry = (0, replay_2.recordMemory)({
        namespace,
        payload: body,
        identityHash: blockIdentityHash,
        timestamp,
    });
    if (!entry) {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "INVALID_MEMORY_INPUT",
        }));
    }
    console.log("🧠 New Memory Event:");
    console.log(JSON.stringify(entry, null, 2));
    const writeTarget = buildNormalizedTarget(req, namespace, "write", "");
    return res.json((0, envelope_1.createEnvelope)(writeTarget, {
        memoryHash: entry?.hash || null,
        prevMemoryHash: entry?.prevHash || null,
        namespace,
        path: entry?.path || String(body.expression || "").trim(),
        operator: entry?.operator ?? null,
        timestamp: entry?.timestamp || timestamp,
    }));
});
// --- Universal Ledger Read Surface ----------------------
app.get("/", async (req, res) => {
    const chainNs = (0, namespace_1.resolveNamespace)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const lens = (0, namespace_1.formatObserverRelationLabel)(target.relation);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 5000)));
    const identityHash = String(req.query?.identityHash || "").trim();
    const rootNamespace = (0, namespace_1.resolveNamespaceProjectionRoot)(chainNs) || chainNs;
    const all = await (0, blockchain_1.getAllBlocks)();
    const users = await (0, users_1.getUsersForRootNamespace)(rootNamespace);
    let blocks = (0, namespace_1.filterBlocksByNamespace)(all, chainNs);
    if (identityHash) {
        blocks = blocks.filter((b) => String(b?.authorIdentityHash || "") === identityHash);
    }
    // newest-first and limit
    blocks = blocks
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
        .slice(0, limit);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: chainNs,
        rootNamespace,
        lens,
        users,
        blocks,
        count: blocks.length,
    }));
});
// Explicit blocks endpoint (same semantics as GET /, but clearer name)
app.get("/blocks", async (req, res) => {
    // Delegate by rewriting url semantics in place
    // (Keep implementation simple by copying the same logic.)
    const ns = (0, namespace_1.resolveNamespace)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const lens = (0, namespace_1.formatObserverRelationLabel)(target.relation);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 5000)));
    const identityHash = String(req.query?.identityHash || "").trim();
    const all = await (0, blockchain_1.getAllBlocks)();
    let blocks = (0, namespace_1.filterBlocksByNamespace)(all, ns);
    if (identityHash) {
        blocks = blocks.filter((b) => String(b?.authorIdentityHash || "") === identityHash);
    }
    blocks = blocks
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
        .slice(0, limit);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: ns,
        lens,
        blocks,
        count: blocks.length,
    }));
});
app.get("/blockchain", async (req, res) => {
    const chainNs = (0, namespace_1.resolveNamespace)(req);
    const rootNamespace = (0, namespace_1.resolveNamespaceProjectionRoot)(chainNs) || chainNs;
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const lens = (0, namespace_1.formatObserverRelationLabel)(target.relation);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 500)));
    const memories = (0, memoryStore_1.listSemanticMemoriesByRootNamespace)(rootNamespace, { limit });
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: chainNs,
        rootNamespace,
        lens,
        memories,
        count: memories.length,
    }));
});
// --- Convenience: allow GET /@... to behave like GET / but with path-based namespace addressing.
// NOTE: This MUST be defined before the catch-all path resolver.
app.get("/@*", async (req, res) => {
    const chainNs = (0, namespace_1.resolveNamespace)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const lens = (0, namespace_1.formatObserverRelationLabel)(target.relation);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 5000)));
    const identityHash = String(req.query?.identityHash || "").trim();
    const all = await (0, blockchain_1.getAllBlocks)();
    let blocks = (0, namespace_1.filterBlocksByNamespace)(all, chainNs);
    if (identityHash) {
        blocks = blocks.filter((b) => String(b?.authorIdentityHash || "") === identityHash);
    }
    blocks = blocks
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
        .slice(0, limit);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: chainNs,
        lens,
        blocks,
        count: blocks.length,
    }));
});
// Legacy extensions: username claims and biometric matching remain available,
// but they are no longer presented as core cleaker semantics.
// --- CommitSync Protocol Endpoints ---
// Commit a new semantic memory event (single or batch)
app.post("/api/v1/commit", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const rawEvents = Array.isArray(body.events)
            ? body.events
            : body.memory && typeof body.memory === "object"
                ? [{
                        namespace: body.namespace,
                        ...body.memory,
                        data: Object.prototype.hasOwnProperty.call(body.memory, "data")
                            ? body.memory.data
                            : body.memory.value,
                    }]
                : [];
        if (!rawEvents.length) {
            return res.status(400).json({ error: "No events provided" });
        }
        const results = [];
        for (const event of rawEvents) {
            // event: { namespace, path, operator, data, signature, expectedPrevHash, timestamp }
            try {
                const memory = (0, memoryStore_1.appendSemanticMemory)(event);
                results.push({ ok: true, memory });
            }
            catch (err) {
                results.push({ ok: false, error: String(err) });
            }
        }
        const first = results[0] && results[0];
        return res.status(201).json({
            ok: results.every((entry) => Boolean(entry.ok)),
            hash: first?.memory?.hash || null,
            results,
        });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
// Sync: fetch semantic memory events for a namespace since a given timestamp/hash
app.get("/api/v1/sync", async (req, res) => {
    try {
        const namespace = String(req.query.namespace || "").trim().toLowerCase();
        const since = Number(req.query.since || 0);
        if (!namespace) {
            return res.status(400).json({ error: "Missing namespace" });
        }
        const username = String(req.query.username || "");
        const fingerprint = String(req.query.fingerprint || "");
        const limit = Number(req.query.limit || 2000);
        const events = (username && fingerprint
            ? (0, memoryStore_1.listHostMemoryHistory)(namespace, username, fingerprint, limit)
            : (0, memoryStore_1.listSemanticMemoriesByNamespace)(namespace, { limit })).filter((e) => Number(e?.timestamp ?? 0) > since);
        return res.json({ events, memories: events });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
app.use((0, claims_1.createClaimsRouter)());
app.use((0, session_1.createSessionRouter)());
app.use((0, legacy_1.createLegacyRouter)());
// --- Path Resolver Catch-all (MUST be last route before app.listen) ---
app.get("/*", (req, res, next) => {
    // If a browser is requesting HTML, always return the SPA shell.
    if ((0, shell_1.wantsHtml)(req)) {
        const namespace = (0, namespace_1.resolveNamespace)(req);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send((0, shell_1.htmlShell)({
            providerBoot: buildRequestProviderBoot(req, namespace),
        }));
    }
    return (0, pathResolver_1.createPathResolverHandler)()(req, res);
});
// --- Start Server ----------------------------------------
(0, manager_js_1.getKernel)();
(0, persist_js_1.setupPersistence)();
if (!process.env.JEST_WORKER_ID) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Monad.ai daemon running at: http://localhost:${PORT}`);
        console.log("\n∴ Material Surface");
        console.log(`  - State Dir:      ${(0, manager_js_1.getKernelStateDir)()}`);
        console.log("  - Give thought:   POST /        (append JSON into current namespace)");
        console.log("  - Reach thought:  GET  /        (read current namespace surface)");
        console.log("  - Read blocks:    GET  /blocks  (explicit block stream view)");
        console.log("  - Provider boot:  GET  /__provider");
        console.log("  - Provider read:  GET  /__provider/resolve?path=profile/name");
        console.log("  - Provider GUI:   GET  /__provider/surface?route=/");
        console.log("\n🔐 Claim Surface");
        console.log("  - Claim space:    POST /claims       (forge claim record + encrypted noise)");
        console.log("  - Open space:     POST /claims/open  (verify trinity -> recover noise)");
        console.log("  - Kernel claim:   POST /me/kernel:claim/<full-namespace>");
        console.log("  - Kernel open:    POST /me/kernel:open/<full-namespace>");
        console.log("\n🌐 Routing / Namespaces");
        console.log("  - Host header determines the chain namespace");
        console.log("  - Examples:");
        console.log("    • cleaker.me                  -> cleaker.me");
        console.log("    • username.cleaker.me         -> username.cleaker.me");
        console.log(`    • localhost (transport alias) -> ${LOCAL_NAMESPACE_ROOT}`);
        console.log(`    • username.localhost          -> username.${LOCAL_NAMESPACE_ROOT} (local alias projection)`);
        console.log("    • cleaker.me/@username        -> username.cleaker.me (path projection)");
        console.log(`    • localhost/@username         -> username.${LOCAL_NAMESPACE_ROOT} (local alias projection)`);
        console.log("    • cleaker.me/@a+b             -> cleaker.me (relation stays semantic, no DNS projection)");
        console.log("    • cleaker.me/@a/@b            -> a.cleaker.me (target projects, relation stays semantic)");
        console.log("    • ana.cleaker.me/profile?as=bella -> target=ana.cleaker.me, observer=bella.cleaker.me");
        if (SELF_NODE_CONFIG) {
            console.log("    • me://ana.cleaker.me[macbook]:read/profile -> local if selector matches this node tags");
        }
        if (SELF_NODE_CONFIG) {
            console.log("\n🪞 Self Mapping");
            console.log(`  - Identity:       ${SELF_NODE_CONFIG.identity}`);
            console.log(`  - Tags:           ${SELF_NODE_CONFIG.tags.join(", ") || "(none)"}`);
            console.log(`  - Endpoint:       ${SELF_NODE_CONFIG.endpoint}`);
            console.log(`  - Config Path:    ${SELF_NODE_CONFIG.configPath}`);
        }
        console.log("\n🔎 Namespace Reads");
        console.log("  - Resolve path:   GET  /<any/path>   e.g. /profile/displayName");
        console.log("    (Resolves within the chain namespace derived from host)");
        console.log("\n🕰 Legacy Extensions");
        console.log("  - Claim username: POST /users");
        console.log("  - Lookup user:    GET  /users/:username\n");
    });
}
exports.default = app;
