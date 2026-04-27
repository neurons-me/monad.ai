import { readJsonState, writeJsonState } from "../state/jsonStore.js";

export type LedgerBlockRow = {
  blockId: string;
  timestamp: number;
  namespace: string;
  identityHash: string;
  expression: string;
  json: unknown;
};

const BLOCKS_STATE_FILE = "ledger-blocks.json";

function readBlocks(): LedgerBlockRow[] {
  const rows = readJsonState<LedgerBlockRow[]>(BLOCKS_STATE_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

function writeBlocks(rows: LedgerBlockRow[]): void {
  writeJsonState(BLOCKS_STATE_FILE, rows);
}

export function appendBlock(block: Partial<LedgerBlockRow>) {
  const row: LedgerBlockRow = {
    blockId: String(block.blockId || "").trim(),
    timestamp: Number(block.timestamp || Date.now()),
    namespace: String(block.namespace || "").trim().toLowerCase(),
    identityHash: String(block.identityHash || "").trim(),
    expression: String(block.expression || "").trim(),
    json: block.json ?? block,
  };

  const rows = readBlocks();
  rows.push(row);
  writeBlocks(rows);
  return { ok: true, blockId: row.blockId };
}

export function getAllBlocks(): LedgerBlockRow[] {
  return readBlocks();
}

export function getBlocksForIdentity(identityHash: string): LedgerBlockRow[] {
  const target = String(identityHash || "").trim();
  if (!target) return [];
  return readBlocks().filter((row) => row.identityHash === target);
}

export function getBlocksForNamespace(namespace: string): LedgerBlockRow[] {
  const target = String(namespace || "").trim().toLowerCase();
  if (!target) return [];
  return readBlocks().filter((row) => row.namespace === target);
}
