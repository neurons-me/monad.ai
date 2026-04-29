import type express from "express";
import { claimNamespace, getClaim, openNamespace } from "../claim/records.js";
import { getMemoriesForNamespace, isNamespaceWriteAuthorized, recordMemory } from "../claim/replay.js";
import { createEnvelope, createErrorEnvelope } from "../http/envelope.js";
import { normalizeHttpRequestToMeTarget } from "../http/meTarget.js";
import { resolveNamespace } from "../http/namespace.js";
import { computeProofId } from "../infra/hash.js";
import {
  buildKernelCommandTarget,
  buildNormalizedTarget,
  parseBridgeTarget,
} from "../runtime/bridge.js";
import {
  getDefaultReadPolicy,
  isCanonicalClaimableNamespace,
  normalizeClaimableNamespace,
  normalizeOperation,
  parseNamespaceIdentity,
  resolveCommandNamespace,
} from "../runtime/commands.js";

function claimStatusCode(error: string): number {
  if (error === "NAMESPACE_TAKEN") return 409;
  if (
    error === "NAMESPACE_REQUIRED" || error === "SECRET_REQUIRED"
    || error === "IDENTITY_HASH_REQUIRED" || error === "CLAIM_KEY_INVALID"
    || error === "CLAIM_KEYPAIR_MISMATCH" || error === "PROOF_MESSAGE_INVALID"
    || error === "PROOF_NAMESPACE_MISMATCH" || error === "PROOF_TIMESTAMP_INVALID"
  ) return 400;
  if (error === "PROOF_INVALID") return 403;
  return 500;
}

function openStatusCode(error: string): number {
  if (error === "CLAIM_NOT_FOUND") return 404;
  if (error === "CLAIM_VERIFICATION_FAILED" || error === "IDENTITY_MISMATCH") return 403;
  if (
    error === "NAMESPACE_REQUIRED" || error === "SECRET_REQUIRED"
    || error === "IDENTITY_HASH_REQUIRED"
  ) return 400;
  return 500;
}

// POST /me/* — kernel claim/open commands via me:// URI
export const meCommandHandler: express.RequestHandler = async (req, res) => {
  const rawTarget = decodeURIComponent(String((req.params as any)[0] || "").trim());
  const parsedTarget = parseBridgeTarget(rawTarget.startsWith("me://") ? rawTarget : `me://${rawTarget}`);

  if (!parsedTarget) {
    const target = buildKernelCommandTarget(req, "claim", "");
    return res.status(400).json(createErrorEnvelope(target, {
      error: "TARGET_REQUIRED",
      detail: "Expected a me target after /me/.",
    }));
  }

  if (parsedTarget.namespace !== "kernel" || (parsedTarget.selector !== "claim" && parsedTarget.selector !== "open")) {
    const target = buildKernelCommandTarget(
      req,
      parsedTarget.selector === "open" ? "open" : "claim",
      parsedTarget.pathSlash || parsedTarget.pathDot,
    );
    return res.status(501).json(createErrorEnvelope(target, {
      error: "KERNEL_COMMAND_UNSUPPORTED",
      detail: "Only kernel claim/open commands are implemented on /me/* for now.",
    }));
  }

  const operation = parsedTarget.selector as "claim" | "open";
  const body = (req.body ?? {}) as Record<string, unknown>;
  const namespace = normalizeClaimableNamespace(body.namespace || parsedTarget.pathSlash || parsedTarget.pathDot);
  const target = buildKernelCommandTarget(req, operation, namespace);

  if (!namespace) {
    return res.status(400).json(createErrorEnvelope(target, { error: "NAMESPACE_REQUIRED" }));
  }

  if (!isCanonicalClaimableNamespace(namespace)) {
    return res.status(400).json(createErrorEnvelope(target, {
      error: "FULL_NAMESPACE_REQUIRED",
      detail: "Public claims should use a full namespace such as username.cleaker.me.",
    }));
  }

  if (operation === "claim") {
    const out = await claimNamespace({
      namespace,
      secret: String(body.secret || ""),
      identityHash: String(body.identityHash || "").trim(),
      publicKey: String(body.publicKey || "").trim() || null,
      privateKey: String(body.privateKey || "").trim() || null,
      proof: (body.proof && typeof body.proof === "object") ? body.proof as any : null,
    });

    if (!out.ok) return res.status(claimStatusCode(out.error)).json(createErrorEnvelope(target, { error: out.error }));

    return res.status(201).json(createEnvelope(target, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      publicKey: out.record.publicKey,
      createdAt: out.record.createdAt,
      persistentClaim: out.persistentClaim,
    }));
  }

  const out = openNamespace({
    namespace,
    secret: String(body.secret || ""),
    identityHash: String(body.identityHash || "").trim(),
  });

  if (!out.ok) return res.status(openStatusCode(out.error)).json(createErrorEnvelope(target, { error: out.error }));

  const memories = getMemoriesForNamespace(out.record.namespace);
  const openedAt = Date.now();
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
    identity: parseNamespaceIdentity(out.record.namespace),
    policy: getDefaultReadPolicy(out.record.namespace),
    audit,
    namespace: out.record.namespace,
    identityHash: out.record.identityHash,
    noise: out.noise,
    memories,
    openedAt,
  }));
};

// POST / — universal write surface (write / claim / open by payload.operation)
export const rootCommandHandler: express.RequestHandler = async (req, res) => {
  const body = req.body;
  const target = normalizeHttpRequestToMeTarget(req);
  const rawTarget = String((body as any)?.target || (req.query as any)?.target || "").trim();
  const parsedTarget = rawTarget ? parseBridgeTarget(rawTarget) : null;
  const operation = normalizeOperation((body as any)?.operation || (body as any)?.op || parsedTarget?.selector);
  const resolvedNamespace = resolveCommandNamespace(
    operation,
    (body ?? {}) as Record<string, unknown>,
    parsedTarget,
    resolveNamespace(req),
  );
  const commandTarget =
    (operation === "claim" || operation === "open") && parsedTarget?.namespace === "kernel"
      ? buildKernelCommandTarget(req, operation, resolvedNamespace)
      : null;

  if (!body || typeof body !== "object") {
    return res.status(400).json(createErrorEnvelope(target, { error: "Expected JSON block in request body" }));
  }

  if (operation === "claim") {
    if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
      return res.status(400).json(createErrorEnvelope(commandTarget, {
        error: "FULL_NAMESPACE_REQUIRED",
        detail: "Public claims should use a full namespace such as username.cleaker.me.",
      }));
    }

    const out = await claimNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
      identityHash: String((body as any)?.identityHash || "").trim(),
      publicKey: String((body as any)?.publicKey || "").trim() || null,
      privateKey: String((body as any)?.privateKey || "").trim() || null,
      proof: ((body as any)?.proof && typeof (body as any).proof === "object") ? (body as any).proof : null,
    });

    const claimTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "claim", "");
    if (!out.ok) return res.status(claimStatusCode(out.error)).json(createErrorEnvelope(claimTarget, { error: out.error }));

    return res.status(201).json(createEnvelope(claimTarget, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      publicKey: out.record.publicKey,
      createdAt: out.record.createdAt,
      persistentClaim: out.persistentClaim,
    }));
  }

  if (operation === "open") {
    if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
      return res.status(400).json(createErrorEnvelope(commandTarget, {
        error: "FULL_NAMESPACE_REQUIRED",
        detail: "Public opens should use a full namespace such as username.cleaker.me.",
      }));
    }

    const out = openNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
      identityHash: String((body as any)?.identityHash || "").trim(),
    });

    const openTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "open", "");
    if (!out.ok) return res.status(openStatusCode(out.error)).json(createErrorEnvelope(openTarget, { error: out.error }));

    const memories = getMemoriesForNamespace(out.record.namespace);
    const openedAt = Date.now();
    const audit = {
      proofId: computeProofId({
        namespace: out.record.namespace,
        identityHash: out.record.identityHash,
        noise: out.noise,
        memories,
      }),
      openedAt,
    };

    return res.json(createEnvelope(openTarget, {
      verified: true,
      reasonCode: null,
      reason: null,
      identity: parseNamespaceIdentity(out.record.namespace),
      policy: getDefaultReadPolicy(out.record.namespace),
      audit,
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      noise: out.noise,
      memories,
      openedAt,
    }));
  }

  // write path
  const timestamp = Date.now();
  const namespace = resolvedNamespace;
  const claim = getClaim(namespace);

  if (claim) {
    const authorized = isNamespaceWriteAuthorized({
      claimIdentityHash: claim.identityHash,
      claimPublicKey: claim.publicKey,
      body,
    });
    if (!authorized) {
      return res.status(403).json(createErrorEnvelope(target, { error: "NAMESPACE_WRITE_FORBIDDEN" }));
    }
  }

  const blockIdentityHash = claim
    ? claim.identityHash
    : String((body as any).identityHash || "").trim();

  const entry = recordMemory({ namespace, payload: body, identityHash: blockIdentityHash, timestamp });
  if (!entry) {
    return res.status(400).json(createErrorEnvelope(target, { error: "INVALID_MEMORY_INPUT" }));
  }

  console.log("🧠 New Memory Event:");
  console.log(JSON.stringify(entry, null, 2));
  const writeTarget = buildNormalizedTarget(req, namespace, "write", "");
  return res.json(createEnvelope(writeTarget, {
    memoryHash: entry?.hash || null,
    prevMemoryHash: entry?.prevHash || null,
    namespace,
    path: entry?.path || String((body as any).expression || "").trim(),
    operator: entry?.operator ?? null,
    timestamp: entry?.timestamp || timestamp,
  }));
};
