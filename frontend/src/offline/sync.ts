/** Flush the offline queue to the server's merge-safe sync endpoint (PRD §25). */
import { api } from "../api/client";
import { getQueue, removeOps } from "./queue";

interface SyncResult { op_id: string | null; ok: boolean; [key: string]: unknown; }

let syncing = false;

export async function flushQueue(): Promise<number> {
  if (syncing || !navigator.onLine) return 0;
  const ops = getQueue();
  if (ops.length === 0) return 0;

  syncing = true;
  try {
    const { data } = await api.post<{ results: SyncResult[] }>("/sync/", { ops });
    const applied = (data.results || [])
      .filter((r) => r.ok && r.op_id)
      .map((r) => r.op_id as string);
    if (applied.length) removeOps(applied);
    window.dispatchEvent(new Event("kos-synced"));
    return applied.length;
  } catch {
    return 0; // stay queued; try again on the next reconnect
  } finally {
    syncing = false;
  }
}
