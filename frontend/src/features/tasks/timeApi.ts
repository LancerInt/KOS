import { api } from "../../api/client";
import type { TimeEntry } from "./types";

export type { TimeEntry };

export interface WorkloadRow {
  user_id: number;
  user_name: string;
  logged_minutes: number;
  open_tasks: number;
  open_estimate_minutes: number;
}

export interface Workload {
  start: string;
  end: string;
  rows: WorkloadRow[];
}

export async function logTime(task: number, minutes: number, spent_on: string, note = ""): Promise<TimeEntry> {
  const { data } = await api.post<TimeEntry>("/time-entries/", { task, minutes, spent_on, note });
  return data;
}

export async function deleteTimeEntry(id: number): Promise<void> {
  await api.delete(`/time-entries/${id}/`);
}

export async function getWorkload(start?: string, end?: string): Promise<Workload> {
  const q = new URLSearchParams();
  if (start) q.set("start", start);
  if (end) q.set("end", end);
  const { data } = await api.get<Workload>(`/time-entries/workload/${q.toString() ? `?${q}` : ""}`);
  return data;
}

/** Minutes → "1h 30m" / "45m". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!min) return "0m";
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
