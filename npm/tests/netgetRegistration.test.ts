import assert from "node:assert/strict";
import {
  buildNetGetMonadExposure,
  buildNetGetMonadRegistrationPayload,
} from "../src/runtime/netgetRegistration.js";
import type { MonadBootstrapResult } from "../src/bootstrap.js";

function fakeBootstrap(overrides: Partial<MonadBootstrapResult["config"]> = {}): MonadBootstrapResult {
  const env = {
    MONAD_NAME: "Files Surface",
  } as NodeJS.ProcessEnv;

  return {
    config: {
      cwd: "/tmp/monad-files",
      env,
      port: 8161,
      nodeHostname: "suis-macbook-air.local",
      nodeDisplayName: "suis-macbook-air.local:8161",
      fetchProxyTimeoutMs: 15000,
      mePkgDistDir: "/tmp/me",
      cleakerPkgDistDir: "/tmp/cleaker",
      guiPkgDistDir: "/tmp/gui",
      reactUmdDir: "/tmp/react",
      reactDomUmdDir: "/tmp/react-dom",
      routesPath: "/tmp/routes.js",
      indexPath: "/tmp/index.html",
      selfNodeConfig: {
        identity: "files.local",
        monadId: "monad:files",
        monadName: "files",
        tags: ["local", "monad"],
        endpoint: "http://suis-macbook-air.local:8161",
        hostname: "suis-macbook-air.local",
        configPath: "/tmp/self.json",
        resources: ["ledger"],
      },
      localNamespaceRoot: "files.local",
      ...overrides,
    },
    kernelStateDir: "/tmp/state",
    rebuiltProjectedClaims: 0,
    seededSemanticBootstrap: 0,
  };
}

const exposure = buildNetGetMonadExposure("Files Surface");
assert.equal(exposure.visibility, "loopback");
assert.equal(exposure.publishMode, "path");
assert.deepEqual(exposure.inbound.paths, ["/monads/files-surface"]);
assert.equal(exposure.auth.requiredForControl, true);
assert.equal(exposure.auth.requiredForDestructive, true);

const payload = buildNetGetMonadRegistrationPayload({
  bootstrap: fakeBootstrap(),
  id: "monad:test",
  startedAt: "2026-05-26T00:00:00.000Z",
  heartbeatMs: 3_000,
});

assert.ok(payload);
assert.equal(payload.id, "monad:test");
assert.equal(payload.kind, "monad");
assert.equal(payload.name, "monad:files-surface");
assert.equal(payload.host, "127.0.0.1");
assert.equal(payload.port, 8161);
assert.equal(payload.url, "http://127.0.0.1:8161");
assert.equal(payload.status, "running");
assert.equal(payload.health.state, "healthy");
assert.equal(payload.lifecycle.supportsDelete, true);
assert.equal(payload.exposure.visibility, "loopback");
assert.deepEqual(payload.metadata.capabilities, ["control", "events", "gui", "ledger", "mesh", "surface"]);

const invalid = buildNetGetMonadRegistrationPayload({
  bootstrap: fakeBootstrap({ port: 0 }),
  id: "monad:invalid",
  startedAt: "2026-05-26T00:00:00.000Z",
  heartbeatMs: 3_000,
});
assert.equal(invalid, null);

console.log("netgetRegistration ok");
