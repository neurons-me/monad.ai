import assert from "assert";
import crypto from "crypto";
import { claimNamespace, openNamespace } from "../src/claim/records";
import { listSemanticMemoriesByNamespace } from "../src/claim/memoryStore";

function uniqueNamespace() {
  return `claim-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.cleaker.me`;
}

function uniqueIdentityHash() {
  return crypto.randomBytes(32).toString("hex");
}

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, error: unknown): never {
  console.error(`FAIL ${label}`);
  throw error instanceof Error ? error : new Error(String(error));
}

async function testVerified() {
  const namespace = uniqueNamespace();
  const secret = "luna";
  const identityHash = uniqueIdentityHash();

  const claim = await claimNamespace({ namespace, secret, identityHash });
  assert.equal(claim.ok, true, "claim should succeed for a fresh namespace");
  if (!claim.ok) {
    throw new Error(`claim failed with ${claim.error}`);
  }

  const opened = openNamespace({ namespace, secret, identityHash });
  assert.equal(opened.ok, true, "open should succeed with the correct secret");
  if (!opened.ok) {
    throw new Error(`open failed with ${opened.error}`);
  }

  assert.equal(opened.record.namespace, namespace);
  assert.equal(opened.record.identityHash, claim.record.identityHash);
  assert.equal(opened.noise, claim.noise, "opening must recover the original noise");
}

async function testClaimMaterializesRootUserPointer() {
  const namespace = uniqueNamespace();
  const secret = "luna";
  const identityHash = uniqueIdentityHash();
  const username = namespace.split(".")[0];

  const before = listSemanticMemoriesByNamespace("cleaker.me", {
    prefix: `users.${username}`,
    limit: 20,
  }).length;

  const claim = await claimNamespace({ namespace, secret, identityHash });
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
  const opened = openNamespace({ namespace, secret, identityHash });
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

async function testFailed() {
  const namespace = uniqueNamespace();
  const secret = "luna";
  const identityHash = uniqueIdentityHash();

  const claim = await claimNamespace({ namespace, secret, identityHash });
  assert.equal(claim.ok, true, "claim should succeed for a fresh namespace");
  if (!claim.ok) {
    throw new Error(`claim failed with ${claim.error}`);
  }

  const opened = openNamespace({ namespace, secret: "sol", identityHash });
  assert.equal(opened.ok, false, "open should fail with the wrong secret");
  if (opened.ok) {
    throw new Error("open unexpectedly succeeded");
  }

  assert.equal(opened.error, "CLAIM_VERIFICATION_FAILED");
}

async function testWrongIdentity() {
  const namespace = uniqueNamespace();
  const secret = "luna";
  const identityHash = uniqueIdentityHash();

  const claim = await claimNamespace({ namespace, secret, identityHash });
  assert.equal(claim.ok, true, "claim should succeed for a fresh namespace");
  if (!claim.ok) {
    throw new Error(`claim failed with ${claim.error}`);
  }

  const opened = openNamespace({
    namespace,
    secret,
    identityHash: uniqueIdentityHash(),
  });
  assert.equal(opened.ok, false, "open should fail for a different kernel identity");
  if (opened.ok) {
    throw new Error("open unexpectedly succeeded");
  }

  assert.equal(opened.error, "IDENTITY_MISMATCH");
}

async function main() {
  await testVerified();
  pass("claim_test_verification.verified");

  await testClaimMaterializesRootUserPointer();
  pass("claim_test_verification.root_pointer");

  await testFailed();
  pass("claim_test_verification.failed");

  await testWrongIdentity();
  pass("claim_test_verification.identity_mismatch");

  console.log("All claim verification tests passed.");
}

main().catch((error) => {
  fail("claim_test_verification", error);
});
