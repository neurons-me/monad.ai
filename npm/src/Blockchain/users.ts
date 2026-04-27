import { getBlocksForIdentity } from "./blockchain";
import { getClaim } from "../claim/records";
import { appendSemanticMemory, buildSemanticTreeForNamespace, listSemanticMemoriesByNamespace } from "../claim/memoryStore";
import { getRootNamespace } from "../kernel/manager";
import { composeProjectedNamespace, normalizeNamespaceRootName } from "../namespace/identity";

export type UserRow = {
  username: string;
  identityHash: string;
  publicKey: string;
  createdAt: number;
  updatedAt: number;
};

export type ClaimUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; error: "USERNAME_TAKEN" | "USERNAME_REQUIRED" | "IDENTITY_HASH_REQUIRED" | "PUBLIC_KEY_REQUIRED" };

function normalizeUsername(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

function getProjectedUsersForConfiguredRoot(): UserRow[] {
  return getUsersForRootNamespace(getRootNamespace());
}

export function getAllUsers(): UserRow[] {
  return getProjectedUsersForConfiguredRoot().sort((a, b) => a.createdAt - b.createdAt);
}

function readProjectedUsersMetadata(rootNamespace: string): Record<string, Record<string, unknown>> {
  const tree = buildSemanticTreeForNamespace(rootNamespace) as Record<string, unknown>;
  const usersBranch = tree.users as Record<string, unknown> | undefined;
  const records: Record<string, Record<string, unknown>> = {};

  if (!usersBranch || typeof usersBranch !== "object" || Array.isArray(usersBranch)) {
    return records;
  }

  for (const [username, record] of Object.entries(usersBranch)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    records[username] = record as Record<string, unknown>;
  }

  return records;
}

export function getUsersForRootNamespace(rootNamespaceInput: string): UserRow[] {
  const rootNamespace = normalizeNamespaceRootName(rootNamespaceInput);
  if (!rootNamespace) return [];

  const rows = listSemanticMemoriesByNamespace(rootNamespace) as Array<{
    path: string;
    data: unknown;
    timestamp: number;
  }>;

  const pointerRows = rows.filter((row) => /^users\.[a-z0-9_-]+$/i.test(row.path));
  const seen = new Set<string>();
  const users: UserRow[] = [];
  const projectedMetadata = readProjectedUsersMetadata(rootNamespace);

  for (const row of pointerRows) {
    const match = row.path.match(/^users\.([a-z0-9_-]+)$/i);
    const username = normalizeUsername(String(match?.[1] || ""));
    if (!username || seen.has(username)) continue;
    seen.add(username);

    const ptr = row.data as Record<string, unknown> | null;
    const projectedNamespace = String((ptr as { __ptr?: unknown } | null)?.__ptr || "").trim().toLowerCase()
      || composeProjectedNamespace(username, rootNamespace);
    const claim = projectedNamespace ? getClaim(projectedNamespace) : undefined;
    const metadata = projectedMetadata[username] || {};

    users.push({
      username,
      identityHash: String(claim?.identityHash || metadata.identityHash || "").trim(),
      publicKey: String(claim?.publicKey || metadata.publicKey || "").trim(),
      createdAt: Number(claim?.createdAt || metadata.createdAt || row.timestamp || 0),
      updatedAt: Number(claim?.updatedAt || metadata.updatedAt || row.timestamp || 0),
    });
  }

  return users;
}

export function getUser(username: string): UserRow | undefined {
  const normalized = normalizeUsername(username);
  if (!normalized) return undefined;

  return getAllUsers().find((user) => user.username === normalized);
}

export function claimUser(
  username: string,
  identityHash: string,
  publicKey: string,
): ClaimUserResult {
  const normalizedUsername = normalizeUsername(username);
  const normalizedIdentityHash = String(identityHash || "").trim();
  const normalizedPublicKey = String(publicKey || "").trim();

  if (!normalizedUsername) return { ok: false, error: "USERNAME_REQUIRED" };
  if (!normalizedIdentityHash) return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
  if (!normalizedPublicKey) return { ok: false, error: "PUBLIC_KEY_REQUIRED" };

  if (getUser(normalizedUsername)) {
    return { ok: false, error: "USERNAME_TAKEN" };
  }

  const now = Date.now();
  const rootNamespace = getRootNamespace();
  const projectedNamespace = composeProjectedNamespace(normalizedUsername, rootNamespace);
  const nextUser: UserRow = {
    username: normalizedUsername,
    identityHash: normalizedIdentityHash,
    publicKey: normalizedPublicKey,
    createdAt: now,
    updatedAt: now,
  };

  appendSemanticMemory({
    namespace: rootNamespace,
    path: `users.${normalizedUsername}`,
    operator: "__",
    data: { __ptr: projectedNamespace },
    timestamp: now,
  });
  appendSemanticMemory({
    namespace: rootNamespace,
    path: `users.${normalizedUsername}.identityHash`,
    data: normalizedIdentityHash,
    timestamp: now,
  });
  appendSemanticMemory({
    namespace: rootNamespace,
    path: `users.${normalizedUsername}.publicKey`,
    data: normalizedPublicKey,
    timestamp: now,
  });
  appendSemanticMemory({
    namespace: rootNamespace,
    path: `users.${normalizedUsername}.createdAt`,
    data: now,
    timestamp: now,
  });
  appendSemanticMemory({
    namespace: rootNamespace,
    path: `users.${normalizedUsername}.updatedAt`,
    data: now,
    timestamp: now,
  });

  return { ok: true, user: nextUser };
}

export function countBlocksForUser(identityHash: string) {
  return getBlocksForIdentity(identityHash).length;
}
