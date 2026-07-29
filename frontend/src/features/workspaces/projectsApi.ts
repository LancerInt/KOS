import { api } from "../../api/client";

export interface WorkspaceProject {
  id: number;
  workspace: string;
  name: string;
  created_by: number | null;
  created_by_name: string;
  created_at: string;
  section_count: number;
  record_count: number;
}

export const listProjects = (workspace: string) =>
  api.get<WorkspaceProject[]>("/workspace-projects/", { params: { workspace } }).then((r) => r.data);

export const getProject = (id: number) =>
  api.get<WorkspaceProject>(`/workspace-projects/${id}/`).then((r) => r.data);

export const createProject = (workspace: string, name: string) =>
  api.post<WorkspaceProject>("/workspace-projects/", { workspace, name }).then((r) => r.data);

export const deleteProject = (id: number) => api.delete(`/workspace-projects/${id}/`);
