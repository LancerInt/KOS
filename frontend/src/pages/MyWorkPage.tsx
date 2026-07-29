import { useEffect, useMemo, useState, type ReactNode } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import { Avatar, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";

import { listMyTasks } from "../features/tasks/tasksApi";
import type { Category, TaskListItem, UserMini } from "../features/tasks/types";
import { CATEGORY_COLOR, CATEGORY_LABEL, FlowRail, StatusChip } from "../features/tasks/display";
import { PRIORITY_COLOR } from "../features/projects/display";
import { useAppSelector } from "../hooks";
import TaskDrawer from "../components/TaskDrawer";
import NewTaskDialog from "../components/NewTaskDialog";
import { tokens, monoFont } from "../theme";

function initials(u: UserMini): string {
  const parts = (u.full_name || u.username).split(" ");
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

const todayStr = () => new Date().toISOString().slice(0, 10);
function withinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  const now = new Date(todayStr()).getTime();
  return d >= now && d <= now + days * 86400000;
}

type TabKey = "today" | "week" | "overdue" | "review" | "blocked" | "decision";

const TABS: { key: TabKey; label: string; hot?: boolean }[] = [
  { key: "today", label: "Due today" },
  { key: "week", label: "This week" },
  { key: "overdue", label: "Overdue", hot: true },
  { key: "review", label: "Waiting for review" },
  { key: "blocked", label: "Blocked" },
  { key: "decision", label: "Needs my decision" },
];

const DIST: Category[] = ["not_started", "active", "waiting", "in_review", "done"];

function bucket(tasks: TaskListItem[], key: TabKey): TaskListItem[] {
  const today = todayStr();
  switch (key) {
    case "today": return tasks.filter((t) => t.due_date === today && t.category !== "done");
    case "week": return tasks.filter((t) => withinDays(t.due_date, 7) && t.category !== "done");
    case "overdue": return tasks.filter((t) => t.is_overdue);
    case "review": return tasks.filter((t) => t.category === "in_review");
    case "blocked": return tasks.filter((t) => t.status === "blocked");
    case "decision": return tasks.filter((t) => t.task_type === "decision" || t.task_type === "approval");
  }
}

export default function MyWorkPage() {
  const user = useAppSelector((s) => s.auth.user);
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [tab, setTab] = useState<TabKey>("today");
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = () => listMyTasks().then(setTasks).catch(() => setTasks([]));
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const t = tasks ?? [];
    return Object.fromEntries(TABS.map((x) => [x.key, bucket(t, x.key).length])) as Record<TabKey, number>;
  }, [tasks]);

  const dist = useMemo(() => {
    const d: Record<Category, number> = { not_started: 0, active: 0, waiting: 0, in_review: 0, done: 0, cancelled: 0 };
    for (const t of tasks ?? []) d[t.category] += 1;
    return d;
  }, [tasks]);

  const shown = tasks ? bucket(tasks, tab) : [];
  const decisions = tasks ? bucket(tasks, "decision") : [];
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(",", " ·");

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", px: 3, py: 3.5 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 312px" }, gap: 3, alignItems: "start" }}>

        {/* head */}
        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={2} flexWrap="wrap" sx={{ gridColumn: "1 / -1" }}>
          <Box>
            <Typography variant="h1" sx={{ fontSize: 26 }}>My Work</Typography>
            <Typography sx={{ mt: 0.4, color: tokens.text2, fontSize: 13.5 }}>
              {tasks
                ? <>Welcome, {user?.first_name || user?.username}. <b style={{ color: tokens.text }}>{counts.today}</b> due today · <b style={{ color: counts.overdue ? tokens.attn : tokens.text }}>{counts.overdue}</b> overdue.</>
                : "Loading your work…"}
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>{dateStr}</Typography>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setNewOpen(true)}>New task</Button>
          </Stack>
        </Stack>

        {/* tabs */}
        <Stack direction="row" spacing={0.5} sx={{ gridColumn: "1 / -1", borderBottom: `1px solid ${tokens.line}`, flexWrap: "wrap", mt: -0.5 }}>
          {TABS.map((t) => {
            const active = t.key === tab;
            const n = counts[t.key] ?? 0;
            return (
              <Box key={t.key} onClick={() => setTab(t.key)}
                sx={{ cursor: "pointer", px: 1.5, py: 1.1, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 1,
                  color: active ? tokens.kriyaInk : tokens.text2, borderBottom: `2px solid ${active ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
                {t.label}
                <Box sx={{ fontSize: 11, fontFamily: monoFont, px: 0.75, borderRadius: 5, minWidth: 18, textAlign: "center",
                  bgcolor: t.hot && n > 0 ? tokens.attnWash : active ? tokens.kriyaWash : "#EEF0F3",
                  color: t.hot && n > 0 ? tokens.attn : active ? tokens.kriyaInk : tokens.text2 }}>{n}</Box>
              </Box>
            );
          })}
        </Stack>

        {/* LEFT — task list */}
        <Box sx={{ minWidth: 0 }}>
          {!tasks && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>}

          {tasks && counts.overdue > 0 && tab !== "overdue" && (
            <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: "6px", display: "flex", alignItems: "center", gap: 1.5,
              bgcolor: tokens.attnWash, borderColor: "#F2C9BC", borderLeft: `3px solid ${tokens.attn}` }}>
              <Box sx={{ width: 30, height: 30, borderRadius: "6px", bgcolor: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <WarningAmberRoundedIcon sx={{ fontSize: 17, color: tokens.attn }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#A23A22" }}>{counts.overdue} overdue task{counts.overdue === 1 ? "" : "s"} need attention.</Typography>
                <Typography sx={{ fontSize: 12, color: "#9A5847" }}>Respond within 24h or they surface on the Management dashboard.</Typography>
              </Box>
              <Button size="small" onClick={() => setTab("overdue")}
                sx={{ bgcolor: tokens.attn, color: "#fff", fontWeight: 600, "&:hover": { bgcolor: tokens.attn, filter: "brightness(1.06)" } }}>
                Review
              </Button>
            </Paper>
          )}

          {tasks && shown.length === 0 && (
            <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px" }}>
              <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Nothing here</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 14 }}>No tasks in this view. Enjoy the calm.</Typography>
            </Paper>
          )}

          <Stack spacing={1.25}>
            {shown.map((t) => <TaskCard key={t.id} t={t} onOpen={() => setOpenTask(t.id)} />)}
          </Stack>
        </Box>

        {/* RIGHT rail */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, position: { md: "sticky" }, top: 12 }}>
          <Panel title="Today at a glance">
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
              <StatTile value={counts.overdue} label="Overdue" color={counts.overdue ? tokens.attn : undefined} />
              <StatTile value={counts.today} label="Due today" />
              <StatTile value={counts.review} label="Waiting review" color={counts.review ? "#7C5CD6" : undefined} />
              <StatTile value={counts.blocked} label="Blocked" color={counts.blocked ? "#C68A1E" : undefined} />
            </Box>
          </Panel>

          <Panel title="Your work by stage">
            <DistBar dist={dist} />
          </Panel>

          <Panel title="Awaiting my decision">
            {decisions.length === 0 ? (
              <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Nothing waiting on you.</Typography>
            ) : (
              <Stack spacing={0}>
                {decisions.slice(0, 5).map((d, i) => (
                  <Stack key={d.id} direction="row" alignItems="center" spacing={1} onClick={() => setOpenTask(d.id)}
                    sx={{ py: 0.9, cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${tokens.line}`, "&:hover": { color: tokens.kriyaInk } }}>
                    <Box component="span" sx={{ fontFamily: monoFont, fontSize: 9.5, color: tokens.text2, bgcolor: tokens.paper, border: `1px solid ${tokens.line}`, px: 0.75, borderRadius: 1 }}>
                      {d.task_type === "approval" ? "APPROVAL" : "DECISION"}
                    </Box>
                    <Typography sx={{ fontSize: 12.5, flex: 1 }} noWrap>{d.title}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Panel>
        </Box>
      </Box>

      <TaskDrawer taskId={openTask} open={openTask !== null} onClose={() => setOpenTask(null)} onChanged={load} />
      <NewTaskDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); load(); }} />
    </Box>
  );
}

function TaskCard({ t, onOpen }: { t: TaskListItem; onOpen: () => void }) {
  return (
    <Paper onClick={onOpen}
      sx={{ p: 1.75, borderRadius: "6px", cursor: "pointer", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 13px",
        transition: "box-shadow .16s, transform .16s, border-color .16s",
        "&:hover": { boxShadow: "0 2px 4px rgba(20,22,29,.06), 0 12px 32px rgba(20,22,29,.1)", transform: "translateY(-1px)", borderColor: "#DADEE4" } }}>
      <Box sx={{ width: 9, height: 9, borderRadius: "50%", mt: 0.75, bgcolor: PRIORITY_COLOR[t.priority] }} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 550 }}>{t.title}</Typography>
          <StatusChip label={t.status_label} category={t.category} />
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mt: 0.75, flexWrap: "wrap" }}>
          <Chip label={t.project_code} size="small" sx={{ fontFamily: monoFont, fontSize: 10.5, height: 19, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />
          {t.due_date && (
            <Typography sx={{ fontSize: 12, color: t.is_overdue ? tokens.attn : tokens.text2, fontWeight: t.is_overdue ? 600 : 400 }}>
              {t.is_overdue ? "Overdue · " : "Due "}{t.due_date}
            </Typography>
          )}
          {t.checklist_total > 0 && (
            <Typography sx={{ fontSize: 11.5, color: tokens.text3, fontFamily: monoFont }}>☑ {t.checklist_done}/{t.checklist_total}</Typography>
          )}
        </Stack>
        <Box sx={{ mt: 1.25 }}><FlowRail category={t.category} showCaps /></Box>
        {t.status === "blocked" && (
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 1, px: 1, py: 0.6, borderRadius: 1.5, bgcolor: "#FBF6EA", color: "#B47C1E" }}>
            <BlockRoundedIcon sx={{ fontSize: 13 }} />
            <Typography sx={{ fontSize: 11.5 }}>Blocked — resolve the open blocker to continue.</Typography>
          </Stack>
        )}
      </Box>
      <Stack direction="row" alignItems="flex-start">
        {t.owners_detail.slice(0, 3).map((o, i) => (
          <Avatar key={o.id} title={o.full_name || o.username}
            sx={{ width: 25, height: 25, fontSize: 10, ml: i === 0 ? 0 : "-7px", border: "2px solid #fff",
              bgcolor: o.id === t.primary_owner ? tokens.kriyaInk : tokens.text2 }}>
            {initials(o)}
          </Avatar>
        ))}
        {t.primary_owner && <StarRoundedIcon sx={{ fontSize: 12, color: "#E5A138", ml: 0.25 }} />}
      </Stack>
    </Paper>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2, borderRadius: "6px" }}>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".07em", color: tokens.text3, fontWeight: 600, mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function StatTile({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <Box sx={{ border: `1px solid ${tokens.line}`, borderRadius: "6px", p: 1.25 }}>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 24, fontWeight: 600, lineHeight: 1, color: color ?? tokens.ink }}>{value}</Typography>
      <Typography sx={{ fontSize: 11.5, color: tokens.text2, mt: 0.5 }}>{label}</Typography>
    </Box>
  );
}

function DistBar({ dist }: { dist: Record<Category, number> }) {
  const total = DIST.reduce((s, c) => s + dist[c], 0);
  return (
    <>
      <Box sx={{ display: "flex", height: 9, borderRadius: 5, overflow: "hidden", bgcolor: "#EEF0F3" }}>
        {total > 0 && DIST.map((c) => (dist[c] > 0 ? <Box key={c} sx={{ width: `${(dist[c] / total) * 100}%`, bgcolor: CATEGORY_COLOR[c] }} /> : null))}
      </Box>
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={1.25} sx={{ mt: 1.5 }}>
        {DIST.filter((c) => dist[c] > 0).map((c) => (
          <Stack key={c} direction="row" alignItems="center" spacing={0.5}>
            <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: CATEGORY_COLOR[c] }} />
            <Typography sx={{ fontSize: 11, color: tokens.text2 }}>{CATEGORY_LABEL[c]}</Typography>
            <Typography sx={{ fontSize: 11, fontFamily: monoFont, color: tokens.text }}>{dist[c]}</Typography>
          </Stack>
        ))}
        {total === 0 && <Typography sx={{ fontSize: 12, color: tokens.text3 }}>No tasks yet.</Typography>}
      </Stack>
    </>
  );
}
