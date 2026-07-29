import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Switch, TextField, Typography } from "@mui/material";

import {
  acknowledge, getPreferences, listNotifications, markAllRead, markRead,
  updatePreferences, type Notification, type Preferences,
} from "../features/notifications/notificationsApi";
import { tokens, monoFont } from "../theme";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [ackDraft, setAckDraft] = useState<Record<number, string>>({});

  const load = () => listNotifications().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); getPreferences().then(setPrefs); }, []);

  const savePref = (patch: Partial<Preferences>) => {
    updatePreferences(patch).then(setPrefs);
  };

  const doAck = (id: number) => {
    const msg = (ackDraft[id] || "").trim();
    if (!msg) return;
    acknowledge(id, msg).then(() => { setAckDraft((d) => ({ ...d, [id]: "" })); load(); });
  };

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      {/* Content stays a readable width, but the track matches Dashboard/My Work so
          the "Notifications" heading lines up near the sidebar, not floating centre. */}
      <Box sx={{ maxWidth: 760 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 2.5 }}>
        <Typography variant="h1" sx={{ fontSize: 28 }}>Notifications</Typography>
        <Button size="small" onClick={() => markAllRead().then(load)}>Mark all read</Button>
      </Stack>

      {/* preferences */}
      {prefs && (
        <Paper sx={{ p: 2, borderRadius: "6px", mb: 3 }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 1 }}>Preferences</Typography>
          <Stack direction="row" spacing={3} flexWrap="wrap">
            <PrefRow label="Email notifications" checked={prefs.email_enabled} onChange={(v) => savePref({ email_enabled: v })} />
            <PrefRow label="Daily digest" checked={prefs.daily_digest} onChange={(v) => savePref({ daily_digest: v })} />
          </Stack>
        </Paper>
      )}

      {!items && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>}
      {items && items.length === 0 && (
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px" }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>All caught up</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>No notifications right now.</Typography>
        </Paper>
      )}

      <Stack spacing={1.25}>
        {items?.map((n) => (
          <Paper key={n.id} sx={{ p: 2, borderRadius: "6px", borderLeft: n.is_read ? undefined : `3px solid ${tokens.kriya}` }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              {n.needs_acknowledgement && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: tokens.attn }} />}
              <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{n.title}</Typography>
              <Typography sx={{ fontSize: 11, color: tokens.text3, fontFamily: monoFont }}>{n.created_at.slice(0, 16).replace("T", " ")}</Typography>
            </Stack>
            {n.body && <Typography sx={{ fontSize: 13, color: tokens.text2, mt: 0.5 }}>{n.body}</Typography>}

            {n.needs_acknowledgement ? (
              <Box sx={{ mt: 1.25, bgcolor: tokens.attnWash, border: "1px solid #F2C9BC", borderRadius: "6px", p: 1.5 }}>
                <Typography sx={{ fontSize: 12.5, color: "#9A5847", mb: 1 }}>
                  Acknowledgement required — expected completion date, reason for delay, help needed.
                </Typography>
                <TextField fullWidth size="small" multiline minRows={2} placeholder="Your status message…"
                  value={ackDraft[n.id] ?? ""} onChange={(e) => setAckDraft((d) => ({ ...d, [n.id]: e.target.value }))} />
                <Button size="small" variant="contained" color="error" sx={{ mt: 1 }} onClick={() => doAck(n.id)} disabled={!(ackDraft[n.id] || "").trim()}>
                  Acknowledge
                </Button>
              </Box>
            ) : (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {n.project && <Button size="small" onClick={() => navigate(`/projects/${n.project}`)}>Open</Button>}
                {!n.is_read && <Button size="small" color="inherit" onClick={() => markRead(n.id).then(load)}>Mark read</Button>}
                {n.acknowledged_at && <Chip label="acknowledged" size="small" sx={{ height: 20, fontSize: 10.5, bgcolor: "#E7F5EE", color: "#1F7A4D" }} />}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>
      </Box>
    </Box>
  );
}

function PrefRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} size="small" />
      <Typography sx={{ fontSize: 13.5 }}>{label}</Typography>
    </Stack>
  );
}
