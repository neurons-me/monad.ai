import { appendSemanticMemory } from "./memoryStore";
import { buildClaimSemanticSeeds } from "./semanticCatalog";

export function seedClaimNamespaceSemantics(input: {
  namespace: string;
  username: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  timestamp?: number;
}) {
  const timestamp = Number(input.timestamp || Date.now());
  const namespace = String(input.namespace || "").trim().toLowerCase();

  const seeds = [
    { path: "profile.username", data: String(input.username || "").trim().toLowerCase() },
    { path: "profile.name", data: String(input.name || "").trim() },
    { path: "profile.email", data: String(input.email || "").trim().toLowerCase() },
    { path: "profile.phone", data: String(input.phone || "").trim() },
    { path: "auth.claimed_at", data: timestamp },
    ...buildClaimSemanticSeeds({
      namespace,
      username: input.username,
      passwordHash: input.passwordHash,
    }),
  ];

  for (const seed of seeds) {
    appendSemanticMemory({
      namespace,
      path: seed.path,
      operator: seed.operator || "=",
      data: seed.data,
      timestamp,
    });
  }

  return timestamp;
}
