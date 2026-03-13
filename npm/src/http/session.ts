import express from "express";
import crypto from "crypto";
import {
  type CleakerSession,
  type CreateCloudSessionRequest,
  type RevokeHostRequest,
  type SessionNonceRequest,
  type VerifyHostSessionRequest,
} from "../claim/handshake.types";
import {
  appendSemanticMemory,
  consumeSessionNonce,
  createSessionNonce,
  getHostStatus,
  listHostMemoryHistory,
  listHostsByUsername,
  rebuildAuthorizedHostsProjection,
} from "../claim/memoryStore";
import { normalizeHttpRequestToMeTarget } from "./meTarget";
import { createEnvelope, createErrorEnvelope } from "./envelope";

function normalizeUsername(input: string): string {
  return String(input || "").trim().toLowerCase();
}

function computeSessionExpiry(iatMs: number, ttlSeconds?: number): number {
  const ttl = Number.isFinite(ttlSeconds) ? Number(ttlSeconds) : 3600;
  const boundedTtl = Math.max(60, Math.min(60 * 60 * 24 * 30, ttl));
  return iatMs + boundedTtl * 1000;
}

function signSessionToken(session: CleakerSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const secret = process.env.SESSION_SIGNING_SECRET || "monad-dev-secret";
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyDaemonAttestation(
  username: string,
  nonce: string,
  hostFingerprint: string,
  daemonPublicKey: string,
  attestation: string,
): boolean {
  const verifier = crypto.createVerify("SHA256");
  const message = `${username}:${nonce}:${hostFingerprint}`;
  verifier.update(message);
  verifier.end();

  try {
    const sig = Buffer.from(String(attestation || "").trim(), "base64");
    return verifier.verify(String(daemonPublicKey || "").trim(), sig);
  } catch {
    return false;
  }
}

function makeCloudSession(body: CreateCloudSessionRequest): CleakerSession {
  const iat = Date.now();
  const exp = computeSessionExpiry(iat, body.ttlSeconds);
  return {
    username: normalizeUsername(body.username),
    mode: "cloud",
    iat,
    exp,
    capabilities: Array.isArray(body.capabilities) && body.capabilities.length > 0
      ? body.capabilities
      : ["profile:read", "me:public"],
  };
}

export function createSessionRouter() {
  const router = express.Router();
  // Ensure read-model projection can recover after daemon/server restarts.
  rebuildAuthorizedHostsProjection();

  router.post("/api/v1/session/nonce", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = (req.body || {}) as SessionNonceRequest;
    const username = normalizeUsername(body.username);

    if (!username) {
      return res.status(400).json(createErrorEnvelope(target, { error: "USERNAME_REQUIRED" }));
    }

    const response = createSessionNonce(username, 2 * 60 * 1000);
    return res.json(createEnvelope(target, { ...response }));
  });

  router.post("/api/v1/session/cloud", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = (req.body || {}) as CreateCloudSessionRequest;
    const username = normalizeUsername(body.username);

    if (!username) {
      return res.status(400).json(createErrorEnvelope(target, { error: "USERNAME_REQUIRED" }));
    }

    const session = makeCloudSession({ ...body, username });
    const namespace = `${username}.cleaker.me`;
    appendSemanticMemory({
      namespace,
      path: `${namespace}/session/mode`,
      operator: "=",
      data: "cloud",
      timestamp: session.iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/session/last_seen`,
      operator: "=",
      data: session.iat,
      timestamp: session.iat,
    });

    const token = signSessionToken(session);
    return res.json(createEnvelope(target, { session, token }));
  });

  router.post("/api/v1/session/host-verify", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = (req.body || {}) as VerifyHostSessionRequest;
    const username = normalizeUsername(body.username);
    const nonce = String(body.nonce || "").trim();
    const hostFingerprint = String(body.host?.fingerprint || "").trim();
    const daemonPublicKey = String(body.host?.daemonPublicKey || "").trim();
    const attestation = String(body.host?.attestation || "").trim();
    const localEndpoint = String(body.host?.local_endpoint || "").trim() || "localhost:8161";

    if (!username || !nonce || !hostFingerprint || !daemonPublicKey || !attestation) {
      return res.status(400).json(createErrorEnvelope(target, { error: "INVALID_HOST_VERIFY_PAYLOAD" }));
    }

    if (!consumeSessionNonce(username, nonce)) {
      return res.status(403).json(createErrorEnvelope(target, { error: "NONCE_INVALID_OR_EXPIRED" }));
    }

    const verified = verifyDaemonAttestation(
      username,
      nonce,
      hostFingerprint,
      daemonPublicKey,
      attestation,
    );
    if (!verified) {
      return res.status(403).json(createErrorEnvelope(target, { error: "ATTESTATION_INVALID" }));
    }

    if (getHostStatus(username, hostFingerprint) === "revoked") {
      return res.status(403).json(createErrorEnvelope(target, { error: "HOST_REVOKED" }));
    }

    const iat = Date.now();
    const exp = computeSessionExpiry(iat, body.ttlSeconds);
    const capabilities = Array.isArray(body.host?.capabilities) && body.host.capabilities.length > 0
      ? body.host.capabilities
      : ["profile:read", "me:public", "sync", "sign", "local_fs"];

    const session: CleakerSession = {
      username,
      mode: "host",
      iat,
      exp,
      capabilities,
      host: {
        fingerprint: hostFingerprint,
        local_endpoint: localEndpoint,
        attestation,
      },
    };

    const namespace = `${username}.cleaker.me`;
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/status`,
      operator: "=",
      data: "authorized",
      timestamp: iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/capabilities`,
      operator: "=",
      data: capabilities,
      timestamp: iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/last_seen`,
      operator: "=",
      data: iat,
      timestamp: iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/local_endpoint`,
      operator: "=",
      data: localEndpoint,
      timestamp: iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/public_key`,
      operator: "=",
      data: daemonPublicKey,
      timestamp: iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/attestation`,
      operator: "=",
      data: attestation,
      timestamp: iat,
      signature: attestation,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/session/mode`,
      operator: "=",
      data: "host",
      timestamp: iat,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/session/last_seen`,
      operator: "=",
      data: iat,
      timestamp: iat,
    });

    const token = signSessionToken(session);
    return res.json(createEnvelope(target, { session, token }));
  });

  router.get("/api/v1/hosts/:username", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const username = normalizeUsername(String(req.params.username || ""));
    if (!username) {
      return res.status(400).json(createErrorEnvelope(target, { error: "USERNAME_REQUIRED" }));
    }

    const hosts = listHostsByUsername(username).map((host) => ({
      id: host.id,
      username: host.username,
      fingerprint: host.fingerprint,
      public_key: host.public_key,
      label: host.label,
      local_endpoint: host.local_endpoint,
      capabilities: (() => {
        try {
          const parsed = JSON.parse(host.capabilities_json || "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
      status: host.status,
      created_at: host.created_at,
      last_used: host.last_used,
      revoked_at: host.revoked_at,
    }));

    return res.json(createEnvelope(target, {
      username,
      hosts,
      count: hosts.length,
    }));
  });

  router.get("/api/v1/hosts/:username/:fingerprint/history", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const username = normalizeUsername(String(req.params.username || ""));
    const fingerprint = String(req.params.fingerprint || "").trim();
    const limit = Number(req.query?.limit || 200);

    if (!username || !fingerprint) {
      return res.status(400).json(createErrorEnvelope(target, { error: "INVALID_HISTORY_PAYLOAD" }));
    }

    const memories = listHostMemoryHistory(username, fingerprint, limit).map((m) => ({
      id: m.id,
      namespace: m.namespace,
      username: m.username,
      fingerprint: m.fingerprint,
      path: m.path,
      operator: m.operator,
      data: m.data,
      hash: m.hash,
      prevHash: m.prevHash,
      signature: m.signature,
      timestamp: m.timestamp,
    }));

    return res.json(createEnvelope(target, {
      username,
      fingerprint,
      memories,
      count: memories.length,
    }));
  });

  router.post("/api/v1/hosts/revoke", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = (req.body || {}) as RevokeHostRequest;
    const username = normalizeUsername(body.username);
    const hostFingerprint = String(body.hostFingerprint || "").trim();

    if (!username || !hostFingerprint) {
      return res.status(400).json(createErrorEnvelope(target, { error: "INVALID_REVOKE_PAYLOAD" }));
    }

    const now = Date.now();
    const namespace = `${username}.cleaker.me`;
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/status`,
      operator: "=",
      data: "revoked",
      timestamp: now,
    });
    appendSemanticMemory({
      namespace,
      path: `${namespace}/hosts/${hostFingerprint}/last_seen`,
      operator: "=",
      data: now,
      timestamp: now,
    });

    return res.json(createEnvelope(target, {
      revoked: true,
      username,
      hostFingerprint,
      timestamp: now,
    }));
  });

  return router;
}
