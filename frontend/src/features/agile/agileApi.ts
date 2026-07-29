import { api } from "../../api/client";
import type { TaskListItem } from "../tasks/types";

interface Paginated<T> { results: T[]; }

export interface Sprint {
  id: number;
  project: number;
  name: string;
  objective: string;
  start_date: string | null;
  end_date: string | null;
  owner: number | null;
  owner_name: string;
  status: "planning" | "active" | "completed";
  is_baselined: boolean;
  baselined_at: string | null;
  retrospective_notes: string;
  task_count: number;
  created_at: string;
}

export interface StandupBuckets {
  in_progress: TaskListItem[];
  blocked: TaskListItem[];
  overdue: TaskListItem[];
  done: TaskListItem[];
  no_recent_update: TaskListItem[];
  decisions_required: TaskListItem[];
}

export async function listSprints(projectId: number | string): Promise<Sprint[]> {
  const { data } = await api.get<Paginated<Sprint>>(`/sprints/?project=${projectId}`);
  return data.results ?? (data as unknown as Sprint[]);
}

export async function getSprint(id: number | string): Promise<Sprint> {
  const { data } = await api.get<Sprint>(`/sprints/${id}/`);
  return data;
}

export async function createSprint(payload: { project: number; name: string; objective?: string; start_date?: string; end_date?: string }): Promise<Sprint> {
  const { data } = await api.post<Sprint>("/sprints/", payload);
  return data;
}

export async function assignToSprint(sprintId: number, taskIds: number[], op: "add" | "remove"): Promise<void> {
  await api.post(`/sprints/${sprintId}/assign/`, { task_ids: taskIds, op });
}

export async function baselineSprint(id: number): Promise<Sprint> {
  const { data } = await api.post<Sprint>(`/sprints/${id}/baseline/`);
  return data;
}

export async function getStandup(id: number | string): Promise<StandupBuckets> {
  const { data } = await api.get<StandupBuckets>(`/sprints/${id}/standup/`);
  return data;
}

export async function listSprintTasks(sprintId: number | string): Promise<TaskListItem[]> {
  const { data } = await api.get<Paginated<TaskListItem>>(`/tasks/?sprint=${sprintId}`);
  return data.results ?? (data as unknown as TaskListItem[]);
}

export async function listBacklog(projectId: number | string): Promise<TaskListItem[]> {
  const { data } = await api.get<Paginated<TaskListItem>>(`/tasks/?project=${projectId}&unscheduled=true`);
  return data.results ?? (data as unknown as TaskListItem[]);
}
