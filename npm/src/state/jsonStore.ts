import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getKernelStatePath } from "../kernel/manager.js";

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function readJsonState<T>(filename: string, fallback: T): T {
  const filePath = getKernelStatePath(filename);
  if (!existsSync(filePath)) return fallback;

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonState<T>(filename: string, value: T): void {
  const filePath = getKernelStatePath(filename);
  const tempPath = `${filePath}.tmp`;
  ensureParentDir(filePath);
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tempPath, filePath);
}
