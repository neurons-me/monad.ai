import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { claimNamespace, openNamespace } from "../src/claim/records";
import {
  getPersistentClaimPath,
  loadPersistentClaim,
  verifyPersistentClaim,
} from "../src/claim/manager";

function uniqueNamespace() {
  return `claim-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.cleaker.me`;
}

function uniqueIdentityHash() {
  return crypto.randomBytes(32).toString("hex");
}

describe("persistent claims", () => {
  const originalClaimDir = process.env.MONAD_CLAIM_DIR;
  let claimDir = "";

  beforeEach(() => {
    claimDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-claims-"));
    process.env.MONAD_CLAIM_DIR = claimDir;
  });

  afterEach(() => {
    if (originalClaimDir === undefined) {
      delete process.env.MONAD_CLAIM_DIR;
    } else {
      process.env.MONAD_CLAIM_DIR = originalClaimDir;
    }

    fs.rmSync(claimDir, { recursive: true, force: true });
  });

  it("creates a signed persistent claim and stores it on disk", async () => {
    const namespace = uniqueNamespace();
    const out = await claimNamespace({
      namespace,
      secret: "luna",
      identityHash: uniqueIdentityHash(),
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(fs.existsSync(getPersistentClaimPath(namespace))).toBe(true);
    expect(out.record.publicKey).toBeTruthy();
    expect(out.persistentClaim.claim.publicKey.key).toBe(out.record.publicKey);
    expect(out.persistentClaim.claim.proofKey.key).toBe(out.record.publicKey);
    expect(verifyPersistentClaim(namespace)).toBe(true);

    const opened = openNamespace({
      namespace,
      secret: "luna",
      identityHash: out.record.identityHash,
    });
    expect(opened.ok).toBe(true);

    const rejected = openNamespace({
      namespace,
      secret: "sol",
      identityHash: out.record.identityHash,
    });
    expect(rejected).toEqual({
      ok: false,
      error: "CLAIM_VERIFICATION_FAILED",
    });
  });

  it("preserves an explicit namespace public key and still signs the passport locally", async () => {
    const namespace = uniqueNamespace();
    const supplied = crypto.generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    }).toString();

    const out = await claimNamespace({
      namespace,
      secret: "sol",
      identityHash: uniqueIdentityHash(),
      publicKey: supplied,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const loaded = loadPersistentClaim(namespace);
    expect(loaded).not.toBeNull();
    expect(loaded?.claim.publicKey.key).toBe(supplied);
    expect(loaded?.claim.proofKey.key).not.toBe(supplied);
    expect(out.record.publicKey).toBe(supplied);
    expect(verifyPersistentClaim(namespace)).toBe(true);
  });

  it("rejects mismatched private/public key pairs", async () => {
    const namespace = uniqueNamespace();
    const a = crypto.generateKeyPairSync("ed25519");
    const b = crypto.generateKeyPairSync("ed25519");

    const out = await claimNamespace({
      namespace,
      secret: "estrella",
      identityHash: uniqueIdentityHash(),
      publicKey: a.publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey: b.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });

    expect(out).toEqual({
      ok: false,
      error: "CLAIM_KEYPAIR_MISMATCH",
    });
  });
});
