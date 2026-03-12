import express from "express";
import crypto from "crypto";
import { claimNamespace, openNamespace } from "../claim/records";
import { getMemoriesForNamespace } from "../claim/replay";
import { normalizeHttpRequestToMeTarget } from "./meTarget";
import { createEnvelope, createErrorEnvelope } from "./envelope";

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
  const ns = String(namespace || "").trim().toLowerCase();
  if (!ns) {
    return {
      host: "unknown",
      username: "",
      effective: "unclaimed",
    };
  }

  const userMatch = ns.match(/^([^\/]+)\/users\/([^\/]+)$/i);
  if (userMatch) {
    const host = String(userMatch[1] || "").trim();
    const username = String(userMatch[2] || "").trim();
    return {
      host,
      username,
      effective: `@${username}.${host}`,
    };
  }

  return {
    host: ns,
    username: "",
    effective: `@${ns}`,
  };
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

export function createClaimsRouter() {
  const router = express.Router();

  router.post("/claims", (req: express.Request, res: express.Response) => {
    const target = normalizeHttpRequestToMeTarget(req);
    const body = req.body ?? {};
    const out = claimNamespace({
      namespace: String(body.namespace || ""),
      secret: String(body.secret || ""),
      publicKey: String(body.publicKey || "").trim() || null,
    });

    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN"
          ? 409
          : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
            ? 400
            : 500;
      return res.status(status).json(createErrorEnvelope(target, { error: out.error }));
    }

    return res.status(201).json(createEnvelope(target, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      createdAt: out.record.createdAt,
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
