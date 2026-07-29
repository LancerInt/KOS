import { api } from "../../api/client";

export interface WorkspaceRecord {
  id: number;
  project: number;
  workspace: string;
  category: string;
  data: Record<string, string>;
  attachment: string | null;
  attachment_name: string;
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
) => {
  if (file) {
    const fd = new FormData();
    fd.append("project", String(project));
    fd.append("category", category);
    fd.append("data", JSON.stringify(data));
    fd.append("attachment", file);
    return api.post<WorkspaceRecord>("/workspace-records/", fd).then((r) => r.data);
  }
  return api.post<WorkspaceRecord>("/workspace-records/", { project, category, data }).then((r) => r.data);
};

export const deleteRecord = (id: number) => api.delete(`/workspace-records/${id}/`);
