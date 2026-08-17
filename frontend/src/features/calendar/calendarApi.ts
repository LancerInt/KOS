import { api } from "../../api/client";

/** One schedulable thing on the calendar — a workspace project (on its deadline)
 *  or a statutory filing (on its due date). */
export interface CalendarItem {
  kind: "project" | "filing";
  id: number;
  title: string;
  workspace: string;
  /** The key date it sits on (YYYY-MM-DD): a project's deadline / a filing's due date. */
  date: string;
  start: string;
  end: string;
  status: "active" | "overdue" | "blocked" | "completed" | "pending" | "filed";
  url: string;
}

export interface CalendarResponse {
  start: string;
  end: string;
  items: CalendarItem[];
}

export async function getCalendar(start: string, end: string): Promise<CalendarResponse> {
  const { data } = await api.get<CalendarResponse>("/calendar/", { params: { start, end } });
  return data;
}
