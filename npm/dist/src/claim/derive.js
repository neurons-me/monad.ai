"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveUnlockKey = deriveUnlockKey;
exports.deriveSecretCommitment = deriveSecretCommitment;
exports.encryptNoise = encryptNoise;
exports.decryptNoise = decryptNoise;
const crypto_1 = __importDefault(require("crypto"));
function deriveUnlockKey(namespace, secret) {
    return crypto_1.default.scryptSync(secret, namespace, 32);
}
function deriveSecretCommitment(namespace, secret) {
    const unlockKey = deriveUnlockKey(namespace, secret);
    return crypto_1.default
        .createHmac("sha256", unlockKey)
        .update(`${namespace}:secret_commitment`)
        .digest("hex");
}
function encryptNoise(noise, unlockKey) {
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv("aes-256-cbc", unlockKey, iv);
    let encrypted = cipher.update(noise, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
}
function decryptNoise(encryptedData, unlockKey) {
    const [ivHex, encrypted] = String(encryptedData || "").split(":");
    if (!ivHex || !encrypted) {
        throw new Error("INVALID_ENCRYPTED_NOISE");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto_1.default.createDecipheriv("aes-256-cbc", unlockKey, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
