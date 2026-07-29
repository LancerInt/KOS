import { api } from "../../api/client";

export interface CatCounts {
  not_started: number; active: number; waiting: number;
  in_review: number; done: number; cancelled: number;
}

export interface DashboardMe {
  assigned_total: number;
  by_category: CatCounts;
  overdue: number;
  due_soon: number;
}

export interface Escalation {
  id: number; title: string; recipient: string;
  project: string | null; task: number | null;
  hours_open: number; created_at: string;
}

export interface AtRiskProject {
  id: number; code: string; name: string; health: string; status: string;
  overdue_tasks: number; open_risks: number;
}

export interface Management {
  projects_total: number;
  by_health: Record<string, number>;
  by_status: Record<string, number>;
  tasks_open: number;
  tasks_overdue: number;
  open_blockers: number;
  high_risks: number;
  pending_approvals: number;
  documents_expiring: number;
  sops_review_due: number;
  at_risk_projects: AtRiskProject[];
  escalations: Escalation[];
}

export interface Dashboard {
  me: DashboardMe;
  can_view_reports: boolean;
  management?: Management;
}

export interface ProjectReportRow {
  id: number; code: string; name: string; project_type: string;
  status: string; health: string; progress: number; owner_name: string;
  members: number; tasks_total: number; tasks_open: number; tasks_done: number;
  tasks_overdue: number; by_category: CatCounts; open_risks: number; open_issues: number;
}

export interface SearchResults {
  projects: { id: number; code: string; name: string; project_type: string; status: string; health: string }[];
  tasks: { id: number; title: string; project: number; project_code: string; status: string; category: string; due_date: string | null; is_overdue: boolean }[];
  documents: { id: number; title: string; project: number | null; category: string; status: string }[];
  sops: { id: number; code: string; title: string; stage: string }[];
  registers: { type: string; id: number; label: string; project: number; status: string }[];
}

export interface SearchResponse {
  query: string;
  results: Partial<SearchResults>;
  total: number;
}

export const getDashboard = () => api.get<Dashboard>("/dashboard/").then((r) => r.data);

export const getProjectReport = () =>
  api.get<{ rows: ProjectReportRow[] }>("/reports/projects/").then((r) => r.data.rows);

export const globalSearch = (q: string) =>
  api.get<SearchResponse>(`/search/?q=${encodeURIComponent(q)}`).then((r) => r.data);

async function downloadCsv(path: string, filename: string) {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const exportProjectsCsv = () =>
  downloadCsv("/reports/projects/export/", "kos_projects_report.csv");

export const exportTasksCsv = (projectId?: number) =>
  downloadCsv(`/reports/tasks/export/${projectId ? `?project=${projectId}` : ""}`, "kos_tasks_report.csv");
