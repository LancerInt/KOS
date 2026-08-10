import { api } from "../../api/client";

export type DurationStatus = "none" | "active" | "ending_soon" | "due" | "completed";

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

export const deleteProject = (id: number) => api.delete(`/workspace-projects/${id}/`);
