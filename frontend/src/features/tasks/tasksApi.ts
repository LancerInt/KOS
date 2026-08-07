import { api } from "../../api/client";
import type { Comment, TaskDetail, TaskListItem } from "./types";

interface Paginated<T> {
  results: T[];
}

export async function listMyTasks(): Promise<TaskListItem[]> {
  const { data } = await api.get<TaskListItem[]>("/tasks/mine/");
  return data;
}

export async function listProjectTasks(projectId: number | string): Promise<TaskListItem[]> {
  const { data } = await api.get<Paginated<TaskListItem>>(`/tasks/?project=${projectId}`);
  return data.results ?? (data as unknown as TaskListItem[]);
}

export async function getTask(id: number): Promise<TaskDetail> {
  const { data } = await api.get<TaskDetail>(`/tasks/${id}/`);
  return data;
}

export interface CreateTaskPayload {
  title: string;
  project: number;
  priority?: string;
  due_date?: string;
  deliverable?: string;
  description?: string;
  task_type?: string;
}

export async function createTask(payload: CreateTaskPayload): Promise<TaskDetail> {
  const { data } = await api.post<TaskDetail>("/tasks/", payload);
  return data;
}

export async function patchTask(id: number, payload: Partial<CreateTaskPayload>): Promise<TaskDetail> {
  const { data } = await api.patch<TaskDetail>(`/tasks/${id}/`, payload);
  return data;
}

/** Returns the updated task, or throws with `blocking_reasons` on a blocked completion. */
export async function setTaskStatus(id: number, status: string): Promise<TaskDetail> {
  const { data } = await api.post<TaskDetail>(`/tasks/${id}/set_status/`, { status });
  return data;
}

export async function toggleChecklistItem(id: number, isDone: boolean): Promise<void> {
  await api.patch(`/checklist-items/${id}/`, { is_done: isDone });
}

export async function addComment(task: number, body: string, mentions: number[] = []): Promise<Comment> {
  const { data } = await api.post<Comment>("/comments/", { task, body, mentions });
  return data;
}
