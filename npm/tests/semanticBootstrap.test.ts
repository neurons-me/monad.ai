import assert from "assert";
import { db } from "../src/Blockchain/db";
import { ensureRootSemanticBootstrap } from "../src/claim/semanticBootstrap";
import { listSemanticMemoriesByNamespace, readSemanticValueForNamespace } from "../src/claim/memoryStore";
import { normalizeNamespaceRootName } from "../src/namespace/identity";

const ROOT_NAMESPACE = "semantic-bootstrap.cleaker.me";
const CANONICAL_ROOT = normalizeNamespaceRootName(ROOT_NAMESPACE);

function cleanupRootNamespace() {
  db.prepare(`DELETE FROM semantic_memories WHERE namespace = ?`).run(CANONICAL_ROOT);
}

test("seeds only root schema roles into semantic memories", () => {
  cleanupRootNamespace();

  const inserted = ensureRootSemanticBootstrap(ROOT_NAMESPACE);
  assert.ok(inserted >= 7, "expected semantic bootstrap to seed core root role schema");

  const secondInsert = ensureRootSemanticBootstrap(ROOT_NAMESPACE);
  assert.equal(secondInsert, 0, "semantic bootstrap should not duplicate identical memories");

  const rows = listSemanticMemoriesByNamespace(CANONICAL_ROOT, { prefix: "schema.role.", limit: 100 });
  assert.ok(rows.some((row) => row.path === "schema.role.group.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.member.status"));

  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.group.behavior.type"),
    "entity",
  );
  assert.deepEqual(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.member.suggest.contains"),
    ["identity", "permissions", "joined_at"],
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "groups.dev-team"),
    undefined,
  );

  cleanupRootNamespace();
});
