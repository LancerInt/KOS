import { api } from "../../api/client";

export type DurationStatus = "none" | "active" | "ending_soon" | "due" | "completed";

/** A post-completion workflow flag, separate from the timed duration status. */
export type ReviewState = "" | "blocked" | "needs_decision";

export interface Duration {
  status: DurationStatus;
  start_at?: string;      // precise start datetime (ISO)
  end_date?: string;      // local date (back-compat)
  end_at?: string;        // precise end datetime (ISO)
  end_label?: string;     // "30 Aug, 15:00"
  days_total?: number;
  days_elapsed?: number;
  days_left?: number;
  hours_left?: number;
  pct?: number;           // elapsed %
  left_label?: string;    // "2d 5h", "5h", "45m", "Ended"
}

export interface WorkspaceProject {
  id: number;
  workspace: string;
  name: string;
  created_by: number | null;
  created_by_name: string;
  created_at: string;
  section_count: number;
  record_count: number;
  /** Size of the project's roster. 0 = open to everyone with workspace access;
   *  anything else means only those people (and supervisors) can open it. */
  member_count: number;
  start_at: string | null;
  end_at: string | null;
  completed_at: string | null;
  duration: Duration;
  /** Approval workflow: "" (normal) · "needs_decision" (awaiting approval) ·
   *  "blocked" (sent back). Moves only through submit / approve / reject. */
  review_state: ReviewState;
  review_reason: string;          // why it was sent back
  submitted_at: string | null;
  submitted_by_name: string;
  reviewed_at: string | null;
  reviewed_by_name: string;
}

export const listProjects = (workspace: string) =>
  api.get<WorkspaceProject[]>("/workspace-projects/", { params: { workspace } }).then((r) => r.data);

/** Every project the current user may view, across all workspaces (access-scoped
 *  server-side). Backs the My Work / Dashboard overviews. */
export const listAllProjects = () =>
  api.get<WorkspaceProject[]>("/workspace-projects/").then((r) => r.data);

export const getProject = (id: number) =>
  api.get<WorkspaceProject>(`/workspace-projects/${id}/`).then((r) => r.data);

export const createProject = (
  workspace: string,
  name: string,
  extra?: { start_at?: string; end_at?: string },
) => api.post<WorkspaceProject>("/workspace-projects/", { workspace, name, ...(extra ?? {}) }).then((r) => r.data);

export const updateProject = (
  id: number,
  patch: { name?: string; start_at?: string | null; end_at?: string | null },
) => api.patch<WorkspaceProject>(`/workspace-projects/${id}/`, patch).then((r) => r.data);

/** Toggle completed state (closes / reopens the duration loop). */
export const completeProject = (id: number) =>
  api.post<WorkspaceProject>(`/workspace-projects/${id}/complete/`).then((r) => r.data);

/** Owner/editor submits a project for approval (notifies IT/Management). */
export const submitProject = (id: number) =>
  api.post<WorkspaceProject>(`/workspace-projects/${id}/submit/`).then((r) => r.data);

/** Approver signs off → the project is completed (notifies the owner). */
export const approveProject = (id: number) =>
  api.post<WorkspaceProject>(`/workspace-projects/${id}/approve/`).then((r) => r.data);

/** Approver sends the project back with a reason (notifies the owner). */
export const rejectProject = (id: number, reason: string) =>
  api.post<WorkspaceProject>(`/workspace-projects/${id}/reject/`, { reason }).then((r) => r.data);

export const deleteProject = (id: number) => api.delete(`/workspace-projects/${id}/`);

/** One entry in a project's approval lifecycle (drawn from the audit trail). */
export interface HistoryEvent {
  kind: "created" | "submitted" | "approved" | "rejected" | "completed" | "reopened";
  reason: string;   // only set for "rejected" (why it was sent back)
  actor: string;    // who did it ("System" when automated)
  at: string;       // ISO timestamp
}

/** The project's submit → send-back → resubmit → approve trail, oldest first. */
export const projectHistory = (id: number) =>
  api.get<HistoryEvent[]>(`/workspace-projects/${id}/history/`).then((r) => r.data);

/** Download the dashboard's projects as a formatted Excel workbook
 *  (administrators only, enforced server-side).
 *
 *  Fetched rather than linked: the endpoint needs the bearer token, and a plain
 *  anchor href carries no Authorization header — it would arrive as a 401 that
 *  the browser renders as a broken download. */
export async function downloadProjectsXlsx(): Promise<void> {
  const { data, headers } = await api.get<Blob>("/workspace-projects/export.xlsx", {
    responseType: "blob",
  });
  const match = /filename="([^"]+)"/.exec(String(headers["content-disposition"] ?? ""));
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? "kos-projects.xlsx";
  a.click();
  // Revoked on the next tick: Chrome cancels an in-flight download if the blob
  // URL is released synchronously after the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
