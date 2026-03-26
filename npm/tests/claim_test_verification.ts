import assert from "assert";
import crypto from "crypto";
import { claimNamespace, openNamespace } from "../src/claim/records";
import { listSemanticMemoriesByNamespace } from "../src/claim/memoryStore";

function uniqueNamespace() {
  return `claim-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.cleaker.me`;
}

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, error: unknown): never {
  console.error(`FAIL ${label}`);
  throw error instanceof Error ? error : new Error(String(error));
}

function testVerified() {
  const namespace = uniqueNamespace();
  const secret = "luna";

  const claim = claimNamespace({ namespace, secret });
  assert.equal(claim.ok, true, "claim should succeed for a fresh namespace");
  if (!claim.ok) {
    throw new Error(`claim failed with ${claim.error}`);
  }

  const opened = openNamespace({ namespace, secret });
  assert.equal(opened.ok, true, "open should succeed with the correct secret");
  if (!opened.ok) {
    throw new Error(`open failed with ${opened.error}`);
  }

  assert.equal(opened.record.namespace, namespace);
  assert.equal(opened.record.identityHash, claim.record.identityHash);
  assert.equal(opened.noise, claim.noise, "opening must recover the original noise");
}

function testClaimMaterializesRootUserPointer() {
  const namespace = uniqueNamespace();
  const secret = "luna";
  const username = namespace.split(".")[0];

  const before = listSemanticMemoriesByNamespace("cleaker.me", {
    prefix: `users.${username}`,
    limit: 20,
  }).length;

  const claim = claimNamespace({ namespace, secret });
  assert.equal(claim.ok, true, "claim should succeed for a projected namespace");
  if (!claim.ok) {
    throw new Error(`claim failed with ${claim.error}`);
  }

  const rootMemories = listSemanticMemoriesByNamespace("cleaker.me", {
    prefix: `users.${username}`,
    limit: 20,
  });
  assert.equal(rootMemories.length, before + 1, "claim should materialize one root user pointer");

  const pointer = rootMemories[rootMemories.length - 1];
  assert.equal(pointer.path, `users.${username}`);
  assert.equal(pointer.operator, "__");
  assert.deepEqual(pointer.data, { __ptr: namespace });

  const afterClaimCount = rootMemories.length;
  const opened = openNamespace({ namespace, secret });
  assert.equal(opened.ok, true, "open should succeed after claim");
  if (!opened.ok) {
    throw new Error(`open failed with ${opened.error}`);
  }

  const afterOpen = listSemanticMemoriesByNamespace("cleaker.me", {
    prefix: `users.${username}`,
    limit: 20,
  });
  assert.equal(afterOpen.length, afterClaimCount, "open should not materialize root pointers again");
}

function testFailed() {
  const namespace = uniqueNamespace();
  const secret = "luna";

  const claim = claimNamespace({ namespace, secret });
  assert.equal(claim.ok, true, "claim should succeed for a fresh namespace");
  if (!claim.ok) {
    throw new Error(`claim failed with ${claim.error}`);
  }

  const opened = openNamespace({ namespace, secret: "sol" });
  assert.equal(opened.ok, false, "open should fail with the wrong secret");
  if (opened.ok) {
    throw new Error("open unexpectedly succeeded");
  }

  assert.equal(opened.error, "CLAIM_VERIFICATION_FAILED");
}

try {
  testVerified();
  pass("claim_test_verification.verified");

  testClaimMaterializesRootUserPointer();
  pass("claim_test_verification.root_pointer");

  testFailed();
  pass("claim_test_verification.failed");

  console.log("All claim verification tests passed.");
} catch (error) {
  fail("claim_test_verification", error);
}
