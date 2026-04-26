"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMemory = recordMemory;
exports.getMemoriesForNamespace = getMemoriesForNamespace;
exports.isNamespaceWriteAuthorized = isNamespaceWriteAuthorized;
const crypto_1 = __importDefault(require("crypto"));
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
function recordMemory(input) {
    const namespace = (0, identity_js_1.normalizeNamespaceIdentity)(input.namespace);
    if (!namespace)
        return;
    const path = memPath(namespace);
    const existing = kernelGet(path) ?? [];
    const updated = [
        ...existing,
        {
            payload: input.payload,
            identityHash: String(input.identityHash || ""),
            timestamp: Number(input.timestamp || Date.now()),
        },
    ];
    kernelSet(path, updated);
}
function getMemoriesForNamespace(namespace) {
    const ns = (0, identity_js_1.normalizeNamespaceIdentity)(namespace);
    if (!ns)
        return [];
    const memories = kernelGet(memPath(ns)) ?? [];
    return [...memories].sort((a, b) => a.timestamp - b.timestamp);
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
