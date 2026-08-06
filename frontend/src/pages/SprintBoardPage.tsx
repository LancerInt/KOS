import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";

import {
  assignToSprint, baselineSprint, getSprint, getStandup,
  listBacklog, listSprintTasks, type Sprint, type StandupBuckets,
} from "../features/agile/agileApi";
import type { Category, TaskListItem } from "../features/tasks/types";
import { CATEGORY_COLOR, CATEGORY_LABEL, StatusChip } from "../features/tasks/display";
import { PRIORITY_COLOR } from "../features/projects/display";
import TaskDrawer from "../components/TaskDrawer";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const COLUMNS: Category[] = ["not_started", "active", "waiting", "in_review", "done"];

export default function SprintBoardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canManage = "manage_backlog" in caps || "administer" in caps;

  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [backlog, setBacklog] = useState<TaskListItem[]>([]);
  const [standup, setStandup] = useState<StandupBuckets | null>(null);
  const [tab, setTab] = useState<"board" | "standup">("board");
  const [showBacklog, setShowBacklog] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);

  const load = async () => {
    if (!id) return;
    const s = await getSprint(id);
    setSprint(s);
    setTasks(await listSprintTasks(id));
    setBacklog(await listBacklog(s.project));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { if (tab === "standup" && id) getStandup(id).then(setStandup); }, [tab, id]);

  const addToSprint = async (taskId: number) => {
    if (!sprint) return;
    await assignToSprint(sprint.id, [taskId], "add");
    load();
  };

  if (!sprint) return <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={24} /></Stack>;

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} onClick={() => navigate(`/projects/${sprint.project}`)}
        sx={{ cursor: "pointer", color: tokens.text2, width: "fit-content", "&:hover": { color: tokens.kriyaInk } }}>
        <ArrowBackRoundedIcon sx={{ fontSize: 17 }} /><Typography sx={{ fontSize: 13 }}>Back to project</Typography>
      </Stack>

      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mt: 2, mb: 2.5, flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 26 }}>{sprint.name}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 14 }}>
            {sprint.objective || "No objective set."} · {sprint.task_count} tasks
            {sprint.is_baselined && " · baselined"}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant={tab === "board" ? "contained" : "text"} onClick={() => setTab("board")}>Board</Button>
          <Button size="small" variant={tab === "standup" ? "contained" : "text"} onClick={() => setTab("standup")}>Stand-up</Button>
          {canManage && !sprint.is_baselined && (
            <Button size="small" variant="outlined" onClick={() => baselineSprint(sprint.id).then(setSprint)}>Baseline plan</Button>
          )}
          {canManage && (
            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setShowBacklog((v) => !v)}>
              Backlog ({backlog.length})
            </Button>
          )}
        </Stack>
      </Stack>

      {tab === "board" ? (
        <Stack direction="row" spacing={2} sx={{ overflowX: "auto", pb: 2 }}>
          {COLUMNS.map((c) => {
            const colTasks = tasks.filter((t) => t.category === c);
            return (
              <Box key={c} sx={{ minWidth: 250, width: 250, flex: "none" }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: CATEGORY_COLOR[c] }} />
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]}</Typography>
                  <Typography sx={{ fontSize: 11, color: tokens.text3, fontFamily: monoFont }}>{colTasks.length}</Typography>
                </Stack>
                <Stack spacing={1}>
                  {colTasks.map((t) => <BoardCard key={t.id} t={t} onClick={() => setOpenTask(t.id)} />)}
                  {colTasks.length === 0 && (
                    <Box sx={{ border: `1px dashed ${tokens.line}`, borderRadius: 2, py: 2, textAlign: "center", color: tokens.text3, fontSize: 12 }}>Empty</Box>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      ) : (
        <StandupView standup={standup} onOpen={setOpenTask} />
      )}

      {/* backlog panel */}
      {showBacklog && (
        <Paper sx={{ position: "fixed", right: 16, bottom: 16, top: 80, width: 320, p: 2, borderRadius: 3, overflowY: "auto", boxShadow: "0 20px 48px rgba(20,22,29,.18)", zIndex: 30 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography sx={{ fontWeight: 600 }}>Backlog</Typography>
            <Button size="small" onClick={() => setShowBacklog(false)}>Close</Button>
          </Stack>
          {backlog.length === 0 && <Typography sx={{ fontSize: 13, color: tokens.text3 }}>Backlog is empty.</Typography>}
          <Stack spacing={1}>
            {backlog.map((t) => (
              <Paper key={t.id} sx={{ p: 1.25, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{t.title}</Typography>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
                  <StatusChip label={t.status_label} category={t.category} />
                  <Button size="small" onClick={() => addToSprint(t.id)}>Add →</Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Paper>
      )}

      <TaskDrawer taskId={openTask} open={openTask !== null} onClose={() => setOpenTask(null)} onChanged={load} />
    </Box>
  );
}

function BoardCard({ t, onClick }: { t: TaskListItem; onClick: () => void }) {
  return (
    <Paper onClick={onClick} sx={{ p: 1.25, borderRadius: 2, cursor: "pointer", "&:hover": { borderColor: "#DADEE4", boxShadow: "0 6px 18px rgba(20,22,29,.08)" } }}>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: PRIORITY_COLOR[t.priority] }} />
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{t.title}</Typography>
      </Stack>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.75 }}>
        <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>{t.project_code}</Typography>
        {t.due_date && <Typography sx={{ fontSize: 10.5, color: t.is_overdue ? tokens.attn : tokens.text3, fontFamily: monoFont }}>{t.due_date}</Typography>}
      </Stack>
    </Paper>
  );
}

function StandupView({ standup, onOpen }: { standup: StandupBuckets | null; onOpen: (id: number) => void }) {
  if (!standup) return <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={22} /></Stack>;
  const groups: { key: keyof StandupBuckets; label: string; color: string }[] = [
    { key: "in_progress", label: "In progress", color: CATEGORY_COLOR.active },
    { key: "blocked", label: "Blocked", color: CATEGORY_COLOR.waiting },
    { key: "overdue", label: "Overdue", color: tokens.attn },
    { key: "no_recent_update", label: "No recent update", color: tokens.text2 },
    { key: "decisions_required", label: "Decisions required", color: CATEGORY_COLOR.in_review },
    { key: "done", label: "Completed", color: CATEGORY_COLOR.done },
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, maxWidth: 900 }}>
      {groups.map((g) => (
        <Paper key={g.key} sx={{ p: 2, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: g.color }}>{g.label}</Typography>
            <Chip label={standup[g.key].length} size="small" sx={{ height: 19, fontSize: 10.5, bgcolor: `${g.color}1a`, color: g.color }} />
          </Stack>
          <Stack spacing={0.5}>
            {standup[g.key].map((t) => (
              <Typography key={t.id} onClick={() => onOpen(t.id)} sx={{ fontSize: 13, cursor: "pointer", "&:hover": { color: tokens.kriyaInk } }}>{t.title}</Typography>
            ))}
            {standup[g.key].length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>—</Typography>}
          </Stack>
        </Paper>
      ))}
    </Box>
  );
}
