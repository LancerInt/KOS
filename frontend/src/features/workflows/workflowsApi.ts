import { api } from "../../api/client";
import type { Category } from "../tasks/types";

export interface WStatus {
  key: string;
  label: string;
  category: Category;
  order: number;
  is_initial: boolean;
}

export interface WTransition {
  from: string;
  to: string;
}

export interface ResolvedWorkflow {
  source: "default" | "custom";
  strict: boolean;
  initial: string;
  statuses: WStatus[];
  transitions: WTransition[];
  has_custom: boolean;
  project: number;
}

export async function getWorkflow(projectId: number | string): Promise<ResolvedWorkflow> {
  const { data } = await api.get<ResolvedWorkflow>(`/projects/${projectId}/workflow/`);
  return data;
}

export async function customizeWorkflow(projectId: number | string): Promise<ResolvedWorkflow> {
  const { data } = await api.post<ResolvedWorkflow>(`/projects/${projectId}/workflow/`);
  return data;
}

export async function saveWorkflow(
  projectId: number | string,
  payload: { name?: string; statuses: WStatus[]; transitions: WTransition[] },
): Promise<ResolvedWorkflow> {
  const { data } = await api.put<ResolvedWorkflow>(`/projects/${projectId}/workflow/`, payload);
  return data;
}

export async function revertWorkflow(projectId: number | string): Promise<ResolvedWorkflow> {
  const { data } = await api.delete<ResolvedWorkflow>(`/projects/${projectId}/workflow/`);
  return data;
}
