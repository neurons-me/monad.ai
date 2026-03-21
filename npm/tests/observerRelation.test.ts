import { createEnvelope } from "../src/http/envelope";
import { normalizeHttpRequestToMeTarget } from "../src/http/meTarget";
import {
  formatObserverRelationLabel,
  resolveNamespace,
  resolveObserverRelation,
} from "../src/http/namespace";

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

    expect(resolveNamespace(req)).toBe("ana.localhost");

    const relation = resolveObserverRelation(req);
    expect(relation).toEqual({
      operator: "?",
      mode: "observer",
      value: "@bella",
      observer: "bella",
      namespace: "bella.localhost",
    });

    const target = normalizeHttpRequestToMeTarget(req);
    expect(target.namespace).toBe("ana.localhost");
    expect(target.path).toBe("profile");
    expect(target.nrp).toBe("me://ana.localhost:read/profile?as=bella.localhost");
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
