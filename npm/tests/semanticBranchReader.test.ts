import assert from "assert";
import { db } from "../src/Blockchain/db";
import {
  appendSemanticMemory,
  readSemanticBranchForNamespace,
  readSemanticValueForNamespace,
} from "../src/claim/memoryStore";

const NAMESPACE = "semantic-branch-reader.cleaker.me";

function cleanupNamespace() {
  db.prepare(`DELETE FROM semantic_memories WHERE namespace = ?`).run(NAMESPACE);
}

test("reads exact semantic branches without swallowing sibling prefixes", () => {
  cleanupNamespace();

  const timestamp = Date.now();
  appendSemanticMemory({
    namespace: NAMESPACE,
    path: "gui.page.user.route",
    data: "/@username",
    timestamp,
  });
  appendSemanticMemory({
    namespace: NAMESPACE,
    path: "gui.page.user.component",
    data: "CleakerUser",
    timestamp: timestamp + 1,
  });
  appendSemanticMemory({
    namespace: NAMESPACE,
    path: "gui.pagebuilder.status",
    data: "should-not-leak",
    timestamp: timestamp + 2,
  });

  assert.deepEqual(readSemanticBranchForNamespace(NAMESPACE, "gui.page"), {
    user: {
      route: "/@username",
      component: "CleakerUser",
    },
  });

  assert.equal(
    readSemanticValueForNamespace(NAMESPACE, "gui.pagebuilder.status"),
    "should-not-leak",
  );

  cleanupNamespace();
});
