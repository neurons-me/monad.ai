import { createEnvelope } from "../src/http/envelope";
import { normalizeHttpRequestToMeTarget } from "../src/http/meTarget";
import {
  formatObserverRelationLabel,
  resolveNamespace,
  resolveNamespaceProjectionRoot,
  resolveObserverRelation,
} from "../src/http/namespace";
import {
  normalizeNamespaceIdentity,
  normalizeNamespaceRootName,
  parseNamespaceIdentityParts,
} from "../src/namespace/identity";

function makeRequest(input: {
  host: string;
  path: string;
  method?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  return {
    headers: {
      host: input.host,
    },
    method: input.method || "GET",
    path: input.path,
    query: input.query || {},
    body: input.body || {},
  } as any;
}

describe("observer relation routing", () => {
  const localRoot = normalizeNamespaceRootName("localhost");

  it("prefers the forwarded public host over the proxy host", () => {
    const req = {
      headers: {
        host: "netget.site",
        "x-forwarded-host": "cleaker.me",
      },
      method: "GET",
      path: "/profile",
      query: {},
      body: {},
    } as any;

    expect(resolveNamespace(req)).toBe("cleaker.me");

    const target = normalizeHttpRequestToMeTarget(req);
    expect(target.namespace).toBe("cleaker.me");
    expect(target.nrp).toBe("me://cleaker.me:read/profile");
  });

  it("keeps the target namespace atomic and projects ?as onto the observer namespace", () => {
    const req = makeRequest({
      host: "ana.cleaker.me",
      path: "/profile",
      query: { as: "bella" },
    });

    expect(resolveNamespace(req)).toBe("ana.cleaker.me");

    const relation = resolveObserverRelation(req);
    expect(relation).toEqual({
      operator: "?",
      mode: "observer",
      value: "bella",
      observer: "bella",
      namespace: "bella.cleaker.me",
    });
    expect(formatObserverRelationLabel(relation)).toBe("as:bella.cleaker.me");

    const target = normalizeHttpRequestToMeTarget(req);
    expect(target.nrp).toBe("me://ana.cleaker.me:read/profile?as=bella.cleaker.me");

    const envelope = createEnvelope(target, { namespace: "ana.cleaker.me" }) as any;
    expect(envelope.target.relation).toEqual(relation);
  });

  it("projects the observer onto localhost without polluting the target namespace", () => {
    const req = makeRequest({
      host: "localhost:8161",
      path: "/@ana/profile",
      query: { as: "@bella" },
    });

    expect(resolveNamespace(req)).toBe(`ana.${localRoot}`);

    const relation = resolveObserverRelation(req);
    expect(relation).toEqual({
      operator: "?",
      mode: "observer",
      value: "@bella",
      observer: "bella",
      namespace: `bella.${localRoot}`,
    });

    const target = normalizeHttpRequestToMeTarget(req);
    expect(target.namespace).toBe(`ana.${localRoot}`);
    expect(target.path).toBe("profile");
    expect(target.nrp).toBe(`me://ana.${localRoot}:read/profile?as=bella.${localRoot}`);
  });

  it("uses the cleaker namespace parser for localhost-derived identities", () => {
    expect(normalizeNamespaceIdentity("ana.localhost")).toBe(`ana.${localRoot}`);
    expect(resolveNamespaceProjectionRoot(`ana.${localRoot}`)).toBe(localRoot);
    expect(parseNamespaceIdentityParts("ana.localhost")).toEqual({
      host: localRoot,
      username: "ana",
      effective: `@ana.${localRoot}`,
    });
  });

  it("resolves direct daemon hostnames without going through localhost aliasing", () => {
    const req = makeRequest({
      host: "ana.monad-7f3a.local:8161",
      path: "/profile/name",
    });

    expect(resolveNamespace(req)).toBe("ana.monad-7f3a.local");

    const target = normalizeHttpRequestToMeTarget(req);
    expect(target.namespace).toBe("ana.monad-7f3a.local");
    expect(target.nrp).toBe("me://ana.monad-7f3a.local:read/profile.name");
  });

  it("maps local host aliases onto the configured self identity namespace", () => {
    const previousIdentity = process.env.MONAD_SELF_IDENTITY;
    const previousHostname = process.env.MONAD_SELF_HOSTNAME;
    const previousEndpoint = process.env.MONAD_SELF_ENDPOINT;
    const previousTags = process.env.MONAD_SELF_TAGS;

    process.env.MONAD_SELF_IDENTITY = "monad-9f094393.local";
    process.env.MONAD_SELF_HOSTNAME = "suis-macbook-air.local";
    process.env.MONAD_SELF_ENDPOINT = "http://localhost:8161";
    process.env.MONAD_SELF_TAGS = "local,primary,suis-macbook-air.local,localhost";

    try {
      const req = makeRequest({
        host: "suis-macbook-air.local:8161",
        path: "/profile/name",
      });

      expect(resolveNamespace(req)).toBe("monad-9f094393.local");

      const target = normalizeHttpRequestToMeTarget(req);
      expect(target.namespace).toBe("monad-9f094393.local");
      expect(target.nrp).toBe("me://monad-9f094393.local:read/profile.name");
    } finally {
      if (previousIdentity === undefined) delete process.env.MONAD_SELF_IDENTITY;
      else process.env.MONAD_SELF_IDENTITY = previousIdentity;
      if (previousHostname === undefined) delete process.env.MONAD_SELF_HOSTNAME;
      else process.env.MONAD_SELF_HOSTNAME = previousHostname;
      if (previousEndpoint === undefined) delete process.env.MONAD_SELF_ENDPOINT;
      else process.env.MONAD_SELF_ENDPOINT = previousEndpoint;
      if (previousTags === undefined) delete process.env.MONAD_SELF_TAGS;
      else process.env.MONAD_SELF_TAGS = previousTags;
    }
  });

  it("preserves legacy named views as a non-identity relation", () => {
    const req = makeRequest({
      host: "ana.cleaker.me",
      path: "/profile",
      query: { view: "friends" },
    });

    const relation = resolveObserverRelation(req);
    expect(relation).toEqual({
      operator: "?",
      mode: "view",
      value: "friends",
      observer: null,
      namespace: null,
    });

    const target = normalizeHttpRequestToMeTarget(req);
    expect(formatObserverRelationLabel(target.relation)).toBe("friends");
    expect(target.nrp).toBe("me://ana.cleaker.me:read/profile?view=friends");
  });
});
