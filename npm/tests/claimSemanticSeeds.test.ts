import fs from "fs";
import os from "os";
import path from "path";
import { claimNamespace } from "../src/claim/records";
import { seedClaimNamespaceSemantics } from "../src/claim/claimSemantics";
import { db } from "../src/Blockchain/db";
import { readSemanticValueForNamespace } from "../src/claim/memoryStore";

describe("claim semantic seeds", () => {
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

  it("seeds keys and polls.studio categories for a claimed namespace", async () => {
    const username = `polls${Date.now().toString(36)}`;
    const namespace = `${username}.cleaker.me`;
    const claim = claimNamespace({ namespace, secret: "luna" });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    seedClaimNamespaceSemantics({
      namespace,
      username,
      email: `${username}@example.com`,
      phone: "5512345678",
      passwordHash: claim.record.identityHash,
      timestamp: Date.now(),
    });

    expect(readSemanticValueForNamespace(namespace, "keys.username")).toBe(username);
    expect(readSemanticValueForNamespace(namespace, "keys.password_hash")).toBeTruthy();
    expect(readSemanticValueForNamespace(namespace, "keys.namespace")).toBe(namespace);
    expect(readSemanticValueForNamespace(namespace, "polls.studio.categories.jobs.label")).toBe("Jobs");
    expect(readSemanticValueForNamespace(namespace, "polls.studio.categories.housing.kind")).toBe("housing");

    db.prepare(`DELETE FROM semantic_memories WHERE namespace = ?`).run(namespace);
    db.prepare(`DELETE FROM semantic_memories WHERE namespace = ? AND path = ?`).run("cleaker.me", `users.${username}`);
    db.prepare(`DELETE FROM claims WHERE namespace = ?`).run(namespace);
  });
});
