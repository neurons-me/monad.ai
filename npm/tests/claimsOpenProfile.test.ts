import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { claimNamespace } from "../src/claim/records";
import { seedClaimNamespaceSemantics } from "../src/claim/claimSemantics";
import { readOpenedClaimProfile } from "../src/http/claims";

describe("claims open profile hydration", () => {
  const previousClaimDir = process.env.MONAD_CLAIM_DIR;
  const claimDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-claims-open-"));

  beforeAll(() => {
    process.env.MONAD_CLAIM_DIR = claimDir;
  });

  afterAll(() => {
    if (previousClaimDir === undefined) {
      delete process.env.MONAD_CLAIM_DIR;
    } else {
      process.env.MONAD_CLAIM_DIR = previousClaimDir;
    }
    fs.rmSync(claimDir, { recursive: true, force: true });
  });

  it("reads profile fields and canonical claim timestamp from semantic state", () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const username = `maria${suffix}`.slice(0, 24);
    const namespace = `${username}.cleaker.me`;
    const timestamp = Date.now();

    const claimed = claimNamespace({
      namespace,
      secret: "secret-123",
      identityHash: crypto.randomBytes(32).toString("hex"),
    });

    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    seedClaimNamespaceSemantics({
      namespace,
      username,
      name: "Maria Garcia",
      email: "maria@example.com",
      phone: "+52 729 167 1525",
      passwordHash: claimed.record.identityHash,
      timestamp,
    });

    expect(readOpenedClaimProfile(namespace)).toEqual({
      profile: {
        username,
        name: "Maria Garcia",
        email: "maria@example.com",
        phone: "+52 729 167 1525",
      },
      claimedAt: timestamp,
    });
  });
});
