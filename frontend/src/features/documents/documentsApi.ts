import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export type DocStatus = "draft" | "pending_approval" | "approved" | "archived";
export type DocCategory =
  | "general" | "regulatory" | "contract" | "report" | "specification" | "license" | "other";

export interface DocVersion {
  id: number;
  version_number: number;
  original_filename: string;
  size_bytes: number;
  content_type: string;
  uploaded_by: number | null;
  uploaded_by_name: string;
  notes: string;
  created_at: string;
  is_current: boolean;
}

export interface KDocument {
  id: number;
  project: number | null;
  title: string;
  description: string;
  category: DocCategory;
  tags: string;
  status: DocStatus;
  status_display: string;
  owner: number | null;
  owner_name: string;
  version_number: number;
  approved_by: number | null;
  approved_by_name: string;
  approved_at: string | null;
  expiry_date: string | null;
  reminder_lead_days: number;
  expires_in_days: number | null;
  is_expired: boolean;
  versions: DocVersion[];
  created_at: string;
  updated_at: string;
}

export const listDocuments = (projectId: number | string) =>
  api.get<Paginated<KDocument>>(`/documents/?project=${projectId}`).then((r) => unwrap(r.data));

// Pass FormData straight through — axios detects it and sets the multipart
// Content-Type (with boundary) automatically.
export const createDocument = (form: FormData) =>
  api.post<KDocument>("/documents/", form).then((r) => r.data);

export const uploadVersion = (id: number, form: FormData) =>
  api.post<KDocument>(`/documents/${id}/upload_version/`, form).then((r) => r.data);

export const rollbackDocument = (id: number, version: number) =>
  api.post<KDocument>(`/documents/${id}/rollback/`, { version }).then((r) => r.data);

export const updateDocument = (id: number, payload: Partial<KDocument>) =>
  api.patch<KDocument>(`/documents/${id}/`, payload).then((r) => r.data);

export const submitDocument = (id: number) =>
  api.post<KDocument>(`/documents/${id}/submit/`, {}).then((r) => r.data);

export const decideDocument = (id: number, decision: "approve" | "reject" | "request_changes", reason = "") =>
  api.post<KDocument>(`/documents/${id}/decide/`, { decision, reason }).then((r) => r.data);

export async function downloadVersion(versionId: number, filename: string) {
  const res = await api.get(`/documents/versions/${versionId}/download/`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
