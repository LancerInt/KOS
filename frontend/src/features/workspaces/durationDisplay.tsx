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

const fmtDateTime = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function durationText(d: Duration, completedAt?: string | null): string {
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
 *
 * The end is optional — a start may be saved on its own (there's just nothing
 * to count down to, so no progress or reminders until an end is added).
 */
export function DurationPanel({
  duration, completedAt, canEdit, allowSet, onSet, onToggleComplete,
  reviewState = "", reviewReason = "", canApprove = false, onSubmit, onApprove, onReject,
}: {
  duration: Duration;
  completedAt?: string | null;
  canEdit: boolean;
  allowSet: boolean;
  onSet: (startAt: string, endAt: string | null) => Promise<unknown> | void;
  onToggleComplete: () => Promise<unknown> | void;
  /** Approval workflow: "" · "needs_decision" (awaiting) · "blocked" (sent back). */
  reviewState?: "" | "needs_decision" | "blocked";
  reviewReason?: string;
  canApprove?: boolean;
  onSubmit?: () => Promise<unknown> | void;
  onApprove?: () => Promise<unknown> | void;
  onReject?: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const hasDur = duration.status !== "none";
  const startOnly = !hasDur && !!duration.start_at;
  if (!hasDur && !startOnly && !(canEdit && allowSet)) return null;

  // The end is optional; when given it must fall after the start.
  const endBeforeStart = !!start && !!end && new Date(end).getTime() <= new Date(start).getTime();
  const valid = !!start && !endBeforeStart;
  const openDialog = () => {
    setStart(toLocalInput(duration.start_at));
    setEnd(duration.end_at ? toLocalInput(duration.end_at) : "");
    setOpen(true);
  };
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onSet(new Date(start).toISOString(), end ? new Date(end).toISOString() : null);
      setOpen(false);
    } finally { setBusy(false); }
  };
  const toggle = async () => { setBusy(true); try { await onToggleComplete(); } finally { setBusy(false); } };
  const run = (fn?: () => Promise<unknown> | void) => async () => {
    if (!fn) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const completed = duration.status === "completed";

  // The completion path now runs through approval: a non-approver submits for
  // sign-off; an approver (IT/Management) approves (→ complete) or sends back.
  const actions = () => {
    if (completed) return canEdit ? <Button size="small" variant="outlined" onClick={toggle} disabled={busy}>Reopen</Button> : null;
    if (reviewState === "needs_decision")
      return canApprove ? (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" onClick={run(onApprove)} disabled={busy}>Approve</Button>
          <Button size="small" variant="outlined" onClick={run(onReject)} disabled={busy}
            sx={{ color: tokens.text2, borderColor: tokens.line }}>Send back</Button>
        </Stack>
      ) : null;
    if (reviewState === "blocked") return canEdit ? <Button size="small" variant="contained" onClick={run(onSubmit)} disabled={busy}>Resubmit</Button> : null;
    if (canApprove) return <Button size="small" variant={duration.status === "due" ? "contained" : "outlined"} onClick={toggle} disabled={busy}>Mark complete</Button>;
    return canEdit ? <Button size="small" variant={duration.status === "due" ? "contained" : "outlined"} onClick={run(onSubmit)} disabled={busy}>Submit for approval</Button> : null;
  };

  return (
    <Paper sx={{ p: 1.75, borderRadius: "6px" }}>
      {reviewState === "needs_decision" && (
        <Box sx={{ mb: 1.25, display: "inline-flex", alignItems: "center", px: 1, py: 0.45, borderRadius: "6px", bgcolor: "#FAE7F0" }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "#9C2E5E" }}>Awaiting approval — submitted for sign-off</Typography>
        </Box>
      )}
      {reviewState === "blocked" && (
        <Box sx={{ mb: 1.25, px: 1.1, py: 0.65, borderRadius: "6px", bgcolor: "#FBF2DF" }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "#8A5A0F" }}>Sent back for changes</Typography>
          {reviewReason && <Typography sx={{ fontSize: 12, color: "#7a5a12", mt: 0.2 }}>{reviewReason}</Typography>}
        </Box>
      )}
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
          {actions()}
        </Stack>
      ) : startOnly ? (
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: 13, color: tokens.text2 }}>
              Starts {fmtDateTime(duration.start_at!)} · no end set
            </Typography>
            {canEdit && allowSet && (
              <Box component="button" onClick={openDialog}
                sx={{ border: "none", background: "transparent", p: 0, cursor: "pointer", fontSize: 11.5, color: tokens.kriyaInk, fontWeight: 600 }}>
                Edit
              </Box>
            )}
          </Stack>
          {actions()}
        </Stack>
      ) : (
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Typography sx={{ fontSize: 13, color: tokens.text2 }}>Set a duration to be notified when the time is up.</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {actions()}
            <Button size="small" variant="outlined" startIcon={<ScheduleRoundedIcon sx={{ fontSize: 16 }} />} onClick={openDialog}>Set duration</Button>
          </Stack>
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>Set duration</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField size="small" type="datetime-local" label="Starts" InputLabelProps={{ shrink: true }}
              value={start} onChange={(e) => setStart(e.target.value)} fullWidth />
            <TextField size="small" type="datetime-local" label="Ends (optional)" InputLabelProps={{ shrink: true }}
              value={end} onChange={(e) => setEnd(e.target.value)} fullWidth
              error={endBeforeStart} helperText={endBeforeStart ? "The end must be after the start." : ""} />
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>Set the date and time. The end is optional — add one to get reminders as it nears, and if it's overdue.</Typography>
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
