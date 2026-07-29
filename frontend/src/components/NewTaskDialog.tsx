import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";

import { listProjects } from "../features/projects/projectsApi";
import type { ProjectSummary } from "../features/projects/types";
import { createTask } from "../features/tasks/tasksApi";
import type { TaskDetail } from "../features/tasks/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (task: TaskDetail) => void;
  defaultProjectId?: number;
}

export default function NewTaskDialog({ open, onClose, onCreated, defaultProjectId }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<number | "">(defaultProjectId ?? "");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (defaultProjectId) setProject(defaultProjectId);
      else listProjects().then(setProjects).catch(() => setError("Could not load projects."));
    }
  }, [open, defaultProjectId]);

  const submit = async () => {
    if (!project) return;
    setError(null);
    setSaving(true);
    try {
      const task = await createTask({
        title,
        project: Number(project),
        priority,
        due_date: dueDate || undefined,
        deliverable: deliverable || undefined,
      });
      onCreated(task);
      setTitle("");
      setDueDate("");
      setDeliverable("");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Could not create the task.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600 }}>New task</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} size="small" fullWidth required autoFocus />
          {!defaultProjectId && (
            <TextField label="Project" select value={project} onChange={(e) => setProject(Number(e.target.value))} size="small" fullWidth required>
              {projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.code} · {p.name}</MenuItem>
              ))}
            </TextField>
          )}
          <Stack direction="row" spacing={2}>
            <TextField label="Priority" select value={priority} onChange={(e) => setPriority(e.target.value)} size="small" fullWidth>
              {["critical", "high", "medium", "low"].map((p) => (
                <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>
              ))}
            </TextField>
            <TextField label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
          </Stack>
          <TextField label="Deliverable / expected result" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} size="small" fullWidth multiline minRows={2} helperText="What 'done' produces. Required before the task can be completed." />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={saving || !title || !project}>
          {saving ? "Creating…" : "Create task"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
