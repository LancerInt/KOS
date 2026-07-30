import { api } from "../../api/client";
import type { Duration } from "./projectsApi";

export interface WorkspaceRecord {
  id: number;
  project: number;
  workspace: string;
  category: string;
  data: Record<string, string>;
  attachment: string | null;
  attachment_name: string;
  start_at: string | null;
  end_at: string | null;
  completed_at: string | null;
  duration: Duration;
  created_by: number | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export const listRecords = (project: number, category?: string) =>
  api
    .get<WorkspaceRecord[]>("/workspace-records/", { params: { project, category } })
    .then((r) => r.data);

export const createRecord = (
  project: number,
  category: string,
  data: Record<string, string>,
  file?: File | null,
  schedule?: { start_at?: string; end_at?: string },
) => {
  if (file) {
    const fd = new FormData();
    fd.append("project", String(project));
    fd.append("category", category);
    fd.append("data", JSON.stringify(data));
    fd.append("attachment", file);
    if (schedule?.start_at) fd.append("start_at", schedule.start_at);
    if (schedule?.end_at) fd.append("end_at", schedule.end_at);
    return api.post<WorkspaceRecord>("/workspace-records/", fd).then((r) => r.data);
  }
  return api
    .post<WorkspaceRecord>("/workspace-records/", { project, category, data, ...(schedule ?? {}) })
    .then((r) => r.data);
};

/** Toggle a record's completed state (closes / reopens its duration). */
export const completeRecord = (id: number) =>
  api.post<WorkspaceRecord>(`/workspace-records/${id}/complete/`).then((r) => r.data);

export const deleteRecord = (id: number) => api.delete(`/workspace-records/${id}/`);
