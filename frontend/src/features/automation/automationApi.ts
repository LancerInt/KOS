import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export interface Condition { field: string; op: string; value?: string | string[]; }
export interface AutomationActionSpec { type: string; message?: string; value?: string; text?: string; }

export interface AutomationRule {
  id: number;
  name: string;
  description: string;
  project: number | null;
  trigger: string;
  trigger_display: string;
  conditions: Condition[];
  actions: AutomationActionSpec[];
  is_active: boolean;
  order: number;
  created_by: number | null;
  created_by_name: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
}

export interface AutomationLog {
  id: number;
  rule: number | null;
  rule_name: string;
  trigger: string;
  trigger_display: string;
  task: number | null;
  project: number | null;
  actions_run: string[];
  ok: boolean;
  message: string;
  created_at: string;
}

export interface Vocabulary {
  triggers: { value: string; label: string }[];
  condition_ops: { value: string; label: string }[];
  condition_fields: string[];
  actions: { value: string; label: string }[];
  statuses: { value: string; label: string; category: string }[];
  priorities: { value: string; label: string }[];
}

export const listRules = () =>
  api.get<Paginated<AutomationRule>>("/automation/rules/").then((r) => unwrap(r.data));

export const listLogs = (projectId: number | string) =>
  api.get<Paginated<AutomationLog>>(`/automation/logs/?project=${projectId}`).then((r) => unwrap(r.data));

export const getVocabulary = () => api.get<Vocabulary>("/automation/vocabulary/").then((r) => r.data);

export const createRule = (payload: Partial<AutomationRule>) =>
  api.post<AutomationRule>("/automation/rules/", payload).then((r) => r.data);

export const updateRule = (id: number, payload: Partial<AutomationRule>) =>
  api.patch<AutomationRule>(`/automation/rules/${id}/`, payload).then((r) => r.data);

export const deleteRule = (id: number) => api.delete(`/automation/rules/${id}/`);
