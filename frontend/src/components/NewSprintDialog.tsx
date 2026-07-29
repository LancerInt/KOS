import { useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from "@mui/material";

import { createSprint, type Sprint } from "../features/agile/agileApi";

interface Props {
  open: boolean;
  projectId: number;
  onClose: () => void;
  onCreated: (sprint: Sprint) => void;
}

export default function NewSprintDialog({ open, projectId, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const sprint = await createSprint({
        project: projectId, name, objective: objective || undefined,
        start_date: start || undefined, end_date: end || undefined,
      });
      onCreated(sprint);
      setName(""); setObjective(""); setStart(""); setEnd("");
    } catch (e: any) {
      setError(e?.response?.data?.project?.[0] ?? e?.response?.data?.detail ?? "Could not create the sprint.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600 }}>New sprint</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Sprint name" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth required autoFocus placeholder="Sprint 1" />
          <TextField label="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} size="small" fullWidth multiline minRows={2} />
          <Stack direction="row" spacing={2}>
            <TextField label="Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
            <TextField label="End" type="date" value={end} onChange={(e) => setEnd(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={saving || !name}>{saving ? "Creating…" : "Create sprint"}</Button>
      </DialogActions>
    </Dialog>
  );
}
