import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export type SOPStage = "research" | "draft" | "review" | "approved" | "published" | "retired";

export interface SOPVersion {
  id: number;
  version_number: number;
  content: string;
  change_summary: string;
  published_by_name: string;
  created_at: string;
}

export interface SOP {
  id: number;
  code: string;
  title: string;
  department: number | null;
  department_name: string;
  owner: number | null;
  owner_name: string;
  stage: SOPStage;
  stage_display: string;
  purpose: string;
  scope: string;
  content: string;
  version_number: number;
  approved_by: number | null;
  approved_by_name: string;
  approved_at: string | null;
  published_at: string | null;
  effective_date: string | null;
  review_interval_months: number;
  next_review_date: string | null;
  review_overdue: boolean;
  next_stages: SOPStage[];
  versions: SOPVersion[];
  created_at: string;
}

export const listSOPs = () => api.get<Paginated<SOP>>("/sops/").then((r) => unwrap(r.data));

export const getSOP = (id: number) => api.get<SOP>(`/sops/${id}/`).then((r) => r.data);

export const createSOP = (payload: Partial<SOP>) =>
  api.post<SOP>("/sops/", payload).then((r) => r.data);

export const updateSOP = (id: number, payload: Partial<SOP>) =>
  api.patch<SOP>(`/sops/${id}/`, payload).then((r) => r.data);

export const transitionSOP = (
  id: number,
  to: SOPStage,
  extra: { reason?: string } = {},
) => api.post<SOP>(`/sops/${id}/transition/`, { to, ...extra }).then((r) => r.data);
