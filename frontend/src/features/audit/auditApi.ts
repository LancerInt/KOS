import { api } from "../../api/client";

interface Page<T> { count: number; next: string | null; previous: string | null; results: T[]; }
interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export interface AuditEntry {
  id: number;
  actor: number | null;
  actor_name: string;
  action: string;
  action_display: string;
  object_type: string;
  object_id: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  source_ip: string | null;
  created_at: string;
}

export interface RetentionPolicy {
  id: number;
  record_type: string;
  label: string;
  retention_days: number | null;
  is_exempt: boolean;
  description: string;
  updated_at: string;
}

export interface PurgePreview {
  record_type: string;
  label: string;
  retention_days: number | null;
  exempt: boolean;
  eligible: number;
}

export interface AuditFilters {
  action?: string;
  object_type?: string;
  object_id?: string;
  after?: string;
  before?: string;
  search?: string;
  page?: number;
}

export const listAudit = (params: AuditFilters) =>
  api.get<Page<AuditEntry>>("/audit/logs/", { params }).then((r) => r.data);

export const listAuditActions = () =>
  api.get<{ value: string; label: string }[]>("/audit/logs/actions/").then((r) => r.data);

export const objectHistory = (type: string, id: string | number) =>
  api.get<AuditEntry[]>("/audit/history/", { params: { type, id } }).then((r) => r.data);

export const listRetention = () =>
  api.get<Paginated<RetentionPolicy>>("/audit/retention/").then((r) => unwrap(r.data));

export const updateRetention = (id: number, payload: Partial<RetentionPolicy>) =>
  api.patch<RetentionPolicy>(`/audit/retention/${id}/`, payload).then((r) => r.data);

export const previewPurge = () =>
  api.get<PurgePreview[]>("/audit/retention/preview/").then((r) => r.data);

export const runPurge = () =>
  api.post<Record<string, number>>("/audit/retention/purge/", {}).then((r) => r.data);

export async function exportAudit(filters: AuditFilters) {
  const res = await api.get("/audit/export/", { params: filters, responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kos_audit_log.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
