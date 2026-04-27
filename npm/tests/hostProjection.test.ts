import assert from "assert";
import crypto from "crypto";
import {
  appendSemanticMemory,
  getHostStatus,
  listHostMemoryHistory,
  listHostsByNamespace,
} from "../src/claim/memoryStore";

function uniqueUsername() {
  return `host-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

test("projects relative host memories inside the user namespace", () => {
  const username = uniqueUsername();
  const namespace = `${username}.cleaker.me`;
  const hostKey = "suis-macbook-air";
  const fingerprint = `fp-${crypto.randomBytes(6).toString("hex")}`;
  const timestamp = Date.now();

  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.fingerprint`,
    operator: "=",
    data: fingerprint,
    timestamp,
  });
  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.label`,
    operator: "=",
    data: hostKey,
    timestamp: timestamp + 1,
  });
  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.hostname`,
    operator: "=",
    data: "suis-macbook-air.local",
    timestamp: timestamp + 2,
  });
  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.local_endpoint`,
    operator: "=",
    data: "http://localhost:8161",
    timestamp: timestamp + 3,
  });
  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.capabilities`,
    operator: "=",
    data: ["sync", "local_fs"],
    timestamp: timestamp + 4,
  });
  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.status`,
    operator: "=",
    data: "authorized",
    timestamp: timestamp + 5,
  });
  appendSemanticMemory({
    namespace,
    path: `host.${hostKey}.last_seen`,
    operator: "=",
    data: timestamp + 6,
    timestamp: timestamp + 6,
  });

  const hosts = listHostsByNamespace(namespace, username);
  assert.equal(hosts.length, 1, "one host should be projected from relative host memories");

  const host = hosts[0];
  assert.equal(host.namespace, namespace);
  assert.equal(host.username, username);
  assert.equal(host.host_key, hostKey);
  assert.equal(host.fingerprint, fingerprint);
  assert.equal(host.label, hostKey);
  assert.equal(host.hostname, "suis-macbook-air.local");
  assert.equal(host.local_endpoint, "http://localhost:8161");
  assert.equal(host.status, "authorized");
  assert.deepEqual(JSON.parse(host.capabilities_json), ["sync", "local_fs"]);

  assert.equal(
    getHostStatus(namespace, username, fingerprint),
    "authorized",
    "host status should resolve from the namespace-aware projection",
  );

  const history = listHostMemoryHistory(namespace, username, fingerprint, 20);
  assert.ok(history.length >= 6, "host history should include relative host.* events");
  assert.ok(
    history.some((memory) => memory.path === `host.${hostKey}.hostname`),
    "history should preserve relative hostname writes",
  );
  assert.ok(
    history.every((memory) => memory.namespace === namespace),
    "history should remain scoped to the user namespace",
  );
});
