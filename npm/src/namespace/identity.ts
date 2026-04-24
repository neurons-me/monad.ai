import { composeNamespace, parseNamespaceExpression } from "cleaker";

export interface NamespaceIdentityParts {
  host: string;
  username: string;
  effective: string;
}

export const DEFAULT_LOCAL_NAMESPACE_ROOT = "monad.local";

function normalizeRawNamespace(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

function stripPort(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/:\d+$/i, "");
}

function isLoopbackishHost(raw: string): boolean {
  const host = stripPort(raw);
  return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/.test(host);
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

function resolveLocalNamespaceRoot(): string {
  const configured = normalizeRawNamespace(
    process.env.MONAD_LOCAL_ALIAS_ROOT || process.env.MONAD_SELF_IDENTITY || "",
  );
  if (configured) {
    const parsed = tryParseNamespace(configured);
    const constant = stripPort(parsed?.constant || configured);
    if (constant) return constant;
  }

  return DEFAULT_LOCAL_NAMESPACE_ROOT;
}

function canonicalizeNamespaceConstant(input: unknown): string {
  const constant = stripPort(String(input || ""));
  if (!constant) return "";
  if (isLoopbackishHost(constant)) {
    return resolveLocalNamespaceRoot();
  }
  return constant;
}

function composeIdentityNamespace(prefix: string | null, constant: string): string {
  const normalizedPrefix = String(prefix || "").trim().toLowerCase();
  const normalizedConstant = canonicalizeNamespaceConstant(constant);
  if (!normalizedConstant) return normalizedPrefix;
  if (!normalizedPrefix) return normalizedConstant;

  try {
    return composeNamespace(normalizedPrefix, normalizedConstant);
  } catch {
    return `${normalizedPrefix}.${normalizedConstant}`;
  }
}

export function normalizeNamespaceIdentity(input: unknown): string {
  const raw = normalizeRawNamespace(input);
  if (!raw) return "";

  const legacy = parseLegacyUserNamespace(raw);
  if (legacy) return composeIdentityNamespace(legacy.username, legacy.host);

  const parsed = tryParseNamespace(raw);
  if (parsed) {
    return composeIdentityNamespace(parsed.prefix || null, parsed.constant || raw);
  }

  return canonicalizeNamespaceConstant(raw);
}

export function normalizeNamespaceConstant(input: unknown): string {
  const raw = normalizeRawNamespace(input);
  if (!raw) return "";

  const legacy = parseLegacyUserNamespace(raw);
  if (legacy) return canonicalizeNamespaceConstant(legacy.host);

  const parsed = tryParseNamespace(raw);
  return canonicalizeNamespaceConstant(parsed?.constant || raw);
}

export function normalizeNamespaceRootName(input: unknown): string {
  return normalizeNamespaceConstant(input);
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
