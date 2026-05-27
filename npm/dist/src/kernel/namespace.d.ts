import type express from "express";
import { resolveNamespace } from "../http/namespace.js";
/**
 * Return the .me kernel branch for the namespace in the request.
 *
 * Invariant: `@` is ONLY used at boot to declare the monad's own identity expression.
 * It is NOT a navigation operator. Namespace routing uses the kernel path prefix
 * derived from the namespace (e.g., "haiku.cleaker.me" → "users.haiku").
 */
export declare function getNamespaceBranch(req: express.Request): any;
export { resolveNamespace };
