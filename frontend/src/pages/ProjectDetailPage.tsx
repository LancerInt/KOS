import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { Box, Button, Chip, CircularProgress, Divider, Paper, Stack, Typography } from "@mui/material";

import { getProject, updateProject } from "../features/projects/projectsApi";
import type { Milestone, ProjectDetail } from "../features/projects/types";
import { HealthChip, MILESTONE_COLOR, PRIORITY_COLOR, ProgressBar, TYPE_LABEL } from "../features/projects/display";
import { listProjectTasks } from "../features/tasks/tasksApi";
import type { TaskListItem } from "../features/tasks/types";
import { FlowRail, StatusChip } from "../features/tasks/display";
import { listSprints, type Sprint } from "../features/agile/agileApi";
import TaskDrawer from "../components/TaskDrawer";
import NewTaskDialog from "../components/NewTaskDialog";
import NewSprintDialog from "../components/NewSprintDialog";
import AiActionButton, { AiActionBar } from "../features/ai/AiActionButton";
import { useAiPageContext } from "../features/ai/AiContext";
import { project as projectAi } from "../features/ai/aiApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);

  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canCreate = "create_tasks" in caps || "administer" in caps;
  const canManageSprints = "manage_backlog" in caps || "administer" in caps;

  const loadTasks = () => {
    if (id) listProjectTasks(id).then(setTasks).catch(() => setTasks([]));
  };
  const loadSprints = () => {
    if (id) listSprints(id).then(setSprints).catch(() => setSprints([]));
  };
  const enableSprints = async () => {
    if (!id) return;
    await updateProject(id, { sprint_enabled: true });
    setProject(await getProject(id));
    loadSprints();
  };

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e?.response?.status === 403 ? "You don't have access to this project." : "Project not found."));
    loadTasks();
    loadSprints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Tell the assistant what is on screen. Declared before the early returns so
  // the hook order stays stable while the project loads.
  useAiPageContext(
    useMemo(
      () =>
        project
          ? {
              label: `Project · ${project.name}`,
              projectId: project.id,
              text:
                `The user is viewing project ${project.code} "${project.name}" ` +
                `(status ${project.status}, health ${project.health}, ${project.progress}% complete, ` +
                `target date ${project.target_date ?? "not set"}). It has ${tasks.length} tasks listed.`,
            }
          : null,
      [project, tasks.length],
    ),
  );

  if (error) {
    return (
      <Box sx={{ px: 3, py: 2.5 }}>
        <BackLink onClick={() => navigate("/projects")} />
        <Typography sx={{ color: tokens.attn, mt: 2 }}>{error}</Typography>
      </Box>
    );
  }
  if (!project) {
    return <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={26} /></Stack>;
  }

  const projectMilestones = project.milestones.filter((m) => m.epic === null);

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <BackLink onClick={() => navigate("/projects")} />

      {/* header */}
      <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ mt: 2, mb: 3 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>{project.code}</Typography>
          <Typography variant="h1" sx={{ fontSize: 28, mt: 0.25 }}>{project.name}</Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip label={TYPE_LABEL[project.project_type]} size="small" sx={{ height: 22, bgcolor: "#F1F3F5", color: tokens.text2 }} />
            <Chip label={project.status.replace("_", " ")} size="small" sx={{ height: 22, bgcolor: "#F1F3F5", color: tokens.text2, textTransform: "capitalize" }} />
            <HealthChip health={project.health} />
            {project.sprint_enabled && <Chip label="Sprints on" size="small" sx={{ height: 22, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />}
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <Button size="small" variant="text" onClick={() => navigate(`/projects/${project.id}/workflow`)} sx={{ px: 0 }}>
              Configure workflow →
            </Button>
            <Button size="small" variant="text" onClick={() => navigate(`/projects/${project.id}/registers`)} sx={{ px: 0 }}>
              Risks, issues &amp; decisions →
            </Button>
            <Button size="small" variant="text" onClick={() => navigate(`/projects/${project.id}/documents`)} sx={{ px: 0 }}>
              Documents →
            </Button>
            <Button size="small" variant="text" onClick={() => navigate(`/projects/${project.id}/automation`)} sx={{ px: 0 }}>
              Automation →
            </Button>
          </Stack>

          {/* AI actions for this project */}
          <Box sx={{ mt: 1.75 }}>
            <AiActionBar>
              <AiActionButton label="Summarize" title={`Summary · ${project.name}`} run={() => projectAi.summary(project.id)} />
              <AiActionButton label="Analyse risks" title={`Risk analysis · ${project.name}`} run={() => projectAi.risks(project.id)} />
              <AiActionButton label="Health score" title={`Health score · ${project.name}`} run={() => projectAi.health(project.id)} />
              <AiActionButton label="Predict delay" title={`Delay prediction · ${project.name}`} run={() => projectAi.delay(project.id)} />
              <AiActionButton label="Explain project" title={`Explain · ${project.name}`} run={() => projectAi.explain(project.id)} />
              <AiActionButton label="Analyse tasks" title={`Task analysis · ${project.name}`} run={() => projectAi.analyseTasks(project.id)} />
              <AiActionButton label="Find duplicates" title={`Duplicate detection · ${project.name}`} run={() => projectAi.duplicates(project.id)} />
              <AiActionButton label="Balance workload" title={`Workload · ${project.name}`} run={() => projectAi.workload(project.id)} />
            </AiActionBar>
          </Box>
        </Box>
        <Paper sx={{ p: 2, borderRadius: 3, width: 220 }}>
          <Typography sx={{ fontSize: 11, color: tokens.text3, mb: 1 }}>Progress</Typography>
          <ProgressBar value={project.progress} />
          <Divider sx={{ my: 1.5 }} />
          <MetaRow label="Owner" value={project.owner_name || "—"} />
          <MetaRow label="Start" value={project.start_date ?? "—"} mono />
          <MetaRow label="Target" value={project.target_date ?? "—"} mono />
        </Paper>
      </Stack>

      {(project.business_objective || project.success_criteria) && (
        <Paper sx={{ p: 2.25, borderRadius: 3, mb: 3 }}>
          {project.business_objective && (
            <Box sx={{ mb: project.success_criteria ? 2 : 0 }}>
              <SectionLabel>Business objective</SectionLabel>
              <Typography sx={{ fontSize: 14 }}>{project.business_objective}</Typography>
            </Box>
          )}
          {project.success_criteria && (
            <Box>
              <SectionLabel>Success criteria</SectionLabel>
              <Typography sx={{ fontSize: 14 }}>{project.success_criteria}</Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* hierarchy */}
      <Typography variant="h3" sx={{ fontSize: 18, mb: 1.5 }}>Epics &amp; milestones</Typography>

      <Stack spacing={1.5}>
        {project.epics.map((epic) => {
          const ms = project.milestones.filter((m) => m.epic === epic.id);
          return (
            <Paper key={epic.id} sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{epic.title}</Typography>
              {epic.description && <Typography sx={{ fontSize: 13, color: tokens.text2, mt: 0.25 }}>{epic.description}</Typography>}
              <Stack spacing={0} sx={{ mt: 1.5 }}>
                {ms.map((m) => <MilestoneRow key={m.id} m={m} />)}
                {ms.length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No milestones.</Typography>}
              </Stack>
            </Paper>
          );
        })}

        {projectMilestones.length > 0 && (
          <Paper sx={{ p: 2.25, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Project milestones</Typography>
            <Stack spacing={0} sx={{ mt: 1.5 }}>
              {projectMilestones.map((m) => <MilestoneRow key={m.id} m={m} />)}
            </Stack>
          </Paper>
        )}

        {project.epics.length === 0 && projectMilestones.length === 0 && (
          <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>
            No epics or milestones yet.
          </Typography>
        )}
      </Stack>

      {/* sprints */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 4, mb: 1.5 }}>
        <Typography variant="h3" sx={{ fontSize: 18 }}>Sprints</Typography>
        {project.sprint_enabled && canManageSprints && (
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setSprintDialogOpen(true)}>New sprint</Button>
        )}
      </Stack>
      {!project.sprint_enabled ? (
        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: canManageSprints ? 1.5 : 0 }}>
            Sprints are not enabled for this project.
          </Typography>
          {canManageSprints && <Button size="small" variant="contained" onClick={enableSprints}>Enable sprints</Button>}
        </Paper>
      ) : sprints.length === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No sprints yet.</Typography>
      ) : (
        <Stack spacing={1}>
          {sprints.map((s) => (
            <Paper key={s.id} onClick={() => navigate(`/sprints/${s.id}`)}
              sx={{ p: 1.5, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5,
                "&:hover": { borderColor: "#DADEE4", boxShadow: "0 8px 24px rgba(20,22,29,.08)" } }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{s.name}</Typography>
              <Chip label={s.status} size="small" sx={{ height: 20, fontSize: 10.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }} />
              {s.is_baselined && <Chip label="baselined" size="small" sx={{ height: 20, fontSize: 10.5, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />}
              <Typography sx={{ fontSize: 11.5, color: tokens.text3, fontFamily: monoFont }}>{s.task_count} tasks</Typography>
            </Paper>
          ))}
        </Stack>
      )}

      {/* tasks */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 4, mb: 1.5 }}>
        <Typography variant="h3" sx={{ fontSize: 18 }}>Tasks <Box component="span" sx={{ color: tokens.text3, fontWeight: 400 }}>· {tasks.length}</Box></Typography>
        {canCreate && (
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setNewTaskOpen(true)}>New task</Button>
        )}
      </Stack>

      {tasks.length === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No tasks yet.</Typography>
      ) : (
        <Stack spacing={1}>
          {tasks.map((t) => (
            <Paper key={t.id} onClick={() => setOpenTask(t.id)}
              sx={{ p: 1.5, borderRadius: 3, cursor: "pointer", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "2px 12px", alignItems: "center",
                "&:hover": { borderColor: "#DADEE4", boxShadow: "0 8px 24px rgba(20,22,29,.08)" } }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: PRIORITY_COLOR[t.priority] }} />
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 550 }}>{t.title}</Typography>
                  <StatusChip label={t.status_label} category={t.category} />
                </Stack>
                <Box sx={{ mt: 0.75, maxWidth: 240 }}><FlowRail category={t.category} /></Box>
              </Box>
              {t.due_date && (
                <Typography sx={{ fontSize: 11.5, fontFamily: monoFont, color: t.is_overdue ? tokens.attn : tokens.text3 }}>{t.due_date}</Typography>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      <TaskDrawer taskId={openTask} open={openTask !== null} onClose={() => setOpenTask(null)} onChanged={loadTasks} />
      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreated={() => { setNewTaskOpen(false); loadTasks(); }}
        defaultProjectId={project.id}
      />
      <NewSprintDialog
        open={sprintDialogOpen}
        projectId={project.id}
        onClose={() => setSprintDialogOpen(false)}
        onCreated={() => { setSprintDialogOpen(false); loadSprints(); }}
      />
    </Box>
  );
}

function MilestoneRow({ m }: { m: Milestone }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ py: 0.9, borderBottom: `1px solid ${tokens.line}` }}>
      <FlagRoundedIcon sx={{ fontSize: 15, color: MILESTONE_COLOR[m.status] }} />
      <Typography sx={{ fontSize: 13.5, flex: 1 }}>{m.title}</Typography>
      {m.due_date && <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3 }}>{m.due_date}</Typography>}
      <Chip label={m.status.replace("_", " ")} size="small" sx={{ height: 20, fontSize: 10.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: MILESTONE_COLOR[m.status] }} />
    </Stack>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.4 }}>
      <Typography sx={{ fontSize: 12, color: tokens.text3 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12.5, fontFamily: mono ? monoFont : undefined }}>{value}</Typography>
    </Stack>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.5 }}>
      {children}
    </Typography>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Stack
      direction="row" alignItems="center" spacing={0.5} onClick={onClick}
      sx={{ cursor: "pointer", color: tokens.text2, width: "fit-content", "&:hover": { color: tokens.kriyaInk } }}
    >
      <ArrowBackRoundedIcon sx={{ fontSize: 17 }} />
      <Typography sx={{ fontSize: 13 }}>Projects</Typography>
    </Stack>
  );
}
