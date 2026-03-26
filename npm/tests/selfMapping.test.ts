import {
  buildSelfSurfaceEntry,
  parseSelectorGroups,
  resolveSelfDispatch,
  type SelfNodeConfig,
} from "../src/http/selfMapping";

const SELF: SelfNodeConfig = {
  identity: "example.cleaker.me",
  tags: ["desktop", "local", "primary"],
  endpoint: "http://localhost:8161",
  hostname: "example-host.local",
  configPath: "/tmp/self.json",
};

describe("self mapping", () => {
  it("parses DNF selector groups with typed and bare tags", () => {
    expect(parseSelectorGroups("device:macbook,iphone|cloud;host:edge")).toEqual([
      [{ type: "device", values: ["macbook", "iphone"] }],
      [
        { type: "tag", values: ["cloud"] },
        { type: "host", values: ["edge"] },
      ],
    ]);
  });

  it("matches the local node when the selector targets one of its tags", () => {
    expect(resolveSelfDispatch("example.cleaker.me", "device:desktop", SELF)).toMatchObject({
      mode: "local",
      hasInstanceSelector: true,
      matched: ["desktop"],
      required: ["desktop"],
    });

    expect(resolveSelfDispatch("example.cleaker.me", "iphone,desktop", SELF)).toMatchObject({
      mode: "local",
      hasInstanceSelector: true,
      matched: ["desktop"],
    });
  });

  it("marks the request as remote when the identity matches but the instance does not", () => {
    expect(resolveSelfDispatch("example.cleaker.me", "device:iphone", SELF)).toMatchObject({
      mode: "remote",
      hasInstanceSelector: true,
      required: ["iphone"],
    });
  });

  it("keeps foreign namespaces outside the local identity hub", () => {
    expect(resolveSelfDispatch("bella.cleaker.me", "device:macbook", SELF)).toMatchObject({
      mode: "foreign",
      hasInstanceSelector: true,
      required: ["macbook"],
    });
  });

  it("builds a resolved surface entry from the answering host", () => {
    expect(
      buildSelfSurfaceEntry({
        self: SELF,
        origin: "http://localhost:8161",
        fallbackHost: "example-host.local",
        requestNamespace: "localhost",
        now: 1234,
      }),
    ).toEqual({
      hostId: "example-host.local",
      type: "desktop",
      trust: "owner",
      resources: ["public_ingress", "keychain", "filesystem", "gpu", "camera", "local_lan"],
      capacity: {
        cpuCores: null,
        ramGb: null,
        storageGb: null,
        bandwidthMbps: null,
      },
      status: {
        availability: "online",
        latencyMs: null,
        syncState: "current",
        lastSeen: 1234,
      },
      namespace: "http://example-host.local:8161",
      endpoint: "http://localhost:8161",
      rootName: "cleaker.me",
    });
  });
});
