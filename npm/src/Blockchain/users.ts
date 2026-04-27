import { getBlocksForIdentity } from "./blockchain";
import { getClaim } from "../claim/records";
import { listSemanticMemoriesByNamespace } from "../claim/memoryStore";
import { getRootNamespace } from "../kernel/manager";
import { normalizeNamespaceRootName } from "../namespace/identity";
import { readJsonState, writeJsonState } from "../state/jsonStore.js";

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

const LEGACY_USERS_FILE = "legacy-users.json";

function normalizeUsername(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

function readLegacyUsers(): UserRow[] {
  const rows = readJsonState<UserRow[]>(LEGACY_USERS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

function writeLegacyUsers(rows: UserRow[]): void {
  writeJsonState(LEGACY_USERS_FILE, rows);
}

function getProjectedUsersForConfiguredRoot(): UserRow[] {
  return getUsersForRootNamespace(getRootNamespace());
}

export function getAllUsers(): UserRow[] {
  const merged = new Map<string, UserRow>();

  for (const user of [...readLegacyUsers(), ...getProjectedUsersForConfiguredRoot()]) {
    if (!user.username) continue;
    const current = merged.get(user.username);
    if (!current || user.updatedAt >= current.updatedAt) {
      merged.set(user.username, user);
    }
  }

  return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
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

  for (const row of pointerRows) {
    const match = row.path.match(/^users\.([a-z0-9_-]+)$/i);
    const username = normalizeUsername(String(match?.[1] || ""));
    if (!username || seen.has(username)) continue;
    seen.add(username);

    const ptr = row.data as Record<string, unknown> | null;
    const projectedNamespace = String((ptr as { __ptr?: unknown } | null)?.__ptr || "").trim().toLowerCase();
    const claim = projectedNamespace ? getClaim(projectedNamespace) : undefined;

    users.push({
      username,
      identityHash: String(claim?.identityHash || "").trim(),
      publicKey: String(claim?.publicKey || "").trim(),
      createdAt: Number(claim?.createdAt || row.timestamp || 0),
      updatedAt: Number(claim?.updatedAt || row.timestamp || 0),
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
  const nextUser: UserRow = {
    username: normalizedUsername,
    identityHash: normalizedIdentityHash,
    publicKey: normalizedPublicKey,
    createdAt: now,
    updatedAt: now,
  };

  const users = readLegacyUsers();
  users.push(nextUser);
  writeLegacyUsers(users);

  return { ok: true, user: nextUser };
}

export function countBlocksForUser(identityHash: string) {
  return getBlocksForIdentity(identityHash).length;
}
