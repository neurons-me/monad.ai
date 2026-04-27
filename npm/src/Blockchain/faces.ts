import { readJsonState, writeJsonState } from "../state/jsonStore.js";

export type FaceRow = {
  faceId: string;
  identityHash: string;
  templateHash: string;
  template: string;
  algo: string;
  dims: number;
  createdAt: number;
  updatedAt: number;
};

const LEGACY_FACES_FILE = "legacy-faces.json";

function readFaces(): FaceRow[] {
  const rows = readJsonState<FaceRow[]>(LEGACY_FACES_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

function writeFaces(rows: FaceRow[]): void {
  writeJsonState(LEGACY_FACES_FILE, rows);
}

export function getAllFaces() {
  return readFaces().sort((a, b) => a.createdAt - b.createdAt);
}

export function getFace(faceId: string) {
  const target = String(faceId || "").trim();
  if (!target) return undefined;
  return readFaces().find((row) => row.faceId === target);
}

export function getFacesForIdentity(identityHash: string) {
  const target = String(identityHash || "").trim();
  if (!target) return [];
  return readFaces()
    .filter((row) => row.identityHash === target)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function findIdentityByTemplateHash(templateHash: string) {
  const target = String(templateHash || "").trim();
  if (!target) return null;
  const row = readFaces().find((face) => face.templateHash === target);
  return row?.identityHash ?? null;
}

export function claimFace(args: {
  faceId: string;
  identityHash: string;
  templateHash: string;
  template: string;
  algo: string;
  dims: number;
}) {
  const faceId = String(args.faceId || "").trim();
  const identityHash = String(args.identityHash || "").trim();
  const templateHash = String(args.templateHash || "").trim();
  const template = String(args.template || "");
  const algo = String(args.algo || "").trim();
  const dims = Number(args.dims || 0);

  if (!faceId) return { ok: false as const, error: "FACE_ID_REQUIRED" };
  if (!identityHash) return { ok: false as const, error: "IDENTITY_HASH_REQUIRED" };
  if (!templateHash) return { ok: false as const, error: "TEMPLATE_HASH_REQUIRED" };
  if (!template) return { ok: false as const, error: "TEMPLATE_REQUIRED" };
  if (!algo) return { ok: false as const, error: "ALGO_REQUIRED" };
  if (!Number.isFinite(dims) || dims <= 0) return { ok: false as const, error: "DIMS_REQUIRED" };

  const faces = readFaces();
  const existingByTemplate = faces.find((row) => row.templateHash === templateHash);
  if (existingByTemplate && existingByTemplate.identityHash !== identityHash) {
    return { ok: false as const, error: "FACE_ALREADY_CLAIMED" };
  }

  const now = Date.now();
  const existingByFaceId = faces.find((row) => row.faceId === faceId);
  if (existingByFaceId) {
    if (existingByFaceId.identityHash !== identityHash) {
      return { ok: false as const, error: "FACE_ID_OWNED_BY_OTHER_IDENTITY" };
    }

    existingByFaceId.templateHash = templateHash;
    existingByFaceId.template = template;
    existingByFaceId.algo = algo;
    existingByFaceId.dims = dims;
    existingByFaceId.updatedAt = now;
    writeFaces(faces);
    return { ok: true as const, mode: "updated" as const, faceId };
  }

  faces.push({
    faceId,
    identityHash,
    templateHash,
    template,
    algo,
    dims,
    createdAt: now,
    updatedAt: now,
  });
  writeFaces(faces);
  return { ok: true as const, mode: "created" as const, faceId };
}

export function deleteFace(faceId: string) {
  const id = String(faceId || "").trim();
  if (!id) return { ok: false as const, error: "FACE_ID_REQUIRED" };

  const faces = readFaces();
  const nextFaces = faces.filter((row) => row.faceId !== id);
  if (nextFaces.length === faces.length) {
    return { ok: false as const, error: "FACE_NOT_FOUND" };
  }

  writeFaces(nextFaces);
  return { ok: true as const };
}

export function upsertFaceTemplate(args: {
  faceId: string;
  identityHash: string;
  templateHash: string;
  template: string;
  algo: string;
  dims: number;
}) {
  return claimFace(args);
}

export function getFaceTemplate(identityHash: string) {
  return getFacesForIdentity(String(identityHash || "").trim())[0] ?? null;
}
