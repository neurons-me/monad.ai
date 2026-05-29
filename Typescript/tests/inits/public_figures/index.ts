import { PUBLIC_FIGURES, PUBLIC_FIGURES_PASSWORD, type PublicFigureSeed } from "./data.ts";
import { createHash } from "crypto";
import { pathToFileURL } from "url";

const MONAD_ORIGIN = String(process.env.MONAD_ORIGIN || process.env.MONAD_API_ORIGIN || "http://localhost:8161").replace(/\/+$/, "");
const EXPLICIT_ROOT_NAMESPACE = normalizeNamespace(process.env.ROOT_NAMESPACE || "");
const DEFAULT_ROOT_NAMESPACE = "cleaker.me";
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.PUBLIC_FIGURES_DRY_RUN || ""));

type SemanticEvent = {
  namespace: string;
  path: string;
  operator?: string;
  data: unknown;
  timestamp?: number;
};

function normalizeNamespace(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function normalizeUsername(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function composeNamespace(username: string, rootNamespace: string): string {
  const safeUsername = normalizeUsername(username);
  const safeRoot = normalizeNamespace(rootNamespace);
  if (!safeUsername) return safeRoot;
  if (!safeRoot) return safeUsername;
  return `${safeUsername}.${safeRoot}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function buildKernelIdentityHash(namespace: string): string {
  return createHash("sha256").update(`public-figures:${normalizeNamespace(namespace)}`).digest("hex");
}

function normalizeSlashPath(path: string): string {
  return String(path || "")
    .trim()
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function readEnvelopeValue(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (record.target && typeof record.target === "object") {
    const target = record.target as Record<string, unknown>;
    if ("value" in target) return target.value;
  }
  if ("value" in record) return record.value;
  return undefined;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  return response.json().catch(() => null);
}

async function resolveInstallRootNamespace(): Promise<string> {
  if (EXPLICIT_ROOT_NAMESPACE) return EXPLICIT_ROOT_NAMESPACE;

  try {
    const payload = await fetchJson(`${MONAD_ORIGIN}/__bootstrap`, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const surfaceEntry =
        record.surfaceEntry && typeof record.surfaceEntry === "object"
          ? (record.surfaceEntry as Record<string, unknown>)
          : null;
      const rootName = normalizeNamespace(surfaceEntry?.rootName || "");
      if (rootName) return rootName;

      const targetRecord =
        record.target && typeof record.target === "object"
          ? (record.target as Record<string, unknown>)
          : null;
      const targetNamespace =
        targetRecord?.namespace && typeof targetRecord.namespace === "object"
          ? (targetRecord.namespace as Record<string, unknown>).me
          : targetRecord?.namespace;
      const namespace =
        normalizeNamespace(record.namespace || "") ||
        normalizeNamespace(targetNamespace || "");
      if (namespace && namespace !== "localhost") return namespace;
    }
  } catch {
  }

  return DEFAULT_ROOT_NAMESPACE;
}

async function readSemanticValue(namespace: string, path: string): Promise<unknown> {
  const safeNamespace = normalizeNamespace(namespace);
  const safePath = normalizeSlashPath(path);
  const url = `${MONAD_ORIGIN}/${safePath}`;
  const payload = await fetchJson(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-forwarded-host": safeNamespace,
    },
  });
  return readEnvelopeValue(payload);
}

async function commitEvents(events: SemanticEvent[]): Promise<void> {
  if (events.length === 0) return;
  if (DRY_RUN) {
    console.log(`DRY RUN · would commit ${events.length} semantic events`);
    return;
  }

  const payload = await fetchJson(`${MONAD_ORIGIN}/api/v1/commit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ events }),
  }) as { results?: Array<{ ok?: boolean; error?: string }> } | null;

  const failures = Array.isArray(payload?.results)
    ? payload.results.filter((item) => !item?.ok)
    : [];

  if (failures.length > 0) {
    throw new Error(`Semantic commit failed: ${failures.map((failure) => failure.error || "unknown").join(", ")}`);
  }
}

async function ensureSemanticValue(event: SemanticEvent): Promise<boolean> {
  const current = await readSemanticValue(event.namespace, event.path).catch(() => undefined);
  if (stableStringify(current) === stableStringify(event.data)) {
    return false;
  }

  await commitEvents([{
    namespace: normalizeNamespace(event.namespace),
    path: event.path,
    operator: event.operator || "=",
    data: event.data,
    timestamp: event.timestamp || Date.now(),
  }]);
  return true;
}

async function ensureSemanticBatch(events: SemanticEvent[]): Promise<number> {
  let written = 0;
  for (const event of events) {
    const changed = await ensureSemanticValue(event);
    if (changed) written += 1;
  }
  return written;
}

async function ensureClaim(figure: PublicFigureSeed, namespace: string): Promise<"created" | "existing"> {
  const body = {
    namespace,
    username: figure.username,
    email: `${figure.username}@public-figures.${parseNamespaceRoot(namespace)}`,
    phone: `550000${String(PUBLIC_FIGURES.indexOf(figure) + 1).padStart(4, "0")}`,
    secret: PUBLIC_FIGURES_PASSWORD,
    identityHash: buildKernelIdentityHash(namespace),
  };

  if (DRY_RUN) {
    console.log(`DRY RUN · would claim ${namespace}`);
    return "created";
  }

  const response = await fetch(`${MONAD_ORIGIN}/claims`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 201) return "created";
  if (response.status === 409) return "existing";

  const payload = await response.json().catch(() => null);
  throw new Error(`Claim failed for ${namespace}: HTTP ${response.status} ${JSON.stringify(payload)}`);
}

function buildRootSchemaEvents(rootNamespace: string): SemanticEvent[] {
  const namespace = normalizeNamespace(rootNamespace);
  return [
    { namespace, path: "schema.role.profile.status", data: "adopted" },
    { namespace, path: "schema.role.profile.behavior.type", data: "entity" },
    { namespace, path: "schema.role.profile.suggest.contains", data: ["username", "name", "type", "field", "birth_date", "death_date", "origin", "parent"] },
    { namespace, path: "schema.role.parent.status", data: "adopted" },
    { namespace, path: "schema.role.parent.behavior.type", data: "entity" },
    { namespace, path: "schema.role.parent.suggest.contains", data: ["father", "mother"] },
    { namespace, path: "schema.field.profile.name.type", data: "string" },
    { namespace, path: "schema.field.profile.type.type", data: "entity" },
    { namespace, path: "schema.field.profile.type.public_figure.type", data: "boolean" },
    { namespace, path: "schema.field.profile.field.type", data: "string" },
    { namespace, path: "schema.field.profile.birth_date.type", data: "date" },
    { namespace, path: "schema.field.profile.death_date.type", data: "date|null" },
    { namespace, path: "schema.field.profile.origin.type", data: "string" },
    { namespace, path: "schema.field.profile.parent.type", data: "entity" },
    { namespace, path: "schema.field.profile.parent.father.type", data: "string|null" },
    { namespace, path: "schema.field.profile.parent.mother.type", data: "string|null" },
    { namespace, path: "contexts.public_figures.status", data: "installed" },
    { namespace, path: "contexts.public_figures.version", data: 1 },
    { namespace, path: "contexts.public_figures.password_policy", data: "shared-orwell1984" },
    { namespace, path: "contexts.public_figures.total", data: PUBLIC_FIGURES.length },
    { namespace, path: "contexts.public_figures.root_namespace", data: namespace },
    { namespace, path: "contexts.public_figures.description", data: "Public figures starter pack for Cleaker semantic roots." },
  ];
}

function buildFigureEvents(rootNamespace: string, figure: PublicFigureSeed): SemanticEvent[] {
  const namespace = composeNamespace(figure.username, rootNamespace);
  const events: SemanticEvent[] = [
    { namespace, path: "profile.username", data: figure.username },
    { namespace, path: "profile.name", data: figure.name },
    { namespace, path: "profile.type.public_figure", data: true },
    { namespace, path: "profile.field", data: figure.field },
    { namespace, path: "profile.birth_date", data: figure.birthDate },
    { namespace, path: "profile.origin", data: figure.origin },
    { namespace, path: "public.status", data: "indexed" },
  ];

  if (figure.deathDate) {
    events.push({ namespace, path: "profile.death_date", data: figure.deathDate });
  }
  if (figure.father) {
    events.push({ namespace, path: "profile.parent.father", data: figure.father });
  }
  if (figure.mother) {
    events.push({ namespace, path: "profile.parent.mother", data: figure.mother });
  }

  return events;
}

function parseNamespaceRoot(namespace: string): string {
  const parts = normalizeNamespace(namespace).split(".").filter(Boolean);
  if (parts.length <= 1) return normalizeNamespace(namespace);
  return parts.slice(1).join(".");
}

async function installPublicFigures(): Promise<void> {
  const rootNamespace = await resolveInstallRootNamespace();
  console.log(`Installing public figures context into ${rootNamespace} via ${MONAD_ORIGIN}`);
  if (DRY_RUN) {
    console.log("Running in dry-run mode. No remote writes will happen.");
  }

  const rootSchemaWrites = await ensureSemanticBatch(buildRootSchemaEvents(rootNamespace));
  console.log(`Root schema/context writes: ${rootSchemaWrites}`);

  let createdClaims = 0;
  let existingClaims = 0;
  let semanticWrites = 0;

  for (const figure of PUBLIC_FIGURES) {
    const namespace = composeNamespace(figure.username, rootNamespace);
    const claimStatus = await ensureClaim(figure, namespace);
    if (claimStatus === "created") createdClaims += 1;
    else existingClaims += 1;

    const writes = await ensureSemanticBatch(buildFigureEvents(rootNamespace, figure));
    semanticWrites += writes;
    console.log(`• ${namespace} · claim=${claimStatus} · semantic writes=${writes}`);
  }

  console.log(`Done. claims(created=${createdClaims}, existing=${existingClaims}), semanticWrites=${semanticWrites}`);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  installPublicFigures().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
