import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAutoRefresh } from "../useAutoRefresh";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import { Avatar, Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { listLastLogins, type LastLogin } from "../features/admin/adminApi";
import MessagePersonDialog from "../features/messages/MessagePersonDialog";
import type { Person } from "../features/messages/messagesApi";
import { tokens, monoFont } from "../theme";

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

export default function LastLoginsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LastLogin[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Seeing that someone hasn't signed in for a week is usually the moment you
  // want to ask them about it, so each row can open a direct message.
  const [messaging, setMessaging] = useState<Person | null>(null);

  useEffect(() => {
    listLastLogins()
      .then(setRows)
      .catch((e) => { if (e?.response?.status === 403) setForbidden(true); else setRows([]); });
  }, []);
  useAutoRefresh(() => { listLastLogins().then(setRows).catch(() => {}); });

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Button size="small" startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 17 }} />}
        onClick={() => navigate("/admin/roles")} sx={{ color: tokens.text2, mb: 1, ml: -0.5 }}>
        Roles &amp; Access
      </Button>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 0.5 }}>Last logins</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, fontSize: 13.5 }}>
        Who signed in to the system, most recent first.
      </Typography>

      {forbidden ? (
        <Typography sx={{ color: tokens.attn }}>You need administrator access to view this.</Typography>
      ) : !rows ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      ) : rows.length === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No logins recorded yet.</Typography>
      ) : (
        <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
          {rows.map((r, i) => (
            <Box key={r.id}
              sx={{ px: 2, py: 1.4, display: "flex", alignItems: "center", gap: 1.5,
                borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
              <Avatar sx={{ width: 32, height: 32, fontSize: 12.5, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
                {initials(r.name)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>{r.name}</Typography>
                <Typography sx={{ fontSize: 11.5, color: tokens.text3, fontFamily: monoFont }} noWrap>
                  @{r.username}{r.source_ip ? ` · ${r.source_ip}` : ""}
                </Typography>
              </Box>
              <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                <Typography sx={{ fontSize: 12.5, color: tokens.text }}>
                  {new Date(r.last_login).toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 11, color: tokens.text3 }}>{relative(r.last_login)}</Typography>
              </Box>
              <Tooltip title={`Message ${r.name}`}>
                <IconButton size="small" sx={{ flexShrink: 0 }}
                  onClick={() => setMessaging({ id: r.id, name: r.name, username: r.username, email: "", role: "" })}>
                  <ForumRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Paper>
      )}

      <MessagePersonDialog open={messaging !== null} person={messaging}
        onClose={() => setMessaging(null)}
        onSent={(conversationId) => navigate(`/messages/${conversationId}`)} />
    </Box>
  );
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
