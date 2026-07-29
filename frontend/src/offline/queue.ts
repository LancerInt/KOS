/**
 * A durable, localStorage-backed queue of merge-safe mutations made while
 * offline (PRD §25). Each op carries a client-generated `op_id` so the server
 * can dedupe on replay. Kept intentionally small — only additive/field-level
 * actions are ever queued (comments, checklist ticks).
 */

export type QueuedKind = "add_comment" | "set_checklist";

export interface QueuedOp {
  op_id: string;
  kind: QueuedKind;
  createdAt: number;
  [key: string]: unknown;
}

const KEY = "kos_offline_queue";

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function read(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(queue: QueuedOp[]): void {
  localStorage.setItem(KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event("kos-queue-changed"));
}

export const getQueue = read;
export const queueSize = (): number => read().length;

export function enqueue(op: { kind: QueuedKind } & Record<string, unknown>): QueuedOp {
  const full: QueuedOp = { op_id: uuid(), createdAt: Date.now(), ...op };
  const queue = read();
  queue.push(full);
  write(queue);
  return full;
}

export function removeOps(ids: string[]): void {
  const drop = new Set(ids);
  write(read().filter((op) => !drop.has(op.op_id)));
}
