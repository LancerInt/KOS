import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import PlaylistAddCheckRoundedIcon from "@mui/icons-material/PlaylistAddCheckRounded";

import {
  aiErrorMessage,
  createTasksFromDrafts,
  extractTasks,
  summarizeMeeting,
  type MeetingData,
  type TaskDraft,
} from "../features/ai/aiApi";
import { useAiPageContext } from "../features/ai/AiContext";
import { listProjects } from "../features/projects/projectsApi";
import type { ProjectSummary } from "../features/projects/types";
import { useAppSelector } from "../hooks";
import { tokens } from "../theme";

/**
 * Meetings & notes.
 *
 * Paste raw notes and get back the summary, decisions and action items — then
 * turn those action items into real KOS tasks.
 *
 * The two-step flow is the point: extraction produces *drafts* that the user
 * edits and de-selects before anything is written. A meeting note is far too
 * noisy a source to create tasks from automatically.
 */

const PRIORITIES = ["low", "medium", "high", "critical"];

interface EditableDraft extends TaskDraft {
  selected: boolean;
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: tokens.text3, mb: 0.75 }}>
        {title}
      </Typography>
      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
        {items.map((item, index) => (
          <Typography key={index} component="li" sx={{ fontSize: 13.5, lineHeight: 1.6 }}>
            {item}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

export default function MeetingNotesPage() {
  const navigate = useNavigate();
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canCreateTasks = "create_tasks" in caps || "administer" in caps;

  const [notes, setNotes] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");

  const [summary, setSummary] = useState<MeetingData | null>(null);
  const [drafts, setDrafts] = useState<EditableDraft[] | null>(null);
  const [busy, setBusy] = useState<"summary" | "tasks" | "create" | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: number; title: string }[] | null>(null);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useAiPageContext(
    useMemo(
      () =>
        notes.trim()
          ? { label: "Meeting notes", text: `Meeting notes being written:\n${notes.slice(0, 4000)}`, projectId: projectId || undefined }
          : { label: "Meeting notes", text: "The user is on the meeting notes screen with nothing written yet." },
      [notes, projectId],
    ),
  );

  const run = async (kind: "summary" | "tasks") => {
    if (!notes.trim()) return;
    setBusy(kind);
    setError("");
    setCreated(null);
    try {
      if (kind === "summary") {
        const outcome = await summarizeMeeting(notes, { project_id: projectId || undefined });
        setSummary(outcome.data);
      } else {
        const outcome = await extractTasks(notes, { project_id: projectId || undefined });
        setDrafts((outcome.data.tasks ?? []).map((task) => ({ ...task, selected: true })));
      }
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (index: number, patch: Partial<EditableDraft>) =>
    setDrafts((prev) => prev?.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)) ?? prev);

  const createTasks = async () => {
    if (!projectId || !drafts) return;
    const chosen = drafts.filter((d) => d.selected && d.title.trim());
    if (!chosen.length) return;

    setBusy("create");
    setError("");
    try {
      const result = await createTasksFromDrafts(
        Number(projectId),
        chosen.map(({ selected, ...task }) => {
          void selected;
          return task;
        }),
      );
      setCreated(result.tasks);
      setDrafts(null);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const selectedCount = drafts?.filter((d) => d.selected).length ?? 0;

  return (
    <Box sx={{ maxWidth: 980, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 26 }}>
        Meetings &amp; notes
      </Typography>
      <Typography sx={{ fontSize: 13.5, color: tokens.text2, mt: 0.5, mb: 3 }}>
        Paste raw notes to get a summary, the decisions taken and the action items — then turn those
        actions into tasks.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2.5, borderRadius: "6px", mb: 2 }}>
        <TextField
          fullWidth
          multiline
          minRows={8}
          placeholder={
            "Paste your meeting notes here…\n\ne.g. Discussed the effluent upgrade. Priya to submit the consent renewal by Friday. " +
            "Agreed to defer the pump replacement to Q3. Open question: who signs off the discharge report?"
          }
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          sx={{ "& .MuiOutlinedInput-root": { fontSize: 14 } }}
        />

        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          <TextField
            select
            size="small"
            label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value === "" ? "" : Number(e.target.value))}
            sx={{ minWidth: 240 }}
            helperText="Needed to create tasks; also grounds the AI"
          >
            <MenuItem value="">No project</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} value={project.id}>
                {project.code} · {project.name}
              </MenuItem>
            ))}
          </TextField>

          <Button
            variant="outlined"
            startIcon={busy === "summary" ? <CircularProgress size={14} /> : <AutoAwesomeRoundedIcon />}
            onClick={() => run("summary")}
            disabled={!notes.trim() || busy !== null}
          >
            Summarise
          </Button>
          <Button
            variant="contained"
            startIcon={busy === "tasks" ? <CircularProgress size={14} color="inherit" /> : <PlaylistAddCheckRoundedIcon />}
            onClick={() => run("tasks")}
            disabled={!notes.trim() || busy !== null}
          >
            Extract tasks
          </Button>
        </Stack>
      </Paper>

      {created && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Created {created.length} task{created.length === 1 ? "" : "s"}.{" "}
          {projectId !== "" && (
            <Button size="small" onClick={() => navigate(`/projects/${projectId}`)}>
              Open project
            </Button>
          )}
        </Alert>
      )}

      {summary && (
        <Paper sx={{ p: 2.5, borderRadius: "6px", mb: 2 }}>
          <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 16, mb: 1.5 }}>
            Meeting summary
          </Typography>
          <Stack spacing={2} divider={<Divider flexItem />}>
            {summary.summary && (
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {summary.summary}
              </Typography>
            )}
            <Bullets title="Decisions" items={summary.decisions ?? []} />
            {(summary.action_items ?? []).length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: tokens.text3, mb: 0.75 }}>
                  Action items
                </Typography>
                <Stack spacing={0.75}>
                  {summary.action_items.map((item, index) => (
                    <Box key={index} sx={{ p: 1.25, bgcolor: tokens.paper, borderRadius: "6px", border: `1px solid ${tokens.line}` }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{item.action}</Typography>
                      {(item.owner || Number(item.due_in_days) > 0) && (
                        <Typography sx={{ fontSize: 12, color: tokens.text2, mt: 0.25 }}>
                          {item.owner && `Owner: ${item.owner}`}
                          {item.owner && Number(item.due_in_days) > 0 && " · "}
                          {Number(item.due_in_days) > 0 && `Due in ${item.due_in_days} days`}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
            <Bullets title="Attendees mentioned" items={summary.attendees ?? []} />
            <Bullets title="Open questions" items={summary.open_questions ?? []} />
          </Stack>
        </Paper>
      )}

      {drafts && (
        <Paper sx={{ p: 2.5, borderRadius: "6px" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 16 }}>
              Proposed tasks
            </Typography>
            <Chip size="small" label={`${selectedCount} of ${drafts.length} selected`} />
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: tokens.text2, mb: 2 }}>
            Nothing has been created yet. Edit, de-select, then create the ones you want.
          </Typography>

          {drafts.length === 0 && (
            <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>
              No actionable tasks were found in these notes.
            </Typography>
          )}

          <Stack spacing={1.5}>
            {drafts.map((draft, index) => (
              <Box
                key={index}
                sx={{
                  p: 1.75,
                  borderRadius: "6px",
                  border: `1px solid ${tokens.line}`,
                  bgcolor: draft.selected ? tokens.surface : tokens.paper,
                  opacity: draft.selected ? 1 : 0.55,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Checkbox
                    size="small"
                    checked={draft.selected}
                    onChange={(e) => updateDraft(index, { selected: e.target.checked })}
                    sx={{ mt: -0.5 }}
                  />
                  <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      size="small" fullWidth variant="standard" value={draft.title}
                      onChange={(e) => updateDraft(index, { title: e.target.value })}
                      inputProps={{ style: { fontSize: 14, fontWeight: 600 } }}
                    />
                    <TextField
                      size="small" fullWidth multiline maxRows={4} label="Description"
                      value={draft.description ?? ""}
                      onChange={(e) => updateDraft(index, { description: e.target.value })}
                      sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
                    />
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                      <TextField
                        select size="small" label="Priority" value={PRIORITIES.includes(draft.priority) ? draft.priority : "medium"}
                        onChange={(e) => updateDraft(index, { priority: e.target.value })}
                        sx={{ width: 130 }}
                      >
                        {PRIORITIES.map((priority) => (
                          <MenuItem key={priority} value={priority} sx={{ textTransform: "capitalize" }}>
                            {priority}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        size="small" type="number" label="Due in (days)" value={draft.due_in_days ?? 0}
                        onChange={(e) => updateDraft(index, { due_in_days: Number(e.target.value) })}
                        sx={{ width: 140 }}
                      />
                      <TextField
                        size="small" label="Suggested owner" value={draft.owner_hint ?? ""}
                        onChange={(e) => updateDraft(index, { owner_hint: e.target.value })}
                        sx={{ width: 200 }}
                        helperText="Applied only if they are a project member"
                      />
                    </Stack>
                    {(draft.subtasks ?? []).length > 0 && (
                      <Typography sx={{ fontSize: 12, color: tokens.text3 }}>
                        Subtasks: {draft.subtasks.join(" · ")}
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>

          {drafts.length > 0 && (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2.5 }}>
              <Button
                variant="contained"
                onClick={createTasks}
                disabled={!projectId || !selectedCount || busy !== null || !canCreateTasks}
                >
                {busy === "create" ? "Creating…" : `Create ${selectedCount} task${selectedCount === 1 ? "" : "s"}`}
              </Button>
              <Button onClick={() => setDrafts(null)} disabled={busy !== null}>
                Discard
              </Button>
              {!projectId && (
                <Typography sx={{ fontSize: 12.5, color: tokens.text2 }}>Choose a project first.</Typography>
              )}
              {!canCreateTasks && (
                <Typography sx={{ fontSize: 12.5, color: tokens.text2 }}>
                  You do not have permission to create tasks.
                </Typography>
              )}
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}
