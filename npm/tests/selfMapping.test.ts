import { parseSelectorGroups, resolveSelfDispatch, type SelfNodeConfig } from "../src/http/selfMapping";

const SELF: SelfNodeConfig = {
  identity: "ana.cleaker.me",
  tags: ["macbook", "local", "primary"],
  endpoint: "http://localhost:8161",
  hostname: "Ana-MacBook",
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
    expect(resolveSelfDispatch("ana.cleaker.me", "device:macbook", SELF)).toMatchObject({
      mode: "local",
      hasInstanceSelector: true,
      matched: ["macbook"],
      required: ["macbook"],
    });

    expect(resolveSelfDispatch("ana.cleaker.me", "iphone,macbook", SELF)).toMatchObject({
      mode: "local",
      hasInstanceSelector: true,
      matched: ["macbook"],
    });
  });

  it("marks the request as remote when the identity matches but the instance does not", () => {
    expect(resolveSelfDispatch("ana.cleaker.me", "device:iphone", SELF)).toMatchObject({
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
});
