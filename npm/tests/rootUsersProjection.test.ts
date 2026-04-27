import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import { claimNamespace } from "../src/claim/records";
import { getUsersForRootNamespace } from "../src/Blockchain/users";
import { listSemanticMemoriesByNamespace } from "../src/claim/memoryStore";
import { composeProjectedNamespace, normalizeNamespaceRootName } from "../src/namespace/identity";
import { deletePersistentClaim, getPersistentClaimPath } from "../src/claim/manager";

function uniqueUsername(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function uniqueIdentityHash() {
  return crypto.randomBytes(32).toString("hex");
}

test("projects claimed users from the root namespace", async () => {
  const root = "localhost:8161";
  const localRoot = normalizeNamespaceRootName(root);
  const usernameA = uniqueUsername("nefasto");
  const usernameB = uniqueUsername("neferefe");
  const namespaceA = composeProjectedNamespace(usernameA, root);
  const namespaceB = composeProjectedNamespace(usernameB, root);

  try {
    const claimA = await claimNamespace({
      namespace: namespaceA,
      secret: "orwell1984",
      identityHash: uniqueIdentityHash(),
    });
    const claimB = await claimNamespace({
      namespace: namespaceB,
      secret: "animalfarm",
      identityHash: uniqueIdentityHash(),
    });

    assert.equal(claimA.ok, true, "first projected namespace should claim successfully");
    assert.equal(claimB.ok, true, "second projected namespace should claim successfully");

    const users = getUsersForRootNamespace(root);
    const usernames = users.map((user) => user.username);

    assert.ok(
      usernames.includes(usernameA),
      "root namespace users should include the first claimed username",
    );
    assert.ok(
      usernames.includes(usernameB),
      "root namespace users should include the second claimed username",
    );

    const rootPointers = listSemanticMemoriesByNamespace(localRoot, { limit: 500 }).filter((row) =>
      row.path === `users.${usernameA}` || row.path === `users.${usernameB}`,
    );

    assert.equal(rootPointers.length, 2, "root user pointers should be visible through the projected root namespace");
  } finally {
    deletePersistentClaim(namespaceA);
    deletePersistentClaim(namespaceB);
    const claimAPath = getPersistentClaimPath(namespaceA);
    const claimBPath = getPersistentClaimPath(namespaceB);
    if (fs.existsSync(claimAPath)) fs.rmSync(claimAPath, { force: true });
    if (fs.existsSync(claimBPath)) fs.rmSync(claimBPath, { force: true });
  }
});
