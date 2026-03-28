import { db } from "../Blockchain/db";
import { normalizeNamespaceRootName } from "../namespace/identity";
import { appendSemanticMemory } from "./memoryStore";
import { ROOT_SCHEMA_SEEDS } from "./semanticCatalog";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function getLatestSemanticValue(namespace: string, path: string): unknown {
  const row = db
    .prepare(
      `
      SELECT data
      FROM semantic_memories
      WHERE namespace = ? AND path = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    )
    .get(namespace, path) as { data: string } | undefined;

  if (!row) return undefined;
  try {
    return JSON.parse(String(row.data || "null"));
  } catch {
    return row.data;
  }
}

function ensureSemanticMemory(
  namespace: string,
  path: string,
  data: unknown,
  operator: string = "=",
  timestamp: number,
): boolean {
  const latest = getLatestSemanticValue(namespace, path);
  if (typeof latest !== "undefined" && stableStringify(latest) === stableStringify(data)) {
    return false;
  }

  appendSemanticMemory({
    namespace,
    path,
    operator,
    data,
    timestamp,
  });
  return true;
}

export function ensureRootSemanticBootstrap(rootNamespaceInput: string): number {
  const rootNamespace = normalizeNamespaceRootName(rootNamespaceInput);
  if (!rootNamespace) return 0;

  const timestamp = Date.now();

  let inserted = 0;
  for (const seed of ROOT_SCHEMA_SEEDS) {
    if (ensureSemanticMemory(rootNamespace, seed.path, seed.data, seed.operator || "=", timestamp)) {
      inserted += 1;
    }
  }

  return inserted;
}
