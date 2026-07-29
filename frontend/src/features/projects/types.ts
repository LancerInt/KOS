export type ProjectType = "hybrid" | "agile" | "milestone" | "recurring";
export type Health = "on_track" | "at_risk" | "off_track" | "on_hold";
export type Priority = "critical" | "high" | "medium" | "low";

export interface ProjectSummary {
  id: number;
  name: string;
  code: string;
  project_type: ProjectType;
  status: string;
  priority: Priority;
  health: Health;
  progress: number;
  start_date: string | null;
  target_date: string | null;
  owner_name: string;
  member_count: number;
  my_role: string | null;
}

export interface Epic {
  id: number;
  project: number;
  title: string;
  description: string;
  order: number;
  milestone_count: number;
}

export interface Milestone {
  id: number;
  project: number;
  epic: number | null;
  title: string;
  description: string;
  due_date: string | null;
  status: "pending" | "in_progress" | "reached" | "missed";
  reached_at: string | null;
  order: number;
  is_reached: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  description: string;
  business_objective: string;
  success_criteria: string;
  working_rules: string;
  sprint_enabled: boolean;
  epics: Epic[];
  milestones: Milestone[];
}

export interface ProjectTemplate {
  id: number;
  key: string;
  name: string;
  description: string;
  project_type: ProjectType;
}
