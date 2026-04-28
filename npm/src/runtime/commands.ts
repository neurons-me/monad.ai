import { normalizeNamespaceIdentity, parseNamespaceIdentityParts } from "../namespace/identity.js";
import type { BridgeTarget } from "./bridge.js";

export type ClaimIdentity = {
  host: string;
  username: string;
  effective: string;
};

const RESERVED_SHORT_NAMESPACES = new Set(["self", "kernel", "local"]);

export function normalizeOperation(input: unknown): "read" | "write" | "claim" | "open" {
  const raw = String(input || "").trim().toLowerCase();
  if (raw === "claim" || raw === "open" || raw === "read" || raw === "write") {
    return raw as "read" | "write" | "claim" | "open";
  }
  return "write";
}

export function normalizeClaimableNamespace(raw: unknown): string {
  return normalizeNamespaceIdentity(raw);
}

export function isCanonicalClaimableNamespace(namespace: string): boolean {
  const ns = normalizeClaimableNamespace(namespace);
  if (!ns) return false;
  if (RESERVED_SHORT_NAMESPACES.has(ns)) return true;
  return ns.includes(".");
}

export function resolveCommandNamespace(
  operation: "read" | "write" | "claim" | "open",
  body: Record<string, unknown>,
  parsedTarget: BridgeTarget | null,
  fallbackNamespace: string,
): string {
  const bodyNamespace = normalizeClaimableNamespace(body.namespace);
  if (bodyNamespace) return bodyNamespace;
  if ((operation === "claim" || operation === "open") && parsedTarget?.namespace === "kernel") {
    const commandPath = normalizeClaimableNamespace(parsedTarget.pathSlash || parsedTarget.pathDot);
    if (commandPath) return commandPath;
  }
  return normalizeClaimableNamespace(parsedTarget?.namespace || fallbackNamespace);
}

export function getDefaultReadPolicy(namespace: string) {
  const identity = parseNamespaceIdentityParts(namespace);
  const allowed = ["profile/*", "me/public/*", `${namespace}/*`];
  if (identity.host) allowed.push(`${identity.host}/*`);
  return { allowed, capabilities: ["read"] };
}

export function parseNamespaceIdentity(namespace: string): ClaimIdentity {
  return parseNamespaceIdentityParts(namespace);
}
