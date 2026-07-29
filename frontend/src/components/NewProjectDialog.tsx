import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { createFromTemplate, listTemplates } from "../features/projects/projectsApi";
import type { ProjectDetail, ProjectTemplate } from "../features/projects/types";
import { TYPE_LABEL } from "../features/projects/display";
import { tokens } from "../theme";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectDetail) => void;
}

export default function NewProjectDialog({ open, onClose, onCreated }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      listTemplates()
        .then((t) => {
          setTemplates(t);
          if (t[0]) setSelected(t[0].key);
        })
        .catch(() => setError("Could not load templates."));
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const project = await createFromTemplate({
        template: selected,
        name,
        code,
        start_date: startDate || undefined,
        priority,
      });
      onCreated(project);
      reset();
    } catch (e: any) {
      const data = e?.response?.data;
      setError(data?.code?.[0] ?? data?.detail ?? "Could not create the project.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName("");
    setCode("");
    setStartDate("");
    setPriority("medium");
    setError(null);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600 }}>New project</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Typography sx={{ fontSize: 12, color: tokens.text3, mb: 1, mt: 0.5 }}>
          Start from a template — it seeds the epics and milestones for you.
        </Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, mb: 2 }}>
          {templates.map((t) => {
            const active = t.key === selected;
            return (
              <Box
                key={t.key}
                onClick={() => setSelected(t.key)}
                sx={{
                  cursor: "pointer",
                  border: `1.5px solid ${active ? tokens.kriya : tokens.line}`,
                  bgcolor: active ? tokens.kriyaWash : "transparent",
                  borderRadius: 2,
                  p: 1.25,
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{t.name}</Typography>
                <Typography sx={{ fontSize: 11, color: tokens.text3 }}>
                  {TYPE_LABEL[t.project_type]}
                </Typography>
              </Box>
            );
          })}
        </Box>

        <Stack spacing={2}>
          <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth required />
          <Stack direction="row" spacing={2}>
            <TextField label="Project code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} size="small" fullWidth required helperText="e.g. EPA-014" />
            <TextField label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
          </Stack>
          <TextField label="Priority" select value={priority} onChange={(e) => setPriority(e.target.value)} size="small" sx={{ maxWidth: 200 }}>
            {["critical", "high", "medium", "low"].map((p) => (
              <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={saving || !name || !code || !selected}>
          {saving ? "Creating…" : "Create project"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
