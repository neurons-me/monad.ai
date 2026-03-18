"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const crypto_1 = __importDefault(require("crypto"));
const records_1 = require("../src/claim/records");
function uniqueNamespace() {
    return `claim-${Date.now()}-${crypto_1.default.randomBytes(4).toString("hex")}.cleaker`;
}
function pass(label) {
    console.log(`PASS ${label}`);
}
function fail(label, error) {
    console.error(`FAIL ${label}`);
    throw error instanceof Error ? error : new Error(String(error));
}
function testVerified() {
    const namespace = uniqueNamespace();
    const secret = "luna";
    const claim = (0, records_1.claimNamespace)({ namespace, secret });
    assert_1.default.equal(claim.ok, true, "claim should succeed for a fresh namespace");
    if (!claim.ok) {
        throw new Error(`claim failed with ${claim.error}`);
    }
    const opened = (0, records_1.openNamespace)({ namespace, secret });
    assert_1.default.equal(opened.ok, true, "open should succeed with the correct secret");
    if (!opened.ok) {
        throw new Error(`open failed with ${opened.error}`);
    }
    assert_1.default.equal(opened.record.namespace, namespace);
    assert_1.default.equal(opened.record.identityHash, claim.record.identityHash);
    assert_1.default.equal(opened.noise, claim.noise, "opening must recover the original noise");
}
function testFailed() {
    const namespace = uniqueNamespace();
    const secret = "luna";
    const claim = (0, records_1.claimNamespace)({ namespace, secret });
    assert_1.default.equal(claim.ok, true, "claim should succeed for a fresh namespace");
    if (!claim.ok) {
        throw new Error(`claim failed with ${claim.error}`);
    }
    const opened = (0, records_1.openNamespace)({ namespace, secret: "sol" });
    assert_1.default.equal(opened.ok, false, "open should fail with the wrong secret");
    if (opened.ok) {
        throw new Error("open unexpectedly succeeded");
    }
    assert_1.default.equal(opened.error, "CLAIM_VERIFICATION_FAILED");
}
try {
    testVerified();
    pass("claim_test_verification.verified");
    testFailed();
    pass("claim_test_verification.failed");
    console.log("All claim verification tests passed.");
}
catch (error) {
    fail("claim_test_verification", error);
}
