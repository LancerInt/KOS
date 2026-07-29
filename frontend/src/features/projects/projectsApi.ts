import { api } from "../../api/client";
import type { ProjectDetail, ProjectSummary, ProjectTemplate } from "./types";

interface Paginated<T> {
  count: number;
  results: T[];
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { data } = await api.get<Paginated<ProjectSummary>>("/projects/");
  return data.results ?? (data as unknown as ProjectSummary[]);
}

export async function getProject(id: number | string): Promise<ProjectDetail> {
  const { data } = await api.get<ProjectDetail>(`/projects/${id}/`);
  return data;
}

export async function listTemplates(): Promise<ProjectTemplate[]> {
  const { data } = await api.get<Paginated<ProjectTemplate>>("/project-templates/");
  return data.results ?? (data as unknown as ProjectTemplate[]);
}

export interface CreateFromTemplatePayload {
  template: string;
  name: string;
  code: string;
  start_date?: string;
  priority?: string;
}

export async function createFromTemplate(payload: CreateFromTemplatePayload): Promise<ProjectDetail> {
  const { data } = await api.post<ProjectDetail>("/projects/from_template/", payload);
  return data;
}

export async function updateProject(id: number | string, payload: Partial<ProjectDetail>): Promise<ProjectDetail> {
  const { data } = await api.patch<ProjectDetail>(`/projects/${id}/`, payload);
  return data;
}
