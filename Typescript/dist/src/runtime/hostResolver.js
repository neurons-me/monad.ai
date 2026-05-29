import { parseCanonicalMeUri, projectDnsHostToNamespace, } from "this.me";
function collectKnownSpaces(options) {
    const rawValues = [
        ...(options.knownSpaces || []),
        process.env.ME_NAMESPACE,
        process.env.MONAD_LOCAL_ALIAS_ROOT,
        process.env.MONAD_CANONICAL_SPACE,
    ];
    const seen = new Set();
    const knownSpaces = [];
    for (const raw of rawValues) {
        const value = String(raw || "").trim();
        if (!value || seen.has(value))
            continue;
        seen.add(value);
        knownSpaces.push(value);
    }
    return knownSpaces;
}
export function resolveHostToMeUri(rawHost, options = {}) {
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
export function resolveHostToCanonicalNamespace(rawHost, options = {}) {
    const resolved = resolveHostToMeUri(rawHost, options);
    if (!resolved.ok)
        return null;
    return resolved.namespace;
}
