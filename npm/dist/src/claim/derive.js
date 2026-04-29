import crypto from "crypto";
export function deriveUnlockKey(namespace, secret) {
    return crypto.scryptSync(secret, namespace, 32);
}
export function deriveSecretCommitment(namespace, secret) {
    const unlockKey = deriveUnlockKey(namespace, secret);
    return crypto
        .createHmac("sha256", unlockKey)
        .update(`${namespace}:secret_commitment`)
        .digest("hex");
}
export function encryptNoise(noise, unlockKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", unlockKey, iv);
    let encrypted = cipher.update(noise, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
}
export function decryptNoise(encryptedData, unlockKey) {
    const [ivHex, encrypted] = String(encryptedData || "").split(":");
    if (!ivHex || !encrypted) {
        throw new Error("INVALID_ENCRYPTED_NOISE");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", unlockKey, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
