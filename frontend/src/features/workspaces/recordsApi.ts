import { api } from "../../api/client";
import type { Duration } from "./projectsApi";

export interface RecordAttachment {
  id: number;
  file: string;
  name: string;
}

export interface WorkspaceRecord {
  id: number;
  project: number;
  workspace: string;
  /** The section this record belongs to. Null for records written against a
   *  built-in section that has no row yet — those still resolve by `category`. */
  section: number | null;
  /** Denormalised mirror of the section's name. Kept for search and display;
   *  `section` is the real link, since nested sections may share a name. */
  category: string;
  data: Record<string, string>;
  attachment: string | null;
  attachment_name: string;
  attachments: RecordAttachment[];
  start_at: string | null;
  end_at: string | null;
  completed_at: string | null;
  duration: Duration;
  created_by: number | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export const listRecords = (project: number, opts?: { category?: string; section?: number }) =>
  api
    .get<WorkspaceRecord[]>("/workspace-records/", { params: { project, ...(opts ?? {}) } })
    .then((r) => r.data);

/** Where a new record goes. `section` is the real link; `category` rides along
 *  as the name mirror, and is the only thing an unadopted built-in can offer. */
export interface RecordTarget {
  section: number | null;
  category: string;
}

export const createRecord = (
  project: number,
  target: RecordTarget,
  data: Record<string, string>,
  files?: File[] | null,
  schedule?: { start_at?: string; end_at?: string },
) => {
  if (files && files.length) {
    const fd = new FormData();
    fd.append("project", String(project));
    if (target.section != null) fd.append("section", String(target.section));
    fd.append("category", target.category);
    fd.append("data", JSON.stringify(data));
    files.forEach((f) => fd.append("attachments", f));
    if (schedule?.start_at) fd.append("start_at", schedule.start_at);
    if (schedule?.end_at) fd.append("end_at", schedule.end_at);
    return api.post<WorkspaceRecord>("/workspace-records/", fd).then((r) => r.data);
  }
  return api
    .post<WorkspaceRecord>("/workspace-records/", {
      project, section: target.section, category: target.category, data, ...(schedule ?? {}),
    })
    .then((r) => r.data);
};

/** Toggle a record's completed state (closes / reopens its duration). */
export const completeRecord = (id: number) =>
  api.post<WorkspaceRecord>(`/workspace-records/${id}/complete/`).then((r) => r.data);

export const deleteRecord = (id: number) => api.delete(`/workspace-records/${id}/`);
