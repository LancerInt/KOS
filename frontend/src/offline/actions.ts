/**
 * Offline-aware wrappers for the two merge-safe task actions (PRD §25,
 * recommended change #5). Online, they call the normal API. If the request
 * fails with a network error (offline), the action is queued and replayed on
 * reconnect, and the caller is told it was `queued` so it can show it
 * optimistically.
 */
import { addComment, toggleChecklistItem } from "../features/tasks/tasksApi";
import { enqueue } from "./queue";

// No `response` on an axios error means it never reached the server.
const isNetworkError = (e: unknown): boolean =>
  !!e && typeof e === "object" && !(e as { response?: unknown }).response;

export interface OfflineResult { queued: boolean; }

export async function addCommentSafe(taskId: number, body: string): Promise<OfflineResult> {
  if (navigator.onLine) {
    try {
      await addComment(taskId, body);
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  enqueue({ kind: "add_comment", task: taskId, body });
  return { queued: true };
}

export async function toggleChecklistSafe(itemId: number, isDone: boolean): Promise<OfflineResult> {
  if (navigator.onLine) {
    try {
      await toggleChecklistItem(itemId, isDone);
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  enqueue({ kind: "set_checklist", item: itemId, is_done: isDone });
  return { queued: true };
}
