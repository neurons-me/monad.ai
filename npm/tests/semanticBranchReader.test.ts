import assert from "assert";
import {
  appendSemanticMemory,
  readSemanticBranchForNamespace,
  readSemanticValueForNamespace,
} from "../src/claim/memoryStore";

const NAMESPACE = "semantic-branch-reader.cleaker.me";

test("reads exact semantic branches without swallowing sibling prefixes", () => {
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
});
