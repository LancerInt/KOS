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
  start_date: string | null;
  duration_days: number | null;
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
  schedule?: { start_date?: string; duration_days?: number },
) => {
  if (file) {
    const fd = new FormData();
    fd.append("project", String(project));
    fd.append("category", category);
    fd.append("data", JSON.stringify(data));
    fd.append("attachment", file);
    if (schedule?.start_date) fd.append("start_date", schedule.start_date);
    if (schedule?.duration_days) fd.append("duration_days", String(schedule.duration_days));
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
