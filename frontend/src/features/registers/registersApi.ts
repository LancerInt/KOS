import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }

export type RegisterStatus = "open" | "in_progress" | "mitigated" | "closed" | "accepted";
export type ProbImpact = "very_high" | "high" | "medium" | "low" | "very_low";

export interface Risk {
  id: number; project: number; statement: string;
  probability: ProbImpact; impact: ProbImpact; score: number;
  mitigation: string; contingency: string;
  owner: number | null; owner_name: string; review_date: string | null;
  status: RegisterStatus; related_tasks: number[]; created_at: string;
}

export interface Issue {
  id: number; project: number; description: string;
  severity: "critical" | "high" | "medium" | "low";
  owner: number | null; owner_name: string; corrective_action: string;
  target_resolution_date: string | null; closure_evidence: string;
  status: RegisterStatus; related_tasks: number[]; created_at: string;
}

export interface Decision {
  id: number; project: number; decision_required: string; options_considered: string;
  decision_maker: number | null; decision_maker_name: string; decision: string;
  decided_on: string | null; rationale: string; supporting_document: string;
  status: RegisterStatus; related_tasks: number[]; created_at: string;
}

const list = <T>(path: string, projectId: number | string) =>
  api.get<Paginated<T>>(`/${path}/?project=${projectId}`).then((r) => r.data.results ?? (r.data as unknown as T[]));

export const listRisks = (p: number | string) => list<Risk>("risks", p);
export const listIssues = (p: number | string) => list<Issue>("issues", p);
export const listDecisions = (p: number | string) => list<Decision>("decisions", p);

export const createRisk = (payload: Partial<Risk>) => api.post<Risk>("/risks/", payload).then((r) => r.data);
export const createIssue = (payload: Partial<Issue>) => api.post<Issue>("/issues/", payload).then((r) => r.data);
export const createDecision = (payload: Partial<Decision>) => api.post<Decision>("/decisions/", payload).then((r) => r.data);

export const updateRisk = (id: number, payload: Partial<Risk>) => api.patch<Risk>(`/risks/${id}/`, payload).then((r) => r.data);
export const updateIssue = (id: number, payload: Partial<Issue>) => api.patch<Issue>(`/issues/${id}/`, payload).then((r) => r.data);
export const updateDecision = (id: number, payload: Partial<Decision>) => api.patch<Decision>(`/decisions/${id}/`, payload).then((r) => r.data);
