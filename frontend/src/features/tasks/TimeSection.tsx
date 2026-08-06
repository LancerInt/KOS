import { useState } from "react";
import { Box, Button, IconButton, Stack, TextField, Typography } from "@mui/material";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";

import { patchTask } from "./tasksApi";
import { deleteTimeEntry, formatMinutes, logTime } from "./timeApi";
import type { TaskDetail } from "./types";
import { useAppSelector } from "../../hooks";
import { tokens, monoFont } from "../../theme";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Time-tracking panel for a task: estimate vs. logged, entries, and a log form. */
export default function TimeSection({ task, onChanged }: { task: TaskDetail; onChanged: () => void }) {
  const uid = useAppSelector((s) => s.auth.user?.id);
  const [hours, setHours] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [est, setEst] = useState(task.estimate_minutes ? String(task.estimate_minutes / 60) : "");
  const [busy, setBusy] = useState(false);

  const logged = task.logged_minutes ?? 0;
  const estimate = task.estimate_minutes ?? 0;
  const pct = estimate ? Math.min(100, Math.round((logged * 100) / estimate)) : 0;

  const doLog = async () => {
    const h = parseFloat(hours);
    if (!h || h <= 0 || busy) return;
    setBusy(true);
    try {
      await logTime(task.id, Math.round(h * 60), date, note.trim());
      setHours(""); setNote("");
      onChanged();
    } finally { setBusy(false); }
  };

  const saveEstimate = async () => {
    const h = parseFloat(est);
    await patchTask(task.id, { estimate_minutes: h > 0 ? Math.round(h * 60) : null });
    onChanged();
  };

  const remove = async (id: number) => { await deleteTimeEntry(id); onChanged(); };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: estimate ? 0.75 : 1.25 }}>
        <Typography sx={{ fontSize: 13 }}>
          <b>{formatMinutes(logged)}</b> logged{estimate ? ` of ${formatMinutes(estimate)} · ${pct}%` : ""}
        </Typography>
        {estimate > 0 && logged > estimate && (
          <Typography sx={{ fontSize: 11.5, color: tokens.attn, fontWeight: 600 }}>over estimate</Typography>
        )}
      </Stack>
      {estimate > 0 && (
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: "#EEF0F3", mb: 1.25, overflow: "hidden" }}>
          <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: pct >= 100 ? tokens.attn : tokens.kriya }} />
        </Box>
      )}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
        <Typography sx={{ fontSize: 12.5, color: tokens.text3, minWidth: 60 }}>Estimate</Typography>
        <TextField size="small" type="number" value={est} onChange={(e) => setEst(e.target.value)}
          placeholder="hours" sx={{ width: 110 }} inputProps={{ step: 0.25, min: 0 }} />
        <Button size="small" onClick={saveEstimate}>Save</Button>
      </Stack>

      <Stack spacing={0.5} sx={{ mb: 1.25 }}>
        {(task.time_entries ?? []).map((e) => (
          <Stack key={e.id} direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontSize: 12.5, fontFamily: monoFont, minWidth: 64 }}>{formatMinutes(e.minutes)}</Typography>
            <Typography sx={{ fontSize: 12.5, color: tokens.text2, flex: 1 }} noWrap>
              {e.user_detail?.full_name || e.user_detail?.username} · {e.spent_on}{e.note ? ` · ${e.note}` : ""}
            </Typography>
            {e.user === uid && (
              <IconButton size="small" onClick={() => remove(e.id)}>
                <DeleteOutlineRoundedIcon sx={{ fontSize: 15, color: tokens.text3 }} />
              </IconButton>
            )}
          </Stack>
        ))}
        {(task.time_entries ?? []).length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No time logged yet.</Typography>
        )}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField size="small" type="number" value={hours} onChange={(e) => setHours(e.target.value)}
          placeholder="hours" sx={{ width: 96 }} inputProps={{ step: 0.25, min: 0 }} />
        <TextField size="small" type="date" value={date} onChange={(e) => setDate(e.target.value)} sx={{ width: 150 }} />
        <TextField size="small" value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" sx={{ flex: 1 }} />
        <Button variant="contained" onClick={doLog} disabled={busy || !parseFloat(hours)}>Log</Button>
      </Stack>
    </Box>
  );
}
