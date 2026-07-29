import { api } from "../../api/client";

export interface WorkspaceSection {
  id: number;
  project: number;
  workspace: string;
  name: string;
  blurb: string;
  created_by: number | null;
  created_at: string;
}

export const listSections = (project: number) =>
  api.get<WorkspaceSection[]>("/workspace-sections/", { params: { project } }).then((r) => r.data);

export const createSection = (project: number, name: string, blurb: string) =>
  api.post<WorkspaceSection>("/workspace-sections/", { project, name, blurb }).then((r) => r.data);

export const deleteSection = (id: number) => api.delete(`/workspace-sections/${id}/`);
