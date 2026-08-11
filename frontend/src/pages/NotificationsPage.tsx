import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Chip, CircularProgress, IconButton, Paper, Snackbar, Stack, TextField, Tooltip, Typography } from "@mui/material";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import RuleRoundedIcon from "@mui/icons-material/RuleRounded";
import AssignmentTurnedInRoundedIcon from "@mui/icons-material/AssignmentTurnedInRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import type { SvgIconComponent } from "@mui/icons-material";

import {
  acknowledge, dismissNotification, getPreferences, listNotifications,
  markAllRead, markRead, updatePreferences, type Notification, type Preferences,
} from "../features/notifications/notificationsApi";
import { approveProject, rejectProject } from "../features/workspaces/projectsApi";
import { getWorkspace } from "../features/workspaces/workspaces";
import { workspaceAccent } from "../features/workspaces/accent";
import { tokens, monoFont } from "../theme";

interface EventMeta { Icon: SvgIconComponent; fg: string; bg: string; label: string; }
const EVENT_META: Record<string, EventMeta> = {
  overdue: { Icon: WarningAmberRoundedIcon, fg: tokens.attn, bg: tokens.attnWash, label: "Overdue" },
  overdue_ack: { Icon: WarningAmberRoundedIcon, fg: tokens.attn, bg: tokens.attnWash, label: "Needs acknowledgement" },
  duration_complete: { Icon: NotificationsActiveRoundedIcon, fg: "#9A6A16", bg: "#FBF2DF", label: "Duration complete" },
  due_soon: { Icon: AccessTimeRoundedIcon, fg: tokens.kriyaInk, bg: tokens.kriyaWash, label: "Due soon" },
  completed: { Icon: CheckCircleRoundedIcon, fg: "#1E7A50", bg: "#E7F4EC", label: "Completed" },
  ack_received: { Icon: CheckCircleRoundedIcon, fg: tokens.kriyaInk, bg: tokens.kriyaWash, label: "Acknowledgement received" },
  review_requested: { Icon: RuleRoundedIcon, fg: "#9C2E5E", bg: "#FAE7F0", label: "Approval needed" },
  review_decision: { Icon: AssignmentTurnedInRoundedIcon, fg: "#1E7A50", bg: "#E7F4EC", label: "Approval update" },
  direct_message: { Icon: ForumRoundedIcon, fg: tokens.kriyaInk, bg: tokens.kriyaWash, label: "Direct message" },
};
function eventMeta(ev: string): EventMeta {
  return EVENT_META[ev] ?? { Icon: NotificationsActiveRoundedIcon, fg: tokens.kriyaInk, bg: tokens.kriyaWash, label: (ev || "update").replace(/_/g, " ") };
}

function workspaceKeyOf(n: Notification): string | null {
  const m = /^\/workspaces\/([^/]+)/.exec(n.url || "");
  return m ? m[1] : null;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function WsChip({ n }: { n: Notification }) {
  const key = workspaceKeyOf(n);
  const ws = key ? getWorkspace(key) : undefined;
  if (!ws || !key) return null;
  const acc = workspaceAccent(key);
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontFamily: monoFont, fontSize: 10, fontWeight: 600, px: 0.75, py: 0.15, borderRadius: "5px", bgcolor: acc.soft, color: acc.ink }}>
      <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: acc.base }} />
      {ws.label}
    </Box>
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [ackDraft, setAckDraft] = useState<Record<number, string>>({});
  // Per-approval button state so a click reads "Approving…" → "Approved ✓"
  // (and "Sending…" → "Sent back") before the card clears on reload.
  const [pending, setPending] = useState<Record<number, "approving" | "approved" | "rejecting" | "sent">>({});
  const [toast, setToast] = useState<string | null>(null);
  // Always compact — a long list stays readable without running far down the page.
  const dense = true;

  const load = () =>
    listNotifications()
      .then((rows) => {
        setItems(rows);
        // Tell the sidebar badge to re-read — reading here doesn't change the
        // route, so it would otherwise stay stale until the next navigation.
        window.dispatchEvent(new Event("kos:notifications-changed"));
      })
      .catch(() => setItems([]));
  useEffect(() => { load(); getPreferences().then(setPrefs).catch(() => {}); }, []);

  const savePref = (patch: Partial<Preferences>) => { updatePreferences(patch).then(setPrefs).catch(() => {}); };

  const doAck = (id: number) => {
    const msg = (ackDraft[id] || "").trim();
    if (!msg) return;
    acknowledge(id, msg).then(() => { setAckDraft((d) => ({ ...d, [id]: "" })); load(); }).catch(() => {});
  };

  const dismiss = (id: number) => { dismissNotification(id).then(load).catch(() => {}); };

  // An approval request is an action item too — the approver must respond, not
  // just read it. It carries the project URL, from which we recover the id.
  const isApproval = (n: Notification) => n.event === "review_requested";
  const projectIdOf = (n: Notification): number | null => {
    const m = /\/projects\/(\d+)/.exec(n.url || "");
    return m ? Number(m[1]) : null;
  };
  const clearPending = (nid: number) => setPending((p) => { const q = { ...p }; delete q[nid]; return q; });
  // A stale request — the project was completed or removed elsewhere, so the
  // endpoint 404s (gone) or 400s (already done). Clear the dead card instead of
  // failing silently; any other error just re-enables the buttons to retry.
  const onActionError = (n: Notification, e: unknown) => {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 400 || status === 410) {
      setToast("That project is no longer awaiting approval — removed from your queue.");
      dismissNotification(n.id).then(load).catch(() => clearPending(n.id));
    } else {
      setToast("Couldn't complete that — please try again.");
      clearPending(n.id);
    }
  };
  // Approving / blocking here changes a project's state, so tell the Dashboard
  // (and anything else showing projects) to re-read — otherwise it stays stale
  // until it's remounted.
  const projectsChanged = () => window.dispatchEvent(new Event("kos:projects-changed"));
  const doApprove = (n: Notification) => {
    const id = projectIdOf(n);
    if (!id || pending[n.id]) return;
    setPending((p) => ({ ...p, [n.id]: "approving" }));
    approveProject(id)
      // Show "Approved ✓" briefly, then reload — the item is gone server-side.
      .then(() => { setPending((p) => ({ ...p, [n.id]: "approved" })); projectsChanged(); setTimeout(load, 850); })
      .catch((e) => onActionError(n, e));
  };
  const doReject = (n: Notification) => {
    const id = projectIdOf(n);
    if (!id || pending[n.id]) return;
    const reason = (window.prompt("What needs to change? The project is blocked and the owner is notified.") || "").trim();
    if (!reason) return;
    setPending((p) => ({ ...p, [n.id]: "rejecting" }));
    rejectProject(id, reason)
      .then(() => { setPending((p) => ({ ...p, [n.id]: "sent" })); projectsChanged(); setTimeout(load, 850); })
      .catch((e) => onActionError(n, e));
  };

  const openTarget = (n: Notification): string | null => {
    // Approval items open the project itself; others open the workspace.
    if (isApproval(n)) return n.url && n.url !== "/" ? n.url : null;
    const key = workspaceKeyOf(n);
    if (key) return `/workspaces/${key}`;
    return n.url && n.url !== "/" ? n.url : null;
  };

  const actions = useMemo(() => (items ?? []).filter((n) => n.needs_acknowledgement || isApproval(n)), [items]);
  const updates = useMemo(() => (items ?? []).filter((n) => !n.needs_acknowledgement && !isApproval(n)), [items]);
  const unread = updates.filter((n) => !n.is_read).length;

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Box>
        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 2.5 }} gap={2} flexWrap="wrap">
          <Box>
            <Typography variant="h1" sx={{ fontSize: 28 }}>Notifications</Typography>
            <Typography sx={{ mt: 0.4, fontSize: 13.5, color: tokens.text2 }}>
              {items
                ? <><b style={{ color: actions.length ? tokens.attn : tokens.text }}>{actions.length}</b> need action · <b style={{ color: tokens.text }}>{unread}</b> unread update{unread === 1 ? "" : "s"}</>
                : "Loading…"}
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            {prefs && (
              <Segmented
                value={prefs.email_enabled ? "on" : "off"}
                onChange={(v) => savePref({ email_enabled: v === "on" })}
                options={[{ key: "on", label: "Email on" }, { key: "off", label: "Email off" }]}
              />
            )}
            {updates.some((n) => !n.is_read) && <Button size="small" onClick={() => markAllRead().then(load)}>Mark all read</Button>}
          </Stack>
        </Stack>

        {!items && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>}

        {items && items.length === 0 && (
          <Paper sx={{ p: 5, textAlign: "center", borderRadius: "10px" }}>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>All caught up</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>No notifications right now.</Typography>
          </Paper>
        )}

        {/* ---------- NEEDS YOUR ACTION ---------- */}
        {items && items.length > 0 && (
          <>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
              <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 15, fontWeight: 700 }}>Needs your action</Typography>
              <Box component="span" sx={{ fontFamily: monoFont, fontSize: 11, px: 0.9, py: 0.15, borderRadius: "20px", bgcolor: actions.length ? tokens.attnWash : "#EEF0F3", color: actions.length ? tokens.attn : tokens.text2 }}>{actions.length}</Box>
            </Stack>

            {actions.length === 0 ? (
              <Paper sx={{ p: 2.5, textAlign: "center", borderRadius: "11px", borderStyle: "dashed", mb: 3.5 }}>
                <Typography sx={{ fontSize: 13, color: tokens.text3 }}>Nothing needs a response right now.</Typography>
              </Paper>
            ) : (
              <Stack spacing={dense ? 0.75 : 1.25} sx={{ mb: dense ? 2.5 : 3.5 }}>
                {actions.map((n) => {
                  const m = eventMeta(n.event);
                  const target = openTarget(n);
                  const approval = isApproval(n);
                  // Approvals get a calm review accent; the 48h acknowledgement
                  // stays the urgent red alarm.
                  const edge = approval ? "#C0417A" : tokens.attn;
                  const cardBorder = approval ? "#EBC3D6" : "#F2C9BC";
                  const cardBg = approval ? "linear-gradient(180deg,#FCEFF5,#fff)" : "linear-gradient(180deg,#FDF1EC,#fff)";
                  return (
                    <Paper key={n.id} sx={{ p: dense ? 1.4 : 2, borderRadius: dense ? "10px" : "13px", border: `1px solid ${cardBorder}`, borderLeft: `4px solid ${edge}`,
                      background: cardBg }}>
                      <Stack direction="row" spacing={dense ? 1.1 : 1.5} alignItems="flex-start">
                        <Box sx={{ width: dense ? 28 : 34, height: dense ? 28 : 34, borderRadius: "9px", flexShrink: 0, display: "grid", placeItems: "center", bgcolor: m.bg, color: m.fg }}>
                          <m.Icon sx={{ fontSize: dense ? 16 : 18 }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: dense ? 13.5 : 15, fontWeight: 700, color: tokens.ink, lineHeight: 1.3 }}>{n.title}</Typography>
                          {(approval || !dense) && n.body && <Typography sx={{ fontSize: 12.5, color: tokens.text2, mt: 0.5 }}>{n.body}</Typography>}
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: dense ? 0.5 : 1, flexWrap: "wrap" }} useFlexGap>
                            <WsChip n={n} />
                            <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>{timeAgo(n.created_at)}</Typography>
                            {target && (
                              <Button size="small" onClick={() => navigate(target)} startIcon={<LaunchRoundedIcon sx={{ fontSize: 14 }} />} sx={{ minWidth: 0, py: 0, fontSize: 11.5 }}>
                                {approval ? "Open project" : "Open workspace"}
                              </Button>
                            )}
                          </Stack>
                        </Box>
                      </Stack>

                      {approval ? (() => {
                        const st = pending[n.id];
                        const done = st === "approved" || st === "sent";
                        const approveLabel = st === "approving" ? "Approving…" : st === "approved" ? "Approved ✓" : "Approve";
                        const rejectLabel = st === "rejecting" ? "Blocking…" : st === "sent" ? "Blocked ✓" : "Block";
                        return (
                        <Stack direction="row" spacing={1} sx={{ mt: dense ? 1 : 1.25 }}>
                          <Button size="small" variant="contained" onClick={() => doApprove(n)} disabled={!!st}
                            sx={{ bgcolor: st === "approved" ? "#1E7A50" : edge, "&:hover": { bgcolor: st === "approved" ? "#1E7A50" : "#A5356A" }, "&.Mui-disabled": { color: "#fff", bgcolor: st === "approved" ? "#1E7A50" : done ? tokens.line : undefined } }}>
                            {approveLabel}
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => doReject(n)} disabled={!!st}
                            sx={{ color: st === "sent" ? "#1E7A50" : tokens.text2, borderColor: st === "sent" ? "#1E7A50" : tokens.line }}>
                            {rejectLabel}
                          </Button>
                        </Stack>
                        );
                      })() : (
                        <Box sx={{ mt: dense ? 1 : 1.25, bgcolor: "#fff", border: "1px solid #F2C9BC", borderRadius: "9px", p: dense ? 1 : 1.5 }}>
                          {!dense && (
                            <Typography sx={{ fontSize: 12, color: "#9A5847", mb: 1 }}>
                              Expected completion date, reason for delay, help needed.
                            </Typography>
                          )}
                          <TextField fullWidth size="small" multiline minRows={dense ? 1 : 2} placeholder="Your status message…"
                            value={ackDraft[n.id] ?? ""} onChange={(e) => setAckDraft((d) => ({ ...d, [n.id]: e.target.value }))} />
                          <Button size="small" variant="contained" color="error" sx={{ mt: 1 }} onClick={() => doAck(n.id)} disabled={!(ackDraft[n.id] || "").trim()}>
                            Acknowledge
                          </Button>
                        </Box>
                      )}
                    </Paper>
                  );
                })}
              </Stack>
            )}

            {/* ---------- RECENT UPDATES ---------- */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 15, fontWeight: 700 }}>Recent updates</Typography>
              <Box component="span" sx={{ fontFamily: monoFont, fontSize: 11, px: 0.9, py: 0.15, borderRadius: "20px", bgcolor: "#EEF0F3", color: tokens.text2 }}>{updates.length}</Box>
            </Stack>

            {updates.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: tokens.text3, py: 1.5 }}>No other updates.</Typography>
            ) : (
              <Paper sx={{ borderRadius: "11px", overflow: "hidden" }}>
                {updates.map((n, i) => {
                  const m = eventMeta(n.event);
                  const target = openTarget(n);
                  return (
                    <Stack key={n.id} direction="row" alignItems="center" spacing={dense ? 1 : 1.25}
                      onClick={() => { if (!n.is_read) markRead(n.id).then(load); }}
                      sx={{ px: dense ? 1.4 : 1.75, py: dense ? 0.6 : 1.25, cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${tokens.line}`,
                        bgcolor: n.is_read ? "transparent" : "#FCFBF8", "&:hover": { bgcolor: "#F6F5F1" } }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, bgcolor: n.is_read ? "transparent" : m.fg, border: n.is_read ? `1px solid ${tokens.line}` : "none" }} />
                      <Box sx={{ width: dense ? 22 : 26, height: dense ? 22 : 26, borderRadius: "7px", flexShrink: 0, display: "grid", placeItems: "center", bgcolor: m.bg, color: m.fg }}>
                        <m.Icon sx={{ fontSize: dense ? 14 : 15 }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: tokens.text }} noWrap>{n.title}</Typography>
                        {n.body && (
                          <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.1, lineHeight: 1.35 }} noWrap>{n.body}</Typography>
                        )}
                      </Box>
                      <WsChip n={n} />
                      {n.acknowledged_at && <Chip label="acknowledged" size="small" sx={{ height: 19, fontSize: 10, bgcolor: "#E7F4EC", color: "#1E7A50" }} />}
                      <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3, flexShrink: 0 }}>{timeAgo(n.created_at)}</Typography>
                      {!n.is_read && (
                        <Tooltip title="Mark as read">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); markRead(n.id).then(load); }} sx={{ flexShrink: 0 }}>
                            <DoneAllRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {target && (
                        <Tooltip title="Open">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); navigate(target); }} sx={{ flexShrink: 0 }}>
                            <LaunchRoundedIcon sx={{ fontSize: 15, color: tokens.text3 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Dismiss">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); dismiss(n.id); }} sx={{ flexShrink: 0 }}>
                          <CloseRoundedIcon sx={{ fontSize: 15, color: tokens.text3 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  );
                })}
              </Paper>
            )}
          </>
        )}

      </Box>

      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }} message={toast} />
    </Box>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { key: string; label: string }[] }) {
  return (
    <Stack direction="row" sx={{ p: 0.35, borderRadius: 2, bgcolor: "#EEF0F3", border: `1px solid ${tokens.line}` }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Box key={o.key} onClick={() => onChange(o.key)}
            sx={{ px: 1.25, py: 0.4, borderRadius: 1.5, cursor: "pointer", fontSize: 12, fontWeight: 600,
              color: active ? tokens.kriyaInk : tokens.text2, bgcolor: active ? "#fff" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(20,22,29,.12)" : "none", transition: "background-color .14s" }}>
            {o.label}
          </Box>
        );
      })}
    </Stack>
  );
}
