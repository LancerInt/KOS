import { useState } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography,
} from "@mui/material";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import type { SvgIconComponent } from "@mui/icons-material";

import type { Duration, DurationStatus } from "./projectsApi";
import { tokens } from "../../theme";

interface Meta { label: (d: Duration) => string; fg: string; bg: string; Icon: SvgIconComponent; }

const META: Record<Exclude<DurationStatus, "none">, Meta> = {
  active: {
    label: (d) => (d.left_label ? `${d.left_label} left` : "In progress"),
    fg: tokens.kriyaInk, bg: tokens.kriyaWash, Icon: ScheduleRoundedIcon,
  },
  ending_soon: {
    label: (d) => (d.left_label ? `${d.left_label} left` : "Ending soon"),
    fg: "#B4671E", bg: "#FBEFE7", Icon: ScheduleRoundedIcon,
  },
  due: {
    label: () => "Duration complete",
    fg: tokens.attn, bg: tokens.attnWash, Icon: NotificationsActiveRoundedIcon,
  },
  completed: {
    label: () => "Completed",
    fg: "#1F7A4D", bg: "#E7F5EE", Icon: CheckCircleRoundedIcon,
  },
};

/** A compact status pill for a timed duration. Renders nothing when none is set. */
export function DurationChip({ duration }: { duration: Duration }) {
  if (!duration || duration.status === "none") return null;
  const m = META[duration.status];
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}
      sx={{ px: 0.9, py: 0.3, borderRadius: "5px", bgcolor: m.bg, color: m.fg, alignSelf: "flex-start" }}>
      <m.Icon sx={{ fontSize: 13 }} />
      <Typography sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>{m.label(duration)}</Typography>
    </Stack>
  );
}

/** A thin progress bar showing elapsed vs total duration. */
export function DurationBar({ duration }: { duration: Duration }) {
  if (!duration || duration.status === "none") return null;
  const pct = duration.status === "completed" || duration.status === "due" ? 100
    : duration.pct ?? 0;
  const color = duration.status === "completed" ? "#2FA36B"
    : duration.status === "due" ? tokens.attn
    : duration.status === "ending_soon" ? "#E0A83D"
    : tokens.kriya;
  return (
    <Box sx={{ height: 6, borderRadius: 3, bgcolor: tokens.line, overflow: "hidden" }}>
      <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: color, transition: "width .3s" }} />
    </Box>
  );
}

export function durationText(d: Duration, completedAt?: string | null): string {
  const fmtDateTime = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const end = d.end_label ?? (d.end_at ? fmtDateTime(d.end_at) : "");
  if (d.status === "completed") return completedAt ? `Completed ${fmtDateTime(completedAt)}` : "Completed";
  if (d.status === "due") return `Ended ${end} · awaiting completion`;
  return `${d.left_label ?? ""} left · ends ${end}`;
}

/** ISO datetime → the value a <input type="datetime-local"> expects (local, no tz). */
function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A self-contained duration control: shows status + progress + Mark complete
 * when a duration is set, or a "Set duration" prompt when it isn't (and the
 * user may set one). Durations are to the hour. Manages its own set/edit dialog.
 */
export function DurationPanel({
  duration, completedAt, canEdit, allowSet, onSet, onToggleComplete,
}: {
  duration: Duration;
  completedAt?: string | null;
  canEdit: boolean;
  allowSet: boolean;
  onSet: (startAt: string, endAt: string) => Promise<unknown> | void;
  onToggleComplete: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const hasDur = duration.status !== "none";
  if (!hasDur && !(canEdit && allowSet)) return null;

  const valid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const openDialog = () => {
    setStart(toLocalInput(duration.start_at));
    setEnd(duration.end_at ? toLocalInput(duration.end_at) : "");
    setOpen(true);
  };
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try { await onSet(new Date(start).toISOString(), new Date(end).toISOString()); setOpen(false); } finally { setBusy(false); }
  };
  const toggle = async () => { setBusy(true); try { await onToggleComplete(); } finally { setBusy(false); } };

  return (
    <Paper sx={{ p: 1.75, borderRadius: "6px" }}>
      {hasDur ? (
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
              <DurationChip duration={duration} />
              <Typography sx={{ fontSize: 12, color: tokens.text3 }}>{durationText(duration, completedAt)}</Typography>
              {canEdit && allowSet && (
                <Box component="button" onClick={openDialog}
                  sx={{ border: "none", background: "transparent", p: 0, cursor: "pointer", fontSize: 11.5, color: tokens.kriyaInk, fontWeight: 600 }}>
                  Edit
                </Box>
              )}
            </Stack>
            <Box sx={{ mt: 1 }}><DurationBar duration={duration} /></Box>
          </Box>
          {canEdit && (
            <Button size="small" variant={duration.status === "due" ? "contained" : "outlined"} onClick={toggle} disabled={busy}>
              {duration.status === "completed" ? "Reopen" : "Mark complete"}
            </Button>
          )}
        </Stack>
      ) : (
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Typography sx={{ fontSize: 13, color: tokens.text2 }}>Set a duration to be notified when the time is up.</Typography>
          <Button size="small" variant="outlined" startIcon={<ScheduleRoundedIcon sx={{ fontSize: 16 }} />} onClick={openDialog}>Set duration</Button>
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>Set duration</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField size="small" type="datetime-local" label="Starts" InputLabelProps={{ shrink: true }}
              value={start} onChange={(e) => setStart(e.target.value)} fullWidth />
            <TextField size="small" type="datetime-local" label="Ends" InputLabelProps={{ shrink: true }}
              value={end} onChange={(e) => setEnd(e.target.value)} fullWidth />
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>Set the date and time. You'll get reminders as the end nears, and if it's overdue.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!valid || busy}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
