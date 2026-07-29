import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }

export type DependencyType = "fs" | "ss" | "external" | "milestone";

export interface Dependency {
  id: number;
  successor: number;
  predecessor_task: number | null;
  predecessor_milestone: number | null;
  dependency_type: DependencyType;
  is_mandatory: boolean;
  external_note: string;
  label: string;
  is_satisfied: boolean;
  created_at: string;
}

export interface Blocker {
  id: number;
  task: number;
  description: string;
  resolver: number | null;
  resolver_name: string;
  severity: "critical" | "high" | "medium" | "low";
  target_resolution_date: string | null;
  raised_by: number | null;
  raised_by_name: string;
  resolved_at: string | null;
  resolution_note: string;
  is_open: boolean;
  age_hours: number;
  created_at: string;
}

export async function listDependencies(taskId: number): Promise<Dependency[]> {
  const { data } = await api.get<Paginated<Dependency>>(`/dependencies/?successor=${taskId}`);
  return data.results ?? (data as unknown as Dependency[]);
}

export interface CreateDependencyPayload {
  successor: number;
  dependency_type: DependencyType;
  predecessor_task?: number;
  external_note?: string;
  is_mandatory?: boolean;
}

export async function createDependency(payload: CreateDependencyPayload): Promise<Dependency> {
  const { data } = await api.post<Dependency>("/dependencies/", payload);
  return data;
}

export async function deleteDependency(id: number): Promise<void> {
  await api.delete(`/dependencies/${id}/`);
}

export async function listBlockers(taskId: number): Promise<Blocker[]> {
  const { data } = await api.get<Paginated<Blocker>>(`/blockers/?task=${taskId}`);
  return data.results ?? (data as unknown as Blocker[]);
}

export async function createBlocker(payload: {
  task: number; description: string; severity: string; target_resolution_date?: string;
}): Promise<Blocker> {
  const { data } = await api.post<Blocker>("/blockers/", payload);
  return data;
}

export async function resolveBlocker(id: number, resolution_note: string): Promise<Blocker> {
  const { data } = await api.post<Blocker>(`/blockers/${id}/resolve/`, { resolution_note });
  return data;
}
