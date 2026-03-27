import express from "express";
import crypto from "crypto";
import { claimNamespace, openNamespace } from "../claim/records";
import { getMemoriesForNamespace } from "../claim/replay";
import { appendSemanticMemory } from "../claim/memoryStore";
import { normalizeHttpRequestToMeTarget } from "./meTarget";
import { createEnvelope, createErrorEnvelope } from "./envelope";
import { parseNamespaceIdentityParts } from "../namespace/identity";

function toStableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => toStableJson(item)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${toStableJson(obj[key])}`);
  return `{${entries.join(",")}}`;
}

function computeProofId(input: Record<string, unknown>) {
  return crypto
    .createHash("sha256")
    .update(toStableJson(input))
    .digest("hex");
}

function parseNamespaceIdentity(namespace: string) {
  return parseNamespaceIdentityParts(namespace);
}

function getDefaultReadPolicy(namespace: string) {
  const identity = parseNamespaceIdentity(namespace);
  const allowed = ["profile/*", "me/public/*", `${namespace}/*`];
  if (identity.host) {
    allowed.push(`${identity.host}/*`);
  }
  return {
    allowed,
    capabilities: ["read"],
  };
}

function normalizeEmail(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

function normalizePhone(input: unknown): string {
  return String(input || "").trim();
}

function normalizeUsername(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

function validateClaimProfile(body: Record<string, unknown>, namespace: string) {
  const identity = parseNamespaceIdentity(namespace);
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);

  if (!username) return { ok: false as const, error: "USERNAME_REQUIRED" };
  if (!email) return { ok: false as const, error: "EMAIL_REQUIRED" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "EMAIL_INVALID" };
  if (!phone) return { ok: false as const, error: "PHONE_REQUIRED" };
  if (phone.replace(/\D/g, "").length < 8) return { ok: false as const, error: "PHONE_INVALID" };
  if (identity.username && username !== identity.username) {
    return { ok: false as const, error: "USERNAME_NAMESPACE_MISMATCH" };
  }

  return {
    ok: true as const,
    username,
    email,
    phone,
  };
}

export function createClaimsRouter() {
  const router = express.Router();

  router.post("/claims", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = req.body ?? {};
    const namespace = String(body.namespace || "");
    const profile = validateClaimProfile(body as Record<string, unknown>, namespace);
    if (!profile.ok) {
      return res.status(400).json(createErrorEnvelope(target, { error: profile.error }));
    }

    const out = claimNamespace({
      namespace,
      secret: String(body.secret || ""),
      publicKey: String(body.publicKey || "").trim() || null,
      privateKey: String(body.privateKey || "").trim() || null,
    });

    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN"
          ? 409
          : out.error === "NAMESPACE_REQUIRED"
              || out.error === "SECRET_REQUIRED"
              || out.error === "CLAIM_KEY_INVALID"
              || out.error === "CLAIM_KEYPAIR_MISMATCH"
            ? 400
            : 500;
      return res.status(status).json(createErrorEnvelope(target, { error: out.error }));
    }

    const timestamp = Date.now();
    appendSemanticMemory({
      namespace: out.record.namespace,
      path: "profile.username",
      operator: "=",
      data: profile.username,
      timestamp,
    });
    appendSemanticMemory({
      namespace: out.record.namespace,
      path: "profile.email",
      operator: "=",
      data: profile.email,
      timestamp,
    });
    appendSemanticMemory({
      namespace: out.record.namespace,
      path: "profile.phone",
      operator: "=",
      data: profile.phone,
      timestamp,
    });
    appendSemanticMemory({
      namespace: out.record.namespace,
      path: "auth.claimed_at",
      operator: "=",
      data: timestamp,
      timestamp,
    });

    return res.status(201).json(createEnvelope(target, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      publicKey: out.record.publicKey,
      createdAt: out.record.createdAt,
      profile: {
        username: profile.username,
        email: profile.email,
        phone: profile.phone,
      },
      persistentClaim: out.persistentClaim,
    }));
  });

  router.post("/claims/open", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = req.body ?? {};
    const out = openNamespace({
      namespace: String(body.namespace || ""),
      secret: String(body.secret || ""),
    });

    if (!out.ok) {
      const status =
        out.error === "CLAIM_NOT_FOUND"
          ? 404
          : out.error === "CLAIM_VERIFICATION_FAILED"
            ? 403
          : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
              ? 400
              : 500;
      return res.status(status).json(createErrorEnvelope(target, { error: out.error }));
    }

    const memories = getMemoriesForNamespace(out.record.namespace);
    const openedAt = Date.now();
    appendSemanticMemory({
      namespace: out.record.namespace,
      path: "session.opened_at",
      operator: "=",
      data: openedAt,
      timestamp: openedAt,
    });
    const policy = getDefaultReadPolicy(out.record.namespace);
    const identity = parseNamespaceIdentity(out.record.namespace);
    const audit = {
      proofId: computeProofId({
        namespace: out.record.namespace,
        identityHash: out.record.identityHash,
        noise: out.noise,
        memories,
      }),
      openedAt,
    };

    return res.json(createEnvelope(target, {
      verified: true,
      reasonCode: null,
      reason: null,
      identity,
      policy,
      audit,
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      noise: out.noise,
      memories,
      openedAt,
    }));
  });

  return router;
}
