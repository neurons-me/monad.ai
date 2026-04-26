import type express from "express";
import { getKernel } from "./manager.js";
import { resolveNamespace } from "../http/namespace.js";

export function getNamespaceBranch(req: express.Request) {
  const kernel = getKernel();
  const namespace = resolveNamespace(req);

  if (namespace === "localhost" || namespace === "127.0.0.1" || namespace === "unknown") {
    return kernel;
  }

  return (kernel as any)["@"](namespace);
}

export { resolveNamespace };
