import { composeNamespace, parseNamespaceExpression } from "cleaker";

export interface NamespaceIdentityParts {
  host: string;
  username: string;
  effective: string;
}

function normalizeRawNamespace(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

function parseLegacyUserNamespace(raw: string): { host: string; username: string; namespace: string } | null {
  const match = String(raw || "").trim().toLowerCase().match(/^([^/\[]+)\/users\/([^/\[]+)$/i);
  if (!match) return null;

  const host = String(match[1] || "").trim().toLowerCase();
  const username = String(match[2] || "").trim().toLowerCase();
  if (!host || !username) return null;

  return {
    host,
    username,
    namespace: `${host}/users/${username}`,
  };
}

function tryParseNamespace(raw: string) {
  try {
    return parseNamespaceExpression(raw);
  } catch {
    return null;
  }
}

export function normalizeNamespaceIdentity(input: unknown): string {
  const raw = normalizeRawNamespace(input);
  if (!raw) return "";

  const legacy = parseLegacyUserNamespace(raw);
  if (legacy) return legacy.namespace;

  const parsed = tryParseNamespace(raw);
  return parsed?.fqdn || raw;
}

export function normalizeNamespaceConstant(input: unknown): string {
  const raw = normalizeRawNamespace(input);
  if (!raw) return "";

  const legacy = parseLegacyUserNamespace(raw);
  if (legacy) return legacy.host;

  const parsed = tryParseNamespace(raw);
  return parsed?.constant || raw;
}

export function isProjectableNamespaceRoot(input: unknown): boolean {
  const raw = normalizeNamespaceIdentity(input);
  if (!raw) return false;
  if (parseLegacyUserNamespace(raw)) return false;

  const parsed = tryParseNamespace(raw);
  if (parsed) return !parsed.prefix;

  const parts = raw.split(".").filter(Boolean);
  if (parts.length === 1 && parts[0] === "localhost") return true;
  if (parts.length === 2 && parts[1] === "localhost") return false;
  return parts.length === 2;
}

export function composeProjectedNamespace(username: string, rootNamespace: string): string {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const constant = normalizeNamespaceConstant(rootNamespace);
  if (!normalizedUsername) return constant;
  if (!constant) return normalizedUsername;

  try {
    return composeNamespace(normalizedUsername, constant);
  } catch {
    return `${normalizedUsername}.${constant}`;
  }
}

export function parseNamespaceIdentityParts(input: unknown): NamespaceIdentityParts {
  const namespace = normalizeNamespaceIdentity(input);
  if (!namespace) {
    return {
      host: "unknown",
      username: "",
      effective: "unclaimed",
    };
  }

  const legacy = parseLegacyUserNamespace(namespace);
  if (legacy) {
    return {
      host: legacy.host,
      username: legacy.username,
      effective: `@${legacy.username}.${legacy.host}`,
    };
  }

  const parsed = tryParseNamespace(namespace);
  if (parsed) {
    const host = parsed.constant || namespace;
    const username = parsed.prefix || "";
    return {
      host,
      username,
      effective: username ? `@${username}.${host}` : `@${host}`,
    };
  }

  return {
    host: namespace,
    username: "",
    effective: `@${namespace}`,
  };
}
