import type express from "express";
import { getAllBlocks } from "../Blockchain/blockchain";
import { readSemanticBranchForNamespace } from "../claim/memoryStore";
import { resolveNamespace } from "./namespace";
import { normalizeHttpRequestToMeTarget } from "./meTarget";
import { createEnvelope, createErrorEnvelope } from "./envelope";

type LedgerBlockLike = {
  namespace?: string;
  timestamp?: number;
  identityHash?: string;
  expression?: string;
  json?: unknown;
};

export type ResolvedNamespacePath = {
  namespace: string;
  path: string;
  value?: unknown;
  found: boolean;
};

function decodeBlockPayload(block: LedgerBlockLike): Record<string, unknown> | null {
  const rawJson = block?.json;
  const outer =
    typeof rawJson === "string"
      ? JSON.parse(rawJson)
      : (rawJson as Record<string, unknown> | null);

  if (!outer || typeof outer !== "object") return null;

  const embedded = outer.json;
  if (typeof embedded === "string") {
    try {
      const inner = JSON.parse(embedded);
      if (inner && typeof inner === "object") {
        return inner as Record<string, unknown>;
      }
    } catch {
    }
  }

  return outer as Record<string, unknown>;
}

function getByPath(obj: any, path: string) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setDeep(obj: any, path: string, value: any) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      if (!(key in cur)) cur[key] = value;
    } else {
      if (typeof cur[key] !== "object" || cur[key] == null || Array.isArray(cur[key])) {
        cur[key] = {};
      }
      cur = cur[key];
    }
  }
}

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

  const all = await getAllBlocks();
  const blocks = all
    .filter((b: any) => String(b?.namespace || "") === namespace)
    .slice()
    .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));

  const state: Record<string, any> = {};
  for (const bRaw of blocks) {
    const b = bRaw as LedgerBlockLike;
    try {
      const payload = decodeBlockPayload(b);
      if (!payload) continue;
      const expr = String(payload.expression || b?.expression || "").trim();
      if (!expr) continue;
      const value = Object.prototype.hasOwnProperty.call(payload ?? {}, "value")
        ? payload.value
        : payload;
      if (!(expr in state)) state[expr] = value;
    } catch {
    }
  }

  if (dotPath in state) {
    return {
      namespace,
      path: dotPath,
      value: state[dotPath],
      found: true,
    };
  }

  const tree: Record<string, any> = {};
  for (const [expr, value] of Object.entries(state)) {
    setDeep(tree, expr, value);
  }

  const resolved = getByPath(tree, dotPath);
  if (typeof resolved === "undefined") {
    return {
      namespace,
      path: dotPath,
      found: false,
    };
  }

  return {
    namespace,
    path: dotPath,
    value: resolved,
    found: true,
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
