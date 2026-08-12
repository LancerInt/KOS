import { api } from "../../api/client";

export type Cadence = "monthly" | "quarterly" | "annual";
export type DeadlineStatus = "pending" | "filed";

/** A dated statutory filing (e.g. GSTR-1 for "Aug 2026") in a workspace. */
export interface ComplianceDeadline {
  id: number;
  obligation: number;
  obligation_name: string;
  workspace: string;
  cadence: Cadence;
  period_label: string;      // the tax period, e.g. "Aug 2026"
  due_date: string;          // YYYY-MM-DD
  status: DeadlineStatus;
  filed_at: string | null;
  filed_by_name: string;
  lead_days: number;         // remind this many days ahead
  days_left: number;         // negative = overdue
}

export const listComplianceDeadlines = (workspace: string) =>
  api.get<ComplianceDeadline[]>("/compliance-deadlines/", { params: { workspace } }).then((r) => r.data);

export const fileDeadline = (id: number) =>
  api.post<ComplianceDeadline>(`/compliance-deadlines/${id}/file/`).then((r) => r.data);

export const unfileDeadline = (id: number) =>
  api.post<ComplianceDeadline>(`/compliance-deadlines/${id}/unfile/`).then((r) => r.data);

/** Shift a due date — used when the government extends a filing. */
export const updateDeadlineDueDate = (id: number, due_date: string) =>
  api.patch<ComplianceDeadline>(`/compliance-deadlines/${id}/`, { due_date }).then((r) => r.data);
