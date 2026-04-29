import {
  parseCanonicalMeUri,
  projectDnsHostToNamespace,
  type MeDnsProjectionFailureReason,
} from "this.me";

export interface ResolveHostToMeUriOptions {
  knownSpaces?: readonly string[];
}

export type ResolveHostToMeUriResult =
  | {
      ok: true;
      kind: "space";
      host: string;
      namespace: string;
      space: string;
      canonical: null;
      knownSpaces: string[];
    }
  | {
      ok: true;
      kind: "namespace";
      host: string;
      namespace: string;
      handle: string;
      space: string;
      canonical: string;
      knownSpaces: string[];
    }
  | {
      ok: false;
      host: string;
      reason: MeDnsProjectionFailureReason;
      matchedSpace: string | null;
      prefixLabels: string[];
      knownSpaces: string[];
    };

function collectKnownSpaces(options: ResolveHostToMeUriOptions): string[] {
  const rawValues = [
    ...(options.knownSpaces || []),
    process.env.ME_NAMESPACE,
    process.env.MONAD_LOCAL_ALIAS_ROOT,
    process.env.MONAD_CANONICAL_SPACE,
  ];

  const seen = new Set<string>();
  const knownSpaces: string[] = [];
  for (const raw of rawValues) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    knownSpaces.push(value);
  }
  return knownSpaces;
}

export function resolveHostToMeUri(
  rawHost: string,
  options: ResolveHostToMeUriOptions = {},
): ResolveHostToMeUriResult {
  const knownSpaces = collectKnownSpaces(options);
  const projection = projectDnsHostToNamespace(rawHost, knownSpaces);

  if (!projection.ok) {
    return {
      ok: false,
      host: projection.host,
      reason: projection.reason,
      matchedSpace: projection.matchedSpace,
      prefixLabels: projection.prefixLabels,
      knownSpaces,
    };
  }

  if (projection.kind === "space") {
    return {
      ok: true,
      kind: "space",
      host: projection.host,
      namespace: projection.space,
      space: projection.space,
      canonical: null,
      knownSpaces,
    };
  }

  const parsed = parseCanonicalMeUri(projection.uri, { knownSpaces });
  return {
    ok: true,
    kind: "namespace",
    host: projection.host,
    namespace: parsed.namespace,
    handle: parsed.handle,
    space: parsed.space,
    canonical: parsed.href,
    knownSpaces,
  };
}

export function resolveHostToCanonicalNamespace(
  rawHost: string,
  options: ResolveHostToMeUriOptions = {},
): string | null {
  const resolved = resolveHostToMeUri(rawHost, options);
  if (!resolved.ok) return null;
  return resolved.namespace;
}
