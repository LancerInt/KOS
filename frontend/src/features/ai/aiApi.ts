import { api } from "../../api/client";

/**
 * Client for the KOS AI API.
 *
 * The browser never talks to an AI provider — it talks to Django, which holds
 * the key and makes the outbound call. There is deliberately no provider SDK,
 * base URL or key anywhere in this file.
 *
 * Every generation endpoint answers with the same {@link AiOutcome} envelope,
 * which is what lets one renderer display every AI action.
 */

export interface AiOutcome<T = Record<string, unknown>> {
  ok: boolean;
  action: string;
  /** Parsed JSON when `structured`; otherwise empty. */
  data: T;
  /** Raw text — the fallback when the model did not return valid JSON. */
  text: string;
  structured: boolean;
  provider: string;
  model: string;
  log_id: number | null;
  conversation_id?: number;
  report_id?: number;
}

export interface AiStatus {
  enabled: boolean;
  configured_provider: string;
  active_provider: string;
  model: string;
  key_configured: boolean;
  /** A provider is configured but has no key, so answers come from the local stub. */
  offline_fallback: boolean;
  automation_enabled: boolean;
}

export interface AiSettings {
  provider: string;
  model: string;
  base_url: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  is_enabled: boolean;
  automation_enabled: boolean;
  email_enabled: boolean;
  overdue_scan_enabled: boolean;
  blocked_scan_enabled: boolean;
  health_scan_enabled: boolean;
  daily_summary_enabled: boolean;
  weekly_report_enabled: boolean;
  monthly_report_enabled: boolean;
  outbound_email_enabled: boolean;
  outbound_max_recipients: number;
  outbound_hourly_limit_per_user: number;
  critical_alert_enabled: boolean;
  critical_alert_cooldown_hours: number;
  /** Comma or newline separated addresses blind-copied on every critical alert. */
  critical_alert_bcc: string;
  critical_alert_include_managers: boolean;
  reminder_repeat_minutes: number;
  manager_notify_hours: number;
  escalate_hours: number;
  max_calls_per_hour: number;
  max_items_per_scan: number;
  updated_at: string;
  status: AiStatus;
}

export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AiConversation {
  id: number;
  title: string;
  page_path: string;
  project: number | null;
  message_count: number;
  messages?: AiMessage[];
  created_at: string;
  updated_at: string;
}

export interface AiAutomationLog {
  id: number;
  event: string;
  task: number | null;
  task_title: string;
  project: number | null;
  project_name: string;
  ai_response: Record<string, unknown>;
  executed_actions: string[];
  ok: boolean;
  message: string;
  created_at: string;
}

export interface AiRequestLog {
  id: number;
  action: string;
  provider: string;
  model: string;
  user_name: string;
  ok: boolean;
  error: string;
  structured: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  response_preview: string;
  created_at: string;
}

export interface AiUsageStats {
  window_days: number;
  calls: number;
  failures: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_latency_ms: number;
  by_action: { action: string; count: number }[];
}

export interface AiReport {
  id: number;
  period: "daily" | "weekly" | "monthly";
  title: string;
  project: number | null;
  period_start: string;
  period_end: string;
  content: Record<string, unknown>;
  metrics: Record<string, unknown>;
  emailed_at: string | null;
  created_at: string;
}

export interface StandupContent {
  greeting: string;
  yesterday: string[];
  today_priorities: string[];
  overdue: string[];
  blockers: string[];
  attention: string[];
  recommendations: string[];
  productivity_insight: string;
  suggested_order: string[];
  /** Present only when the model ignored the JSON contract — its raw prose. */
  narrative?: string;
}

export interface StandupCounts {
  assigned_open: number;
  completed_yesterday: number;
  pending: number;
  overdue: number;
  due_today: number;
  upcoming_week: number;
  blocked: number;
  high_priority: number;
  meetings_today: number;
  unread_notifications: number;
  needs_acknowledgement: number;
}

export interface DailyStandup {
  id: number;
  standup_date: string;
  content: StandupContent;
  /** The figures the stand-up was built from — `counts` plus the task lists. */
  metrics: { counts?: StandupCounts; [key: string]: unknown };
  trigger: "scheduled" | "manual";
  generation_count: number;
  /** False when the provider was down and deterministic copy was used. */
  ai_ok: boolean;
  error: string;
  duration_ms: number;
  notified_at: string | null;
  emailed_at: string | null;
  created_at: string;
}

export interface StandupResponse {
  ok: boolean;
  exists?: boolean;
  /** True when generation was handed to a Celery worker — poll `getStandup`. */
  queued?: boolean;
  generated?: boolean;
  standup: DailyStandup | null;
  detail?: string;
}

export interface ExecutiveRiskEntry {
  name?: string;
  team?: string;
  risk?: string;
  reason?: string;
  action?: string;
}

export interface ExecutiveContent {
  title: string;
  overall_health: string;
  high_risk_projects: (ExecutiveRiskEntry | string)[];
  teams_needing_attention: (ExecutiveRiskEntry | string)[];
  productivity_overview: string;
  upcoming_deadlines: string[];
  critical_issues: string[];
  key_achievements: string[];
  recommended_actions: string[];
  executive_recommendations: string[];
  strategic_insights: string[];
  narrative?: string;
}

/** A project row from the computed risk table — figures, not AI output. */
export interface ExecutiveProjectRisk {
  id: number;
  name: string;
  code: string;
  status: string;
  health: string;
  manager: string;
  risk_score: number;
  reasons: string[];
  open_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  target_date: string;
  days_to_target: number | null;
  completion_percent: number;
}

export interface ExecutiveMetrics {
  period_start: string;
  period_end: string;
  health_score: number;
  projects: Record<string, number>;
  delivery: Record<string, number>;
  productivity: Record<string, number>;
  milestones: Record<string, number>;
  governance: Record<string, number>;
  quality: Record<string, number>;
  commercial: { available: boolean; [key: string]: number | boolean | string };
  detail?: {
    high_risk_projects?: ExecutiveProjectRisk[];
    delayed_projects?: ExecutiveProjectRisk[];
    all_project_risk?: ExecutiveProjectRisk[];
    team?: { person: string; completed: number; open: number; overdue: number; blocked: number }[];
    team_needing_attention?: { person: string; open: number; overdue: number; blocked: number }[];
    critical_issues?: { project: string; description: string; target_date: string }[];
    upcoming_deadlines?: { title: string; project: string; due_date: string; priority: string }[];
    completed_projects?: { name: string; code: string }[];
  };
}

export interface ExecutiveSummary {
  id: number;
  period: "daily" | "weekly" | "monthly";
  title: string;
  period_start: string;
  period_end: string;
  content: ExecutiveContent;
  metrics: ExecutiveMetrics;
  health_score: number;
  risk_count: number;
  trigger: "scheduled" | "manual";
  generated_by_name: string;
  generation_count: number;
  ai_ok: boolean;
  error: string;
  duration_ms: number;
  emailed_at: string | null;
  created_at: string;
}

export interface ExecutiveSummaryResponse {
  ok: boolean;
  exists?: boolean;
  queued?: boolean;
  generated?: boolean;
  summary: ExecutiveSummary | null;
  detail?: string;
}

export interface ExecutiveSummaryListEntry {
  id: number;
  period: "daily" | "weekly" | "monthly";
  title: string;
  period_start: string;
  period_end: string;
  health_score: number;
  risk_count: number;
  ai_ok: boolean;
  emailed_at: string | null;
  created_at: string;
}

interface Paginated<T> {
  count: number;
  results: T[];
}

/**
 * Turn an API failure into a message worth showing a user.
 *
 * A 503 is the expected shape of "AI is off, rate-limited or the vendor is
 * down" — the server already phrased those for humans, so pass them through
 * rather than replacing them with a generic error.
 */
export function aiErrorMessage(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { detail?: string } } })?.response;
  if (response?.data?.detail) return response.data.detail;
  if (response?.status === 403) return "You do not have permission to use this AI action.";
  if (response?.status === 404) return "That item no longer exists, or you do not have access to it.";
  return "The AI request could not be completed. Please try again.";
}

async function post<T = Record<string, unknown>>(url: string, body?: unknown): Promise<AiOutcome<T>> {
  const { data } = await api.post<AiOutcome<T>>(url, body ?? {});
  return data;
}

// --- status & settings ---------------------------------------------------- //
export async function getStatus(): Promise<AiStatus> {
  const { data } = await api.get<AiStatus>("/ai/status/");
  return data;
}

export async function getSettings(): Promise<AiSettings> {
  const { data } = await api.get<AiSettings>("/ai/settings/");
  return data;
}

export async function updateSettings(payload: Partial<AiSettings>): Promise<AiSettings> {
  const { data } = await api.put<AiSettings>("/ai/settings/", payload);
  return data;
}

// --- assistant ------------------------------------------------------------ //
export interface ChatPayload {
  message: string;
  conversation_id?: number | null;
  page_context?: string;
  page_path?: string;
  project_id?: number | null;
}

export function chat(payload: ChatPayload) {
  return post("/ai/chat/", payload);
}

export async function listConversations(): Promise<AiConversation[]> {
  const { data } = await api.get<Paginated<AiConversation>>("/ai/conversations/");
  return data.results ?? [];
}

export async function getConversation(id: number): Promise<AiConversation> {
  const { data } = await api.get<AiConversation>(`/ai/conversations/${id}/`);
  return data;
}

export async function deleteConversation(id: number): Promise<void> {
  await api.delete(`/ai/conversations/${id}/`);
}

// --- generic text tools --------------------------------------------------- //
export interface SummaryData {
  summary: string;
  key_points: string[];
  action_items: string[];
  sentiment: string;
}

export function summarize(text: string, options: { style?: string; audience?: string; instructions?: string } = {}) {
  return post<SummaryData>("/ai/summarize/", { text, ...options });
}

export function rewrite(text: string, options: { instruction?: string; tone?: string } = {}) {
  return post<{ text: string; changes: string[] }>("/ai/rewrite/", { text, ...options });
}

export function improveGrammar(text: string) {
  return post<{ text: string; changes: string[] }>("/ai/grammar/", { text });
}

export function translate(text: string, language: string) {
  return post<{ text: string; detected_source_language: string }>("/ai/translate/", { text, language });
}

export interface EmailData {
  subject: string;
  body: string;
  urgency: string;
  tone: string;
}

export interface EmailPayload {
  purpose: string;
  context?: string;
  tone?: string;
  recipient?: string;
  language?: string;
  project_id?: number;
  task_id?: number;
}

export function generateEmail(payload: EmailPayload) {
  return post<EmailData>("/ai/generate-email/", payload);
}

// --- sending a composed email --------------------------------------------- //
/**
 * Sending is a separate call from generating on purpose: generating is free to
 * repeat and changes nothing, sending is irreversible. The body posted here is
 * whatever the user approved on screen — the server never regenerates it.
 */
export interface SendEmailPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  subject: string;
  body: string;
  project_id?: number;
  task_id?: number;
  /** `log_id` from the generate-email response, tying the sent mail to its draft. */
  draft_log_id?: number | null;
}

export interface SentEmail {
  id: number;
  to: string[];
  cc: string[];
  bcc: string[];
  reply_to: string;
  subject: string;
  body: string;
  source: "manual" | "critical_alert";
  sender_name: string;
  status: "queued" | "sent" | "failed";
  error: string;
  attempts: number;
  sent_at: string | null;
  recipient_count: number;
  created_at: string;
}

export async function sendEmail(payload: SendEmailPayload): Promise<SentEmail> {
  const { data } = await api.post<SentEmail>("/ai/send-email/", payload);
  return data;
}

export async function listSentEmails(): Promise<SentEmail[]> {
  const { data } = await api.get<SentEmail[] | { results: SentEmail[] }>("/ai/emails/");
  return Array.isArray(data) ? data : data.results;
}

export async function resendEmail(id: number): Promise<SentEmail> {
  const { data } = await api.post<SentEmail>(`/ai/emails/${id}/resend/`);
  return data;
}

// --- projects ------------------------------------------------------------- //
export interface ProjectAnalysisData {
  summary: string;
  health_score: number | string;
  health_label: string;
  risk_level: string;
  risks: { title: string; severity: string; impact: string; mitigation: string }[];
  delay_prediction: {
    will_be_delayed: boolean | string;
    estimated_delay_days: number | string;
    confidence: string;
    reasoning: string;
  };
  recommendations: string[];
  next_actions: string[];
}

export const project = {
  summary: (id: number) => post<SummaryData>(`/ai/projects/${id}/summary/`),
  explain: (id: number) => post<SummaryData>(`/ai/projects/${id}/explain/`),
  risks: (id: number) => post<ProjectAnalysisData>(`/ai/projects/${id}/risks/`),
  delay: (id: number) => post<ProjectAnalysisData>(`/ai/projects/${id}/delay/`),
  health: (id: number) => post<ProjectAnalysisData>(`/ai/projects/${id}/health/`),
  analyse: (id: number, goal = "") => post<ProjectAnalysisData>(`/ai/projects/${id}/analyse/`, { goal }),
  analyseTasks: (id: number, goal = "") => post(`/ai/projects/${id}/analyse-tasks/`, { goal }),
  duplicates: (id: number) => post(`/ai/projects/${id}/duplicates/`),
  workload: (id: number) => post(`/ai/projects/${id}/workload/`),
};

// --- tasks ---------------------------------------------------------------- //
export interface SubtaskSuggestion {
  title: string;
  reason: string;
  order: number | string;
}

export const task = {
  summary: (id: number) => post<SummaryData>(`/ai/tasks/${id}/summary/`),
  rewrite: (id: number) => post<{ text: string; changes: string[] }>(`/ai/tasks/${id}/rewrite/`),
  subtasks: (id: number, count = 6) => post<{ subtasks: SubtaskSuggestion[] }>(`/ai/tasks/${id}/subtasks/`, { count }),
  estimate: (id: number) => post(`/ai/tasks/${id}/estimate/`),
  prioritize: (id: number) => post(`/ai/tasks/${id}/prioritize/`),
};

/** Writes the approved subtasks. Generation alone never changes ERP data. */
export async function applySubtasks(taskId: number, subtasks: string[]) {
  const { data } = await api.post<{ ok: boolean; created: number; subtasks: { id: number; title: string }[] }>(
    `/ai/tasks/${taskId}/apply-subtasks/`,
    { subtasks },
  );
  return data;
}

// --- meetings & notes ----------------------------------------------------- //
export interface MeetingData {
  summary: string;
  decisions: string[];
  action_items: { action: string; owner: string; due_in_days: number | string }[];
  attendees: string[];
  open_questions: string[];
}

export interface TaskDraft {
  title: string;
  description: string;
  deliverable: string;
  priority: string;
  owner_hint: string;
  due_in_days: number | string;
  subtasks: string[];
}

export function summarizeMeeting(notes: string, options: { context?: string; project_id?: number } = {}) {
  return post<MeetingData>("/ai/meetings/summarize/", { notes, ...options });
}

export function extractTasks(notes: string, options: { context?: string; project_id?: number } = {}) {
  return post<{ summary: string; decisions: string[]; tasks: TaskDraft[]; open_questions: string[] }>(
    "/ai/notes/extract-tasks/",
    { notes, ...options },
  );
}

export async function createTasksFromDrafts(projectId: number, tasks: Partial<TaskDraft>[]) {
  const { data } = await api.post<{ ok: boolean; created: number; tasks: { id: number; title: string }[] }>(
    "/ai/notes/create-tasks/",
    { project_id: projectId, tasks },
  );
  return data;
}

// --- CRM ------------------------------------------------------------------ //
export interface CustomerSummaryData {
  summary: string;
  relationship_health: string;
  open_value: number | string;
  highlights: string[];
  risks: string[];
  next_actions: string[];
}

export const crm = {
  summary: (id: number) => post<CustomerSummaryData>(`/ai/crm/customers/${id}/summary/`),
  reply: (id: number, incoming_message: string, options: { intent?: string; tone?: string } = {}) =>
    post<EmailData>(`/ai/crm/customers/${id}/reply/`, { incoming_message, ...options }),
  proposal: (id: number, brief: string, opportunity_id?: number) =>
    post(`/ai/crm/customers/${id}/proposal/`, { brief, opportunity_id }),
};

// --- HR ------------------------------------------------------------------- //
export const hr = {
  jobDescription: (payload: {
    role_title: string;
    department?: string;
    seniority?: string;
    requirements?: string;
  }) => post("/ai/hr/job-description/", payload),
  performanceSummary: (payload: { user_id: number; period_label?: string; notes?: string }) =>
    post("/ai/hr/performance-summary/", payload),
};

// --- workspace scaffold (build a project from a prompt) ------------------- //
export interface ScaffoldField {
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
}
export interface ScaffoldSection {
  name: string;
  blurb: string;
  fields: ScaffoldField[];
}
export interface ScaffoldPlan {
  project_name: string;
  sections: ScaffoldSection[];
}

export function scaffoldWorkspace(workspace: string, prompt: string, workspaceLabel = "") {
  return post<ScaffoldPlan>("/ai/workspace/scaffold/", { workspace, prompt, workspace_label: workspaceLabel });
}

export interface WorkspaceSuggestion {
  label: string;
  blurb: string;
  icon: string;
  accent: string;
}
export function suggestWorkspace(prompt: string) {
  return post<WorkspaceSuggestion>("/ai/workspace/suggest/", { prompt });
}

// --- dashboard ------------------------------------------------------------ //
export interface InsightsData {
  headline: string;
  insights: { title: string; detail: string; severity: string }[];
  recommendations: string[];
  trends: string[];
}

export const dashboard = {
  insights: (projectId?: number) => post<InsightsData>("/ai/dashboard/insights/", { project_id: projectId }),
  explain: (question = "", projectId?: number) =>
    post("/ai/dashboard/explain/", { question, project_id: projectId }),
  recommendations: () => post("/ai/dashboard/recommendations/"),
};

// --- reports & logs ------------------------------------------------------- //
export function generateReport(period: "daily" | "weekly" | "monthly", projectId?: number) {
  return post("/ai/reports/generate/", { period, project_id: projectId });
}

export async function listReports(): Promise<AiReport[]> {
  const { data } = await api.get<Paginated<AiReport>>("/ai/reports/");
  return data.results ?? [];
}

export async function listAutomationLogs(): Promise<AiAutomationLog[]> {
  const { data } = await api.get<Paginated<AiAutomationLog>>("/ai/automation-logs/");
  return data.results ?? [];
}

export async function listRequestLogs(): Promise<AiRequestLog[]> {
  const { data } = await api.get<Paginated<AiRequestLog>>("/ai/logs/");
  return data.results ?? [];
}

export async function getUsageStats(): Promise<AiUsageStats> {
  const { data } = await api.get<AiUsageStats>("/ai/logs/stats/");
  return data;
}

// --- daily stand-up -------------------------------------------------------- //
/**
 * Today's stand-up, read from storage.
 *
 * Never generates, so calling it on every dashboard mount costs nothing and
 * makes no provider call.
 */
export async function getStandup(): Promise<StandupResponse> {
  const { data } = await api.get<StandupResponse>("/ai/standup/");
  return data;
}

/**
 * Generate today's stand-up.
 *
 * Returns the stored one if it already exists; pass `force` to spend a fresh
 * provider call ("Regenerate"). A `queued: true` reply means a Celery worker
 * took the job — poll {@link getStandup} until the stand-up appears.
 */
export async function generateStandup(force = false): Promise<StandupResponse> {
  const { data } = await api.post<StandupResponse>("/ai/standup/", { force });
  return data;
}

export async function listStandups(): Promise<DailyStandup[]> {
  const { data } = await api.get<Paginated<DailyStandup>>("/ai/standups/");
  return data.results ?? [];
}

/** Flatten a stand-up to plain text, for Copy and Export. */
export function standupToText(standup: DailyStandup): string {
  const c = standup.content;
  const lines: string[] = [c.greeting || "Your stand-up"];
  const block = (heading: string, items?: string[]) => {
    const list = (items ?? []).filter((i) => typeof i === "string" && i.trim());
    if (list.length) lines.push("", heading, ...list.map((i) => `  • ${i}`));
  };
  block("Yesterday", c.yesterday);
  block("Today's priorities", c.today_priorities);
  block("Overdue", c.overdue);
  block("Blockers", c.blockers);
  block("Needs attention", c.attention);
  block("Recommendations", c.recommendations);
  block("Suggested order", c.suggested_order);
  if (c.productivity_insight) lines.push("", c.productivity_insight);
  if (c.narrative) lines.push("", c.narrative);
  return lines.join("\n").trim();
}

// --- executive summary ----------------------------------------------------- //
export type ExecutivePeriod = "daily" | "weekly" | "monthly";

export async function getExecutiveSummary(period: ExecutivePeriod = "daily"): Promise<ExecutiveSummaryResponse> {
  const { data } = await api.get<ExecutiveSummaryResponse>("/ai/executive-summary/", { params: { period } });
  return data;
}

/**
 * Generate the executive summary for a period.
 *
 * Reuses the stored summary unless `force` is set, so two managers pressing the
 * button on the same morning share one provider call.
 */
export async function generateExecutiveSummary(
  period: ExecutivePeriod = "daily",
  force = false,
): Promise<ExecutiveSummaryResponse> {
  const { data } = await api.post<ExecutiveSummaryResponse>("/ai/executive-summary/", { period, force });
  return data;
}

export async function emailExecutiveSummary(
  summaryId?: number,
  period?: ExecutivePeriod,
): Promise<{ ok: boolean; emailed: number; notified: number; emailed_at: string | null }> {
  const { data } = await api.post("/ai/executive-summary/email/", {
    summary_id: summaryId,
    period: summaryId ? undefined : period,
  });
  return data;
}

export async function listExecutiveSummaries(period?: ExecutivePeriod): Promise<ExecutiveSummaryListEntry[]> {
  const { data } = await api.get<Paginated<ExecutiveSummaryListEntry>>("/ai/executive-summaries/", {
    params: period ? { period } : undefined,
  });
  return data.results ?? [];
}

/**
 * Download the CSV export.
 *
 * Fetched through the axios client rather than by pointing the browser at the
 * URL, so the export travels with the auth header like every other API call.
 */
export async function downloadExecutiveSummaryCsv(summaryId?: number, period?: ExecutivePeriod): Promise<void> {
  const response = await api.get("/ai/executive-summary/export.csv", {
    params: summaryId ? { summary_id: summaryId } : { period },
    responseType: "blob",
  });
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kos-executive-summary-${period ?? "latest"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Flatten an executive summary to plain text, for Copy and the PDF/print view. */
export function executiveSummaryToText(summary: ExecutiveSummary): string {
  const c = summary.content;
  const lines: string[] = [c.title || "Executive summary", `Overall health: ${summary.health_score}/100`];
  if (c.overall_health) lines.push("", c.overall_health);

  const named = (item: ExecutiveRiskEntry | string) =>
    typeof item === "string"
      ? item
      : [item.name ?? item.team, item.reason, item.action].filter(Boolean).join(" — ");

  const block = (heading: string, items?: (ExecutiveRiskEntry | string)[]) => {
    const list = (items ?? []).map(named).filter(Boolean);
    if (list.length) lines.push("", heading, ...list.map((i) => `  • ${i}`));
  };

  block("High-risk projects", c.high_risk_projects);
  block("Teams needing attention", c.teams_needing_attention);
  if (c.productivity_overview) lines.push("", "Productivity", c.productivity_overview);
  block("Critical issues", c.critical_issues);
  block("Upcoming deadlines", c.upcoming_deadlines);
  block("Key achievements", c.key_achievements);
  block("Recommended actions", c.recommended_actions);
  block("Executive recommendations", c.executive_recommendations);
  block("Strategic insights", c.strategic_insights);
  if (c.narrative) lines.push("", c.narrative);
  return lines.join("\n").trim();
}
