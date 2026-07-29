import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }

export type ApprovalKind = "deliverable" | "deadline_change" | "deletion";
export type ApprovalStatus = "pending" | "approved" | "changes_requested" | "rejected";

export interface ApprovalRequest {
  id: number;
  kind: ApprovalKind;
  status: ApprovalStatus;
  task: number | null;
  project: number | null;
  target_label: string;
  requested_by: number | null;
  requested_by_name: string;
  approver: number | null;
  approver_name: string;
  acted_at: string | null;
  decision_reason: string;
  payload: Record<string, unknown>;
  target_project: number | null;
  created_at: string;
}

export async function listTaskApprovals(taskId: number): Promise<ApprovalRequest[]> {
  const { data } = await api.get<Paginated<ApprovalRequest>>(`/approvals/?task=${taskId}`);
  return data.results ?? (data as unknown as ApprovalRequest[]);
}

export async function listPendingApprovals(): Promise<ApprovalRequest[]> {
  const { data } = await api.get<Paginated<ApprovalRequest>>("/approvals/?status=pending");
  return data.results ?? (data as unknown as ApprovalRequest[]);
}

export async function createApproval(payload: {
  kind: ApprovalKind; task?: number; project?: number; payload?: Record<string, unknown>;
}): Promise<ApprovalRequest> {
  const { data } = await api.post<ApprovalRequest>("/approvals/", payload);
  return data;
}

export async function decideApproval(id: number, decision: "approve" | "reject" | "request_changes", reason = ""): Promise<ApprovalRequest> {
  const { data } = await api.post<ApprovalRequest>(`/approvals/${id}/decide/`, { decision, reason });
  return data;
}
