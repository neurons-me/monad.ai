import { createHash } from "crypto";

export function toStableJson(value: unknown): string {
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

export function computeProofId(input: Record<string, unknown>): string {
  return createHash("sha256").update(toStableJson(input)).digest("hex");
}
