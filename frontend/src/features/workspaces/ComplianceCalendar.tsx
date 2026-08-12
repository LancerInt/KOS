import { useEffect, useState } from "react";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import EditCalendarRoundedIcon from "@mui/icons-material/EditCalendarRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";

import {
  listComplianceDeadlines, fileDeadline, unfileDeadline, updateDeadlineDueDate,
  type ComplianceDeadline,
} from "./complianceApi";
import { tokens, monoFont } from "../../theme";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

const CADENCE_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

function countdown(n: number): string {
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  return `Due in ${n} days`;
}

/** The colour + status line for a deadline, by urgency. */
function tone(d: ComplianceDeadline): { fg: string; bg: string; label: string } {
  if (d.status === "filed") return { fg: "#1E7A50", bg: "#E7F4EC", label: `Filed ${fmtDate(d.filed_at)}` };
  if (d.days_left < 0) return { fg: tokens.attn, bg: tokens.attnWash, label: `Overdue by ${Math.abs(d.days_left)} day${Math.abs(d.days_left) === 1 ? "" : "s"}` };
  if (d.days_left <= d.lead_days) return { fg: "#9A6A16", bg: "#FBF2DF", label: countdown(d.days_left) };
  return { fg: tokens.text2, bg: "#EEF0F3", label: countdown(d.days_left) };
}

/**
 * Statutory-compliance calendar for a workspace (Finance & Statutory): the
 * recurring GST/TDS filings, each with a due date and a countdown, that remind
 * ahead of time. Renders nothing for a workspace that has no obligations, so it
 * only appears where it's seeded.
 */
export function ComplianceCalendar({ workspace, canEdit }: { workspace: string; canEdit: boolean }) {
  const [items, setItems] = useState<ComplianceDeadline[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<ComplianceDeadline | null>(null);
  const [editDate, setEditDate] = useState("");

  const load = () => listComplianceDeadlines(workspace).then(setItems).catch(() => setItems([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workspace]);

  if (!items || items.length === 0) return null;

  const pending = items.filter((d) => d.status === "pending").sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const filed = items.filter((d) => d.status === "filed").sort((a, b) => (a.due_date > b.due_date ? -1 : 1)).slice(0, 6);
  const dueSoon = pending.filter((d) => d.days_left <= d.lead_days).length;

  const run = (id: number, p: Promise<unknown>) => { setBusy(id); p.then(load).finally(() => setBusy(null)); };
  const doFile = (d: ComplianceDeadline) => run(d.id, fileDeadline(d.id));
  const doUnfile = (d: ComplianceDeadline) => run(d.id, unfileDeadline(d.id));
  const openEdit = (d: ComplianceDeadline) => { setEditing(d); setEditDate(d.due_date); };
  const saveEdit = () => {
    if (!editing || !editDate) return;
    updateDeadlineDueDate(editing.id, editDate).then(() => { setEditing(null); load(); }).catch(() => {});
  };

  return (
    <Paper sx={{ borderRadius: "12px", overflow: "hidden", mt: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${tokens.line}` }}>
        <Box sx={{ width: 30, height: 30, borderRadius: "8px", display: "grid", placeItems: "center", bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
          <GavelRoundedIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 15 }}>Statutory compliance</Typography>
          <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>Recurring GST &amp; TDS filings — reminders go out a few days before each due date.</Typography>
        </Box>
        {dueSoon > 0 && (
          <Chip size="small" label={`${dueSoon} due soon`} sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: "#FBF2DF", color: "#9A6A16" }} />
        )}
      </Stack>

      {/* Pending — the calendar that matters */}
      <Box>
        {pending.map((d, i) => {
          const t = tone(d);
          return (
            <Stack key={d.id} direction="row" alignItems="center" spacing={1.5}
              sx={{ px: 2, py: 1.25, borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: t.fg, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flexWrap: "wrap" }} useFlexGap>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: tokens.ink }}>{d.obligation_name}</Typography>
                  <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>· {d.period_label}</Typography>
                  <Box component="span" sx={{ fontFamily: monoFont, fontSize: 9.5, fontWeight: 600, px: 0.6, py: 0.1, borderRadius: "4px", bgcolor: "#EEF0F3", color: tokens.text2 }}>
                    {CADENCE_LABEL[d.cadence] ?? d.cadence}
                  </Box>
                </Stack>
                <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.15 }}>Due {fmtDate(d.due_date)}</Typography>
              </Box>
              <Box sx={{ px: 0.9, py: 0.3, borderRadius: "6px", bgcolor: t.bg, flexShrink: 0 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: t.fg, whiteSpace: "nowrap" }}>{t.label}</Typography>
              </Box>
              {canEdit && (
                <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexShrink: 0 }}>
                  <Tooltip title="Change due date (extension)">
                    <IconButton size="small" onClick={() => openEdit(d)}>
                      <EditCalendarRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                    </IconButton>
                  </Tooltip>
                  <Button size="small" variant="outlined" disabled={busy === d.id} onClick={() => doFile(d)}
                    sx={{ minWidth: 0, fontSize: 11.5, py: 0.25 }}>Mark filed</Button>
                </Stack>
              )}
            </Stack>
          );
        })}
        {pending.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: tokens.text3, px: 2, py: 2, textAlign: "center" }}>
            Nothing pending — all caught up.
          </Typography>
        )}
      </Box>

      {/* Recently filed — muted footer */}
      {filed.length > 0 && (
        <Box sx={{ px: 2, py: 1.25, borderTop: `1px solid ${tokens.line}`, bgcolor: "#FBFCFB" }}>
          <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.75 }}>
            Recently filed
          </Typography>
          <Stack spacing={0.5}>
            {filed.map((d) => (
              <Stack key={d.id} direction="row" alignItems="center" spacing={1}>
                <CheckCircleRoundedIcon sx={{ fontSize: 14, color: "#1E7A50", flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, color: tokens.text2, flex: 1, minWidth: 0 }} noWrap>
                  {d.obligation_name} · {d.period_label}
                  {d.filed_by_name ? ` — ${d.filed_by_name}` : ""}
                </Typography>
                <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3, flexShrink: 0 }}>{fmtDate(d.filed_at)}</Typography>
                {canEdit && (
                  <Tooltip title="Reopen (mark not filed)">
                    <IconButton size="small" disabled={busy === d.id} onClick={() => doUnfile(d)} sx={{ flexShrink: 0 }}>
                      <ReplayRoundedIcon sx={{ fontSize: 14, color: tokens.text3 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      {/* Change-due-date dialog */}
      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 18 }}>
          {editing ? `${editing.obligation_name} — ${editing.period_label}` : ""}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: tokens.text3, mb: 1.5 }}>
            Shift the due date if the government has extended this filing.
          </Typography>
          <TextField type="date" size="small" fullWidth label="Due date" InputLabelProps={{ shrink: true }}
            value={editDate} onChange={(e) => setEditDate(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={!editDate}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
