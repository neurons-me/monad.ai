"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMemory = recordMemory;
exports.getMemoriesForNamespace = getMemoriesForNamespace;
exports.isNamespaceWriteAuthorized = isNamespaceWriteAuthorized;
const crypto_1 = __importDefault(require("crypto"));
const memoryStore_js_1 = require("./memoryStore.js");
const manager_js_1 = require("../kernel/manager.js");
const identity_js_1 = require("../namespace/identity.js");
function nsKey(namespace) {
    return namespace.replace(/\./g, "__");
}
function memPath(namespace) {
    return `daemon.memories.${nsKey(namespace)}`;
}
function nav(root, path) {
    return path.split(".").reduce((proxy, key) => proxy[key], root);
}
function kernelGet(path) {
    const kernelRead = (0, manager_js_1.getKernel)();
    return kernelRead(path);
}
function kernelSet(path, value) {
    nav((0, manager_js_1.getKernel)(), path)(value);
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function toStableJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(toStableJson).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${toStableJson(obj[k])}`).join(",")}}`;
}
function decodeSignature(rawSignature) {
    const sig = String(rawSignature || "").trim();
    if (!sig)
        return null;
    try {
        return Buffer.from(sig, "base64");
    }
    catch {
        try {
            return Buffer.from(sig, "hex");
        }
        catch {
            return null;
        }
    }
}
function stripWriteAuthFields(body) {
    const { signature, signedPayload, signatureEncoding, signatureFormat, ...rest } = body;
    return rest;
}
function verifySignature(publicKey, message, signature) {
    try {
        const key = crypto_1.default.createPublicKey(publicKey);
        const keyType = key.asymmetricKeyType || "";
        const payload = Buffer.from(message);
        if (keyType === "ed25519" || keyType === "ed448") {
            return crypto_1.default.verify(null, payload, key, signature);
        }
        const verifier = crypto_1.default.createVerify("SHA256");
        verifier.update(payload);
        verifier.end();
        return verifier.verify(key, signature);
    }
    catch {
        return false;
    }
}
function normalizeOperator(raw) {
    if (raw === null || raw === undefined)
        return null;
    const normalized = String(raw).trim();
    return normalized || null;
}
function toReplayHash(input) {
    return crypto_1.default
        .createHash("sha256")
        .update(toStableJson({
        path: input.path,
        operator: input.operator,
        expression: input.expression,
        value: input.value,
        timestamp: input.timestamp,
    }))
        .digest("hex");
}
function normalizeMarkerValue(raw, markerKey) {
    if (isPlainObject(raw) && typeof raw[markerKey] === "string" && raw[markerKey]) {
        return raw;
    }
    return { [markerKey]: String(raw || "") };
}
function materializeReplayMemory(path, operator, data, hash, prevHash, timestamp) {
    let expression = data;
    let value = data;
    if (operator === "__" || operator === "->") {
        const ptr = normalizeMarkerValue(data, "__ptr");
        expression = ptr;
        value = ptr;
    }
    else if (operator === "@") {
        const identity = normalizeMarkerValue(data, "__id");
        expression = identity;
        value = identity;
    }
    else if (operator === "_" || operator === "~") {
        const masked = typeof data === "string" && data.trim() ? data : "***";
        expression = masked;
        value = masked;
    }
    return {
        path,
        operator,
        expression,
        value,
        hash,
        prevHash,
        timestamp,
    };
}
function semanticRowToReplayMemory(row) {
    return materializeReplayMemory(String(row.path || "").trim(), normalizeOperator(row.operator), row.data, String(row.hash || ""), String(row.prevHash || ""), Number(row.timestamp || Date.now()));
}
function normalizeLegacyReplayMemory(input) {
    if (!isPlainObject(input))
        return null;
    const source = isPlainObject(input.payload) ? input.payload : input;
    const path = String((typeof source.path === "string" && source.path) ||
        (typeof input.expression === "string" && input.expression) ||
        "").trim();
    if (!path)
        return null;
    const operator = normalizeOperator(source.operator);
    const hasExpression = Object.prototype.hasOwnProperty.call(source, "expression");
    const hasValue = Object.prototype.hasOwnProperty.call(source, "value");
    let expression = hasExpression ? source.expression : hasValue ? source.value : undefined;
    let value = hasValue ? source.value : expression;
    if (!hasExpression && Object.prototype.hasOwnProperty.call(input, "value")) {
        expression = input.value;
        value = expression;
    }
    const timestamp = Number(source.timestamp ?? input.timestamp ?? Date.now());
    const hash = String(source.hash || "").trim() || toReplayHash({
        path,
        operator,
        expression,
        value,
        timestamp,
    });
    const prevHash = String(source.prevHash || "").trim();
    return materializeReplayMemory(path, operator, value, hash, prevHash, timestamp);
}
function toSemanticReplayData(memory) {
    if (memory.operator === "__" || memory.operator === "->" || memory.operator === "@") {
        return memory.value ?? memory.expression;
    }
    if (memory.operator === "=" || memory.operator === "?" || memory.operator === null) {
        return memory.value;
    }
    if (memory.operator === "_" || memory.operator === "~") {
        return memory.expression ?? memory.value ?? "***";
    }
    return memory.value ?? memory.expression;
}
function replayMemoryKey(memory) {
    return [
        Number(memory.timestamp || 0),
        String(memory.path || ""),
        String(memory.operator ?? ""),
        String(memory.hash || ""),
    ].join(":");
}
function getLegacyMemoriesForNamespace(namespace) {
    const raw = kernelGet(memPath(namespace)) ?? [];
    return raw
        .map((entry) => normalizeLegacyReplayMemory(entry))
        .filter((entry) => Boolean(entry))
        .sort((a, b) => a.timestamp - b.timestamp);
}
function recordMemory(input) {
    const namespace = (0, identity_js_1.normalizeNamespaceIdentity)(input.namespace);
    if (!namespace)
        return null;
    const replay = normalizeLegacyReplayMemory(input.payload);
    if (!replay)
        return null;
    return (0, memoryStore_js_1.appendSemanticMemory)({
        namespace,
        path: replay.path,
        operator: replay.operator,
        data: toSemanticReplayData(replay),
        timestamp: Number(input.timestamp || replay.timestamp || Date.now()),
    });
}
function getMemoriesForNamespace(namespace) {
    const ns = (0, identity_js_1.normalizeNamespaceIdentity)(namespace);
    if (!ns)
        return [];
    const semanticMemories = (0, memoryStore_js_1.listSemanticMemoriesByNamespace)(ns, { limit: 10000 })
        .map((row) => semanticRowToReplayMemory(row));
    const legacyMemories = getLegacyMemoriesForNamespace(ns);
    if (!semanticMemories.length) {
        return legacyMemories;
    }
    if (!legacyMemories.length) {
        return semanticMemories.sort((a, b) => a.timestamp - b.timestamp);
    }
    const merged = new Map();
    for (const memory of [...semanticMemories, ...legacyMemories]) {
        const key = replayMemoryKey(memory);
        if (!merged.has(key)) {
            merged.set(key, memory);
        }
    }
    return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}
function isNamespaceWriteAuthorized(input) {
    const claimIdentityHash = String(input.claimIdentityHash || "").trim();
    if (!claimIdentityHash)
        return false;
    const body = input.body;
    if (!body || typeof body !== "object")
        return false;
    const bodyRecord = body;
    const bodyIdentityHash = String(bodyRecord.identityHash || "").trim();
    if (bodyIdentityHash && bodyIdentityHash === claimIdentityHash)
        return true;
    const publicKey = String(input.claimPublicKey || "").trim();
    const rawSignature = String(bodyRecord.signature || "").trim();
    if (!publicKey || !rawSignature)
        return false;
    const signature = decodeSignature(rawSignature);
    if (!signature)
        return false;
    const signedPayload = String(bodyRecord.signedPayload || "").trim();
    const message = signedPayload || toStableJson(stripWriteAuthFields(bodyRecord));
    return verifySignature(publicKey, message, signature);
}
