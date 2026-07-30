import { api } from "../../api/client";
import type { FieldDef } from "./fields";

export interface WorkspaceSection {
  id: number;
  project: number;
  workspace: string;
  name: string;
  blurb: string;
  fields: FieldDef[];
  hidden: boolean;
  created_by: number | null;
  created_at: string;
}

export const listSections = (project: number) =>
  api.get<WorkspaceSection[]>("/workspace-sections/", { params: { project } }).then((r) => r.data);

export const createSection = (
  project: number, name: string, blurb: string, fields: FieldDef[] = [], hidden = false,
) => api.post<WorkspaceSection>("/workspace-sections/", { project, name, blurb, fields, hidden }).then((r) => r.data);

/** Patch a section — persist its field schema, name/blurb, or hidden flag. */
export const updateSection = (
  id: number,
  patch: { name?: string; blurb?: string; fields?: FieldDef[]; hidden?: boolean },
) => api.patch<WorkspaceSection>(`/workspace-sections/${id}/`, patch).then((r) => r.data);

export const deleteSection = (id: number) => api.delete(`/workspace-sections/${id}/`);
