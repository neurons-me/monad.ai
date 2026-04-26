import ME from "this.me";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const ME_STATE_DIR = resolve(process.cwd(), "me-state");
const SNAPSHOT_PATH = resolve(ME_STATE_DIR, "snapshot.json");

let _kernel: InstanceType<typeof ME> | null = null;

export function getKernel(): InstanceType<typeof ME> {
  if (_kernel) return _kernel;

  const seed = process.env.ME_SEED;
  if (!seed) throw new Error("ME_SEED is required — set it in your environment before starting monad.ai");

  mkdirSync(ME_STATE_DIR, { recursive: true });

  _kernel = new ME(seed, {
    store: new ME.DiskStore({ baseDir: ME_STATE_DIR }),
  });

  if (existsSync(SNAPSHOT_PATH)) {
    try {
      const raw = readFileSync(SNAPSHOT_PATH, "utf8");
      _kernel.hydrate(JSON.parse(raw));
      console.log("[kernel] hydrated from snapshot");
    } catch (e) {
      console.warn("[kernel] snapshot hydration failed, starting fresh:", e);
    }
  }

  return _kernel;
}

export function saveSnapshot(): void {
  if (!_kernel) return;
  try {
    mkdirSync(ME_STATE_DIR, { recursive: true });
    const snapshot = _kernel.exportSnapshot();
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot), "utf8");
    console.log("[kernel] snapshot saved to", SNAPSHOT_PATH);
  } catch (e) {
    console.error("[kernel] snapshot save failed:", e);
  }
}

export function kernelReady(): boolean {
  return _kernel !== null;
}
