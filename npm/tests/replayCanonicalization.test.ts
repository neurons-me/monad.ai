import crypto from "crypto";
import { claimNamespace } from "../src/claim/records";
import { getMemoriesForNamespace, recordMemory } from "../src/claim/replay";
import { seedClaimNamespaceSemantics } from "../src/claim/claimSemantics";
import { db } from "../src/Blockchain/db";

function uniqueNamespace() {
  return `replay-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.cleaker.me`;
}

describe("canonical replay memories", () => {
  it("normalizes generic write payloads into replayable .me memories", async () => {
    const namespace = uniqueNamespace();
    const identityHash = crypto.randomBytes(32).toString("hex");

    const claim = await claimNamespace({
      namespace,
      secret: "luna",
      identityHash,
    });

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    recordMemory({
      namespace,
      identityHash,
      timestamp: Date.now(),
      payload: {
        operation: "write",
        expression: "profile.name",
        value: "Ana",
      },
    });

    const memories = getMemoriesForNamespace(namespace);
    expect(memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "profile.name",
          operator: null,
          expression: "Ana",
          value: "Ana",
        }),
      ]),
    );

    db.prepare(`DELETE FROM semantic_memories WHERE namespace = ?`).run(namespace);
  });

  it("returns semantic claim seeds through the same replay surface", async () => {
    const username = `seed${Date.now().toString(36)}`;
    const namespace = `${username}.cleaker.me`;
    const identityHash = crypto.randomBytes(32).toString("hex");
    const claimedAt = Date.now();

    const claim = await claimNamespace({
      namespace,
      secret: "sol",
      identityHash,
    });

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    seedClaimNamespaceSemantics({
      namespace,
      username,
      name: "Seed User",
      email: `${username}@example.com`,
      phone: "5512345678",
      passwordHash: identityHash,
      timestamp: claimedAt,
    });

    const memories = getMemoriesForNamespace(namespace);
    expect(memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "profile.name",
          operator: "=",
          value: "Seed User",
        }),
        expect.objectContaining({
          path: "auth.claimed_at",
          operator: "=",
          value: claimedAt,
        }),
      ]),
    );

    db.prepare(`DELETE FROM semantic_memories WHERE namespace = ?`).run(namespace);
    db.prepare(`DELETE FROM semantic_memories WHERE namespace = ? AND path = ?`).run("cleaker.me", `users.${username}`);
  });
});
