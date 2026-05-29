import type express from "express";
import { getKernel, namespaceToKernelPrefix } from "./manager.js";
import { resolveNamespace } from "../http/namespace.js";

/**
 * Return the .me kernel branch for the namespace in the request.
 *
 * Invariant: `@` is ONLY used at boot to declare the monad's own identity expression.
 * It is NOT a navigation operator. Namespace routing uses the kernel path prefix
 * derived from the namespace (e.g., "haiku.cleaker.me" → "users.haiku").
 */
export function getNamespaceBranch(req: express.Request) {
  const kernel = getKernel();
  const namespace = resolveNamespace(req);

  // Local / unknown namespaces — operate at kernel root.
  if (!namespace || namespace === "localhost" || namespace === "127.0.0.1" || namespace === "unknown") {
    return kernel;
  }

  // Derive the kernel path prefix for this namespace.
  // "haiku.cleaker.me" when root is "cleaker.me" → prefix = "users.haiku"
  // Unknown domains → prefix = "" → kernel root.
  const prefix = namespaceToKernelPrefix(namespace);
  if (!prefix) return kernel;

  // Navigate the kernel proxy to the prefix path (e.g., kernel.users.haiku).
  return prefix.split(".").reduce((branch: any, key: string) => branch[key], kernel as any);
}

export { resolveNamespace };
