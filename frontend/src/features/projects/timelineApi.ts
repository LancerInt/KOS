import { api } from "../../api/client";

export interface RoadmapProject {
  id: number;
  name: string;
  code: string;
  status: string;
  health: string;
  start_date: string | null;
  end_date: string | null;
}

export interface TimelineTask {
  id: number;
  title: string;
  status: string;
  category: string;
  start_date: string | null;
  due_date: string | null;
  owner: string | null;
}

export interface TimelineMilestone {
  id: number;
  title: string;
  due_date: string;
  status: string;
}

export interface TimelineDep {
  successor: number;
  predecessor: number;
}

export interface ProjectTimeline {
  project: { id: number; name: string; code: string; start_date: string | null; end_date: string | null };
  tasks: TimelineTask[];
  milestones: TimelineMilestone[];
  dependencies: TimelineDep[];
}

export interface Roadmap {
  projects: RoadmapProject[];
}

export async function getRoadmap(): Promise<Roadmap> {
  const { data } = await api.get<Roadmap>("/timeline/");
  return data;
}

export async function getProjectTimeline(projectId: number): Promise<ProjectTimeline> {
  const { data } = await api.get<ProjectTimeline>(`/timeline/?project=${projectId}`);
  return data;
}
