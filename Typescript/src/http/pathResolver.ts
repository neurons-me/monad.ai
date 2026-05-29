import type express from "express";
import { readSemanticBranchForNamespace } from "../claim/memoryStore.js";
import { resolveNamespace } from "./namespace.js";
import { normalizeHttpRequestToMeTarget } from "./meTarget.js";
import { createEnvelope, createErrorEnvelope } from "./envelope.js";

export type ResolvedNamespacePath = {
  namespace: string;
  path: string;
  value?: unknown;
  found: boolean;
};


function normalizeDotPath(input: string): string {
  return String(input || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\//g, ".")
    .split(".")
    .filter(Boolean)
    .join(".");
}

export async function resolveNamespacePathValue(
  namespaceInput: string,
  dotPathInput: string,
): Promise<ResolvedNamespacePath> {
  const namespace = String(namespaceInput || "").trim();
  const dotPath = normalizeDotPath(dotPathInput);

  if (!dotPath) {
    return {
      namespace,
      path: dotPath,
      found: false,
    };
  }

  const semanticResolved = readSemanticBranchForNamespace(namespace, dotPath);
  if (typeof semanticResolved !== "undefined") {
    return {
      namespace,
      path: dotPath,
      value: semanticResolved,
      found: true,
    };
  }
  return {
    namespace,
    path: dotPath,
    found: false,
  };
}

export function createPathResolverHandler() {
  return async (req: express.Request, res: express.Response) => {
    const rawPath = String(req.path || "");
    const trimmed = rawPath.replace(/^\/+/, "").replace(/\/+$/, "");
    const target = normalizeHttpRequestToMeTarget(req);
    if (!trimmed) {
      return res.status(404).json(createErrorEnvelope(target, { error: "NOT_FOUND" }));
    }

    const namespace = resolveNamespace(req);
    const segments0 = trimmed.split("/").filter(Boolean);

    let segments = segments0;
    if (segments.length > 0 && segments[0].startsWith("@")) {
      segments = segments.slice(1);
      if (segments.length > 0 && segments0.length > 1 && segments0[1].startsWith("@")) {
        segments = segments.slice(1);
      }
    }

    const dotPath = normalizeDotPath(segments.join("/"));
    if (!dotPath) {
      return res.status(404).json(createErrorEnvelope(target, { error: "NOT_FOUND" }));
    }

    const resolved = await resolveNamespacePathValue(namespace, dotPath);
    if (!resolved.found) {
      return res.status(404).json(createErrorEnvelope(target, {
        namespace,
        path: dotPath,
        error: "PATH_NOT_FOUND",
      }));
    }

    return res.json(createEnvelope(target, {
      namespace: resolved.namespace,
      path: resolved.path,
      value: resolved.value,
    }));
  };
}
