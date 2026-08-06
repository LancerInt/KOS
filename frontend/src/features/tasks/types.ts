import type { Priority } from "../projects/types";

export type Category = "not_started" | "active" | "waiting" | "in_review" | "done" | "cancelled";

export interface UserMini {
  id: number;
  username: string;
  full_name: string;
}

export interface TaskListItem {
  id: number;
  title: string;
  project: number;
  project_code: string;
  epic: number | null;
  milestone: number | null;
  task_type: string;
  status: string;
  status_label: string;
  category: Category;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  is_overdue: boolean;
  primary_owner: number | null;
  primary_owner_detail: UserMini | null;
  owners_detail: UserMini[];
  checklist_done: number;
  checklist_total: number;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  task: number;
  title: string;
  is_done: boolean;
  is_required: boolean;
  order: number;
}

export interface Subtask {
  id: number;
  task: number;
  title: string;
  is_done: boolean;
  assignee: number | null;
  order: number;
}

export interface Comment {
  id: number;
  task: number;
  author: number | null;
  author_detail: UserMini | null;
  body: string;
  mentions: number[];
  created_at: string;
}

export interface Activity {
  id: number;
  actor_detail: UserMini | null;
  verb: string;
  verb_display: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface TimeEntry {
  id: number;
  task: number;
  user: number | null;
  user_detail: UserMini | null;
  minutes: number;
  spent_on: string;
  note: string;
  created_at: string;
}

export interface TaskDetail extends TaskListItem {
  description: string;
  deliverable: string;
  definition_of_done: string;
  tags: string[];
  risk_level: string;
  reminder_lead_days: number;
  reviewer: number | null;
  reviewer_detail: UserMini | null;
  collaborators_detail: UserMini[];
  estimate_minutes: number | null;
  logged_minutes: number;
  subtasks: Subtask[];
  checklist_items: ChecklistItem[];
  comments: Comment[];
  activities: Activity[];
  time_entries: TimeEntry[];
  blocking_reasons: string[];
}
