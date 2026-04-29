import { resolveHostToMeUri } from "../src/runtime/hostResolver.js";

describe("canonical host resolver", () => {
  it("projects a single-label host into a canonical namespace", () => {
    expect(
      resolveHostToMeUri("https://suign.cleaker.me", {
        knownSpaces: ["cleaker.me"],
      }),
    ).toEqual({
      ok: true,
      kind: "namespace",
      host: "suign.cleaker.me",
      namespace: "suign.cleaker.me",
      handle: "suign",
      space: "cleaker.me",
      canonical: "me://suign.cleaker.me",
      knownSpaces: ["cleaker.me"],
    });
  });

  it("rejects multi-label projection when only the root space is known", () => {
    expect(
      resolveHostToMeUri("foo.bar.cleaker.me", {
        knownSpaces: ["cleaker.me"],
      }),
    ).toMatchObject({
      ok: false,
      host: "foo.bar.cleaker.me",
      reason: "NOT_CANONICAL_NAMESPACE",
      matchedSpace: "cleaker.me",
      prefixLabels: ["foo", "bar"],
    });
  });

  it("prefers the longest known-space suffix deterministically", () => {
    expect(
      resolveHostToMeUri("foo.bar.cleaker.me", {
        knownSpaces: ["cleaker.me", "bar.cleaker.me"],
      }),
    ).toEqual({
      ok: true,
      kind: "namespace",
      host: "foo.bar.cleaker.me",
      namespace: "foo.bar.cleaker.me",
      handle: "foo",
      space: "bar.cleaker.me",
      canonical: "me://foo.bar.cleaker.me",
      knownSpaces: ["cleaker.me", "bar.cleaker.me"],
    });
  });

  it("treats localhost as transport-only", () => {
    expect(
      resolveHostToMeUri("localhost:8161", {
        knownSpaces: ["cleaker.me"],
      }),
    ).toMatchObject({
      ok: false,
      host: "localhost",
      reason: "TRANSPORT_ONLY_HOST",
    });
  });
});
