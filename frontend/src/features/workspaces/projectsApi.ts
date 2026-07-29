import { api } from "../../api/client";

export type DurationStatus = "none" | "active" | "ending_soon" | "due" | "completed";

export interface Duration {
  status: DurationStatus;
  end_date?: string;
  days_total?: number;
  days_elapsed?: number;
  days_left?: number;
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
  start_date: string | null;
  duration_days: number | null;
  completed_at: string | null;
  duration: Duration;
}

export const listProjects = (workspace: string) =>
  api.get<WorkspaceProject[]>("/workspace-projects/", { params: { workspace } }).then((r) => r.data);

export const getProject = (id: number) =>
  api.get<WorkspaceProject>(`/workspace-projects/${id}/`).then((r) => r.data);

export const createProject = (
  workspace: string,
  name: string,
  extra?: { start_date?: string; duration_days?: number },
) => api.post<WorkspaceProject>("/workspace-projects/", { workspace, name, ...(extra ?? {}) }).then((r) => r.data);

export const updateProject = (
  id: number,
  patch: { start_date?: string | null; duration_days?: number | null },
) => api.patch<WorkspaceProject>(`/workspace-projects/${id}/`, patch).then((r) => r.data);

/** Toggle completed state (closes / reopens the duration loop). */
export const completeProject = (id: number) =>
  api.post<WorkspaceProject>(`/workspace-projects/${id}/complete/`).then((r) => r.data);

export const deleteProject = (id: number) => api.delete(`/workspace-projects/${id}/`);
