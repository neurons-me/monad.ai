import assert from "assert";
import { ensureRootSemanticBootstrap } from "../src/claim/semanticBootstrap";
import {
  listSemanticMemoriesByNamespace,
  readSemanticBranchForNamespace,
  readSemanticValueForNamespace,
} from "../src/claim/memoryStore";
import { normalizeNamespaceRootName } from "../src/namespace/identity";

const ROOT_NAMESPACE = "semantic-bootstrap.cleaker.me";
const CANONICAL_ROOT = normalizeNamespaceRootName(ROOT_NAMESPACE);

test("seeds only root schema roles into semantic memories", () => {
  const inserted = ensureRootSemanticBootstrap(ROOT_NAMESPACE);
  assert.ok(inserted >= 100, "expected semantic bootstrap to seed root schema + gui lexicon");

  const secondInsert = ensureRootSemanticBootstrap(ROOT_NAMESPACE);
  assert.equal(secondInsert, 0, "semantic bootstrap should not duplicate identical memories");

  const rows = listSemanticMemoriesByNamespace(CANONICAL_ROOT, { prefix: "schema.role.", limit: 100 });
  assert.ok(rows.some((row) => row.path === "schema.role.group.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.member.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.keys.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.categories.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.gui.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.page.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.section.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.slot.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.theme.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.surface.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.usage.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.budget.status"));
  assert.ok(rows.some((row) => row.path === "schema.role.pressure.status"));

  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.group.behavior.type"),
    "entity",
  );
  assert.deepEqual(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.member.suggest.contains"),
    ["identity", "permissions", "joined_at"],
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.keys.behavior.type"),
    "entity",
  );
  assert.deepEqual(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.surface.suggest.contains"),
    ["resource", "usage", "policy", "budget", "pressure"],
  );
  assert.deepEqual(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.categories.suggest.contains"),
    ["label", "description", "kind", "order"],
  );
  assert.deepEqual(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.role.gui.suggest.contains"),
    ["theme", "left", "right", "top", "footer", "page", "section"],
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.field.gui.component.type"),
    "string",
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.field.surface.usage.cpu.unit"),
    "ratio",
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.field.surface.resource.cpu.unit"),
    "cores",
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.field.surface.budget.gui.blockchain.rows.unit"),
    "rows",
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "schema.field.surface.pressure.cpu.unit"),
    "ratio",
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "gui.theme.catalog.default"),
    "mdrn.church",
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "gui.page.user.component"),
    "CleakerUser",
  );
  assert.deepEqual(
    readSemanticValueForNamespace(CANONICAL_ROOT, "gui.page.user.sections"),
    ["profile", "relations", "hosts"],
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "gui.left.nav.chain.route"),
    "/chain",
  );
  assert.deepEqual(
    readSemanticBranchForNamespace(CANONICAL_ROOT, "gui.page.user"),
    {
      role: "page",
      route: "/@username",
      title: "User",
      component: "CleakerUser",
      sections: ["profile", "relations", "hosts"],
    },
  );
  assert.equal(
    readSemanticValueForNamespace(CANONICAL_ROOT, "groups.dev-team"),
    undefined,
  );
});
