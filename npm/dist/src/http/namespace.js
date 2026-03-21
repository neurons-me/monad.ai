"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRawObserverRelation = createRawObserverRelation;
exports.resolveHostNamespace = resolveHostNamespace;
exports.resolveTransportHost = resolveTransportHost;
exports.isReservedLabel = isReservedLabel;
exports.isProjectableRootHost = isProjectableRootHost;
exports.normalizeUsernameLabel = normalizeUsernameLabel;
exports.canonicalPair = canonicalPair;
exports.getAtSelectorFromPath = getAtSelectorFromPath;
exports.getAtNestedUserFromPath = getAtNestedUserFromPath;
exports.resolveChainNamespace = resolveChainNamespace;
exports.resolveNamespace = resolveNamespace;
exports.resolveNamespaceProjectionRoot = resolveNamespaceProjectionRoot;
exports.resolveObserverRelation = resolveObserverRelation;
exports.formatObserverRelationLabel = formatObserverRelationLabel;
exports.formatObserverRelationQuery = formatObserverRelationQuery;
exports.resolveLens = resolveLens;
exports.filterBlocksByNamespace = filterBlocksByNamespace;
function createRawObserverRelation() {
    return {
        operator: "?",
        mode: "raw",
        value: null,
        observer: null,
        namespace: null,
    };
}
function resolveHostNamespace(req) {
    const xfHost = req.headers["x-forwarded-host"];
    const hostHeaderRaw = (Array.isArray(xfHost) ? xfHost[0] : xfHost) ||
        req.headers.host ||
        "";
    const first = String(hostHeaderRaw).split(",")[0].trim();
    const noProto = first.replace(/^https?:\/\//i, "");
    const hostnameOnly = noProto.split(":")[0].trim();
    return hostnameOnly || "unknown";
}
function resolveTransportHost(req) {
    const hostHeaderRaw = Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host || "";
    const first = String(hostHeaderRaw).split(",")[0].trim();
    const noProto = first.replace(/^https?:\/\//i, "");
    const hostnameOnly = noProto.split(":")[0].trim();
    return hostnameOnly || "unknown";
}
function isReservedLabel(label) {
    const x = String(label || "").toLowerCase();
    return x === "www" || x === "api";
}
function isProjectableRootHost(hostname) {
    const parts = String(hostname || "").split(".").filter(Boolean);
    if (parts.length === 1 && parts[0] === "localhost")
        return true;
    if (parts.length === 2 && parts[1] === "localhost")
        return false;
    return parts.length === 2;
}
function normalizeUsernameLabel(raw) {
    const x = String(raw || "").trim().toLowerCase();
    const safe = x.replace(/[^a-z0-9_-]/g, "");
    if (!safe)
        return "";
    if (isReservedLabel(safe))
        return "";
    return safe;
}
function canonicalPair(a, b) {
    const A = normalizeUsernameLabel(a);
    const B = normalizeUsernameLabel(b);
    if (!A || !B)
        return "";
    const pair = [A, B].sort();
    return `${pair[0]}+${pair[1]}`;
}
function getAtSelectorFromPath(req) {
    const p = String(req.path || "");
    const m = p.match(/^\/\@([^\/\?#]+)(?:\/|$)/);
    if (!m)
        return null;
    const raw = String(m[1] || "").trim();
    if (!raw)
        return null;
    if (raw.includes("+")) {
        const parts = raw.split(/\+\+?/).map((s) => s.trim()).filter(Boolean);
        if (parts.length !== 2)
            return null;
        const pair = canonicalPair(parts[0], parts[1]);
        if (!pair)
            return null;
        return { kind: "relation", pair };
    }
    const username = normalizeUsernameLabel(raw);
    if (!username)
        return null;
    return { kind: "user", username };
}
function getAtNestedUserFromPath(req) {
    const p = String(req.path || "");
    const m = p.match(/^\/\@([^\/\?#]+)\/\@([^\/\?#]+)(?:\/|$)/);
    if (!m)
        return null;
    const a = normalizeUsernameLabel(String(m[1] || ""));
    const b = normalizeUsernameLabel(String(m[2] || ""));
    if (!a || !b)
        return null;
    return { a, b };
}
function resolveChainNamespace(req) {
    const host = resolveHostNamespace(req);
    if (!host)
        return "unknown";
    const atSel = getAtSelectorFromPath(req);
    const atNested = getAtNestedUserFromPath(req);
    const rootProjectable = isProjectableRootHost(host);
    if (atNested) {
        return rootProjectable ? `${atNested.a}.${host}` : host;
    }
    if (atSel?.kind === "relation") {
        return host;
    }
    if (atSel?.kind === "user") {
        return rootProjectable ? `${atSel.username}.${host}` : host;
    }
    return host;
}
function resolveNamespace(req) {
    return resolveChainNamespace(req);
}
function resolveNamespaceProjectionRoot(namespace) {
    const ns = String(namespace || "").trim().toLowerCase();
    if (!ns)
        return "";
    const userMatch = ns.match(/^([^\/]+)\/users\/([^\/]+)$/i);
    if (userMatch) {
        return String(userMatch[1] || "").trim().toLowerCase();
    }
    const dotParts = ns.split(".").filter(Boolean);
    if (dotParts.length === 2 && dotParts[1] === "localhost")
        return "localhost";
    if (dotParts.length <= 2)
        return ns;
    return dotParts.slice(1).join(".");
}
function normalizeNamespaceReference(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/^@+/, "")
        .replace(/[^a-z0-9._/-]/g, "");
}
function resolveObserverReference(raw) {
    const normalized = normalizeNamespaceReference(raw);
    if (!normalized)
        return null;
    if (normalized.includes(".") || normalized.includes("/")) {
        return {
            observer: normalized,
            namespace: normalized,
        };
    }
    const observer = normalizeUsernameLabel(normalized);
    if (!observer)
        return null;
    return {
        observer,
        namespace: null,
    };
}
function resolveObserverRelation(req) {
    const q = req.query || {};
    const asRaw = String(q.as ?? "").trim();
    if (asRaw) {
        const targetNamespace = resolveNamespace(req);
        const projectionRoot = resolveNamespaceProjectionRoot(targetNamespace) || resolveHostNamespace(req);
        const resolved = resolveObserverReference(asRaw);
        if (!resolved)
            return createRawObserverRelation();
        const observerNamespace = resolved.namespace
            ? resolved.namespace
            : isProjectableRootHost(projectionRoot)
                ? `${resolved.observer}.${projectionRoot}`
                : resolved.observer;
        return {
            operator: "?",
            mode: "observer",
            value: asRaw,
            observer: resolved.observer,
            namespace: observerNamespace,
        };
    }
    const me = String(q.me ?? "").trim().toLowerCase();
    if (me === "1" || me === "true") {
        const namespace = resolveNamespace(req);
        return {
            operator: "?",
            mode: "self",
            value: "me",
            observer: "self",
            namespace,
        };
    }
    const view = String(q.view ?? "").trim().toLowerCase();
    if (view) {
        return {
            operator: "?",
            mode: "view",
            value: view,
            observer: null,
            namespace: null,
        };
    }
    return createRawObserverRelation();
}
function formatObserverRelationLabel(relation) {
    if (relation.mode === "observer") {
        return relation.namespace
            ? `as:${relation.namespace}`
            : relation.observer
                ? `as:${relation.observer}`
                : "as";
    }
    if (relation.mode === "self")
        return "me";
    if (relation.mode === "view")
        return relation.value || "view";
    return "raw";
}
function formatObserverRelationQuery(relation) {
    if (relation.mode === "observer") {
        const value = relation.namespace || relation.observer || relation.value;
        return value ? `?as=${encodeURIComponent(value)}` : "";
    }
    if (relation.mode === "self") {
        return "?me=true";
    }
    if (relation.mode === "view") {
        return relation.value ? `?view=${encodeURIComponent(relation.value)}` : "";
    }
    return "";
}
function resolveLens(req) {
    return formatObserverRelationLabel(resolveObserverRelation(req));
}
function filterBlocksByNamespace(allBlocks, ns) {
    if (!ns)
        return allBlocks;
    const slashPrefix = ns.endsWith("/") ? ns : `${ns}/`;
    const dotSuffix = `.${ns}`;
    const bracketPrefix = `${ns}[`;
    return allBlocks.filter((b) => {
        const n = String(b?.namespace || "");
        return n === ns || n.startsWith(slashPrefix) || n.endsWith(dotSuffix) || n.startsWith(bracketPrefix);
    });
}
