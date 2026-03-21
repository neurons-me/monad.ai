"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSelectorGroups = parseSelectorGroups;
exports.loadSelfNodeConfig = loadSelfNodeConfig;
exports.resolveSelfDispatch = resolveSelfDispatch;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function normalizeNamespace(input) {
    return String(input || "").trim().toLowerCase();
}
function normalizeToken(input) {
    return String(input || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "");
}
function uniq(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function splitValues(input) {
    return uniq(String(input || "").split(",").map((value) => normalizeToken(value)));
}
function toArray(input) {
    if (Array.isArray(input)) {
        return uniq(input.map((value) => normalizeToken(value)));
    }
    if (typeof input === "string") {
        return splitValues(input);
    }
    return [];
}
function extractEndpointHost(endpoint) {
    const raw = String(endpoint || "").trim();
    if (!raw)
        return "";
    try {
        return normalizeToken(new URL(raw).hostname);
    }
    catch {
        return normalizeToken(raw.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0]);
    }
}
function parseSelectorGroups(selectorRaw) {
    const raw = String(selectorRaw || "").trim();
    if (!raw)
        return [];
    return raw
        .split("|")
        .map((group) => group.trim())
        .filter(Boolean)
        .map((group) => group
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
        const colon = part.indexOf(":");
        if (colon < 0) {
            return {
                type: "tag",
                values: splitValues(part),
            };
        }
        return {
            type: normalizeToken(part.slice(0, colon)),
            values: splitValues(part.slice(colon + 1)),
        };
    })
        .filter((clause) => clause.type && clause.values.length > 0))
        .filter((group) => group.length > 0);
}
function matchClause(clause, tagSet, hostSet) {
    if (clause.type === "device" || clause.type === "tag") {
        return clause.values.filter((value) => tagSet.has(value));
    }
    if (clause.type === "host") {
        return clause.values.filter((value) => hostSet.has(value) || tagSet.has(value));
    }
    return [];
}
function loadSelfNodeConfig(input) {
    const configPath = path_1.default.resolve(input.cwd, String(input.env.MONAD_SELF_CONFIG_PATH || "env/self.json"));
    let fileConfig = {};
    if (fs_1.default.existsSync(configPath)) {
        try {
            const raw = fs_1.default.readFileSync(configPath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                fileConfig = parsed;
            }
        }
        catch {
            fileConfig = {};
        }
    }
    const identity = normalizeNamespace(input.env.MONAD_SELF_IDENTITY || fileConfig.identity);
    if (!identity)
        return null;
    const endpoint = String(input.env.MONAD_SELF_ENDPOINT || fileConfig.endpoint || `http://localhost:${input.port}`).trim();
    const hostname = String(fileConfig.hostname || input.hostname || "").trim() || String(input.hostname || "");
    const tags = uniq([
        ...toArray(fileConfig.tags),
        ...toArray(input.env.MONAD_SELF_TAGS),
        normalizeToken(hostname),
        extractEndpointHost(endpoint),
    ]);
    return {
        identity,
        tags,
        endpoint,
        hostname,
        configPath,
    };
}
function resolveSelfDispatch(baseInput, selectorRawInput, self) {
    const base = normalizeNamespace(baseInput);
    const selectorRaw = String(selectorRawInput || "").trim() || null;
    if (!self) {
        return {
            mode: "unconfigured",
            configured: false,
            identity: null,
            base,
            selectorRaw,
            hasInstanceSelector: false,
            matched: [],
            required: [],
            endpoint: null,
            tags: [],
            reason: "Self-mapping is not configured on this node.",
        };
    }
    const groups = parseSelectorGroups(selectorRaw);
    const instanceGroups = groups
        .map((group) => group.filter((clause) => clause.type === "device" || clause.type === "host" || clause.type === "tag"))
        .filter((group) => group.length > 0);
    const required = uniq(instanceGroups.flatMap((group) => group.flatMap((clause) => clause.values)));
    if (base !== self.identity) {
        return {
            mode: "foreign",
            configured: true,
            identity: self.identity,
            base,
            selectorRaw,
            hasInstanceSelector: required.length > 0,
            matched: [],
            required,
            endpoint: self.endpoint,
            tags: self.tags,
            reason: "The requested namespace does not belong to this node identity.",
        };
    }
    if (!selectorRaw) {
        return {
            mode: "local",
            configured: true,
            identity: self.identity,
            base,
            selectorRaw,
            hasInstanceSelector: false,
            matched: ["identity"],
            required: [],
            endpoint: self.endpoint,
            tags: self.tags,
            reason: "Base identity matches this node.",
        };
    }
    if (required.length === 0) {
        return {
            mode: "unscoped",
            configured: true,
            identity: self.identity,
            base,
            selectorRaw,
            hasInstanceSelector: false,
            matched: [],
            required: [],
            endpoint: self.endpoint,
            tags: self.tags,
            reason: "Selector exists, but it does not constrain an instance tag or host.",
        };
    }
    const tagSet = new Set(self.tags.map((tag) => normalizeToken(tag)).filter(Boolean));
    const hostSet = new Set([
        normalizeToken(self.hostname),
        extractEndpointHost(self.endpoint),
    ].filter(Boolean));
    for (const group of instanceGroups) {
        const matched = uniq(group.flatMap((clause) => matchClause(clause, tagSet, hostSet)));
        const satisfied = group.every((clause) => matchClause(clause, tagSet, hostSet).length > 0);
        if (!satisfied)
            continue;
        return {
            mode: "local",
            configured: true,
            identity: self.identity,
            base,
            selectorRaw,
            hasInstanceSelector: true,
            matched,
            required: uniq(group.flatMap((clause) => clause.values)),
            endpoint: self.endpoint,
            tags: self.tags,
            reason: "Selector matches this node identity and tags.",
        };
    }
    return {
        mode: "remote",
        configured: true,
        identity: self.identity,
        base,
        selectorRaw,
        hasInstanceSelector: true,
        matched: [],
        required,
        endpoint: self.endpoint,
        tags: self.tags,
        reason: "Selector targets the same identity, but a different instance surface.",
    };
}
