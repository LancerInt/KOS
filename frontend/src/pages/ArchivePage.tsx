import { useEffect, useState } from "react";
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { listArchivedWorkspaces, restoreWorkspace, type DynamicWorkspace } from "../features/workspaces/workspacesApi";
import { loadDynamicWorkspaces, ICON_REGISTRY } from "../features/workspaces/workspaces";
import { accentFromHex } from "../features/workspaces/accent";
import { tokens } from "../theme";

export default function ArchivePage() {
  const [rows, setRows] = useState<DynamicWorkspace[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    listArchivedWorkspaces()
      .then(setRows)
      .catch((e) => { if (e?.response?.status === 403) setForbidden(true); else setRows([]); });
  };
  useEffect(load, []);

  const restore = async (w: DynamicWorkspace) => {
    setBusy(w.key);
    try {
      await restoreWorkspace(w.key);
      await loadDynamicWorkspaces(true);   // bring it back into the sidebar
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 0.5 }}>Archive</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, fontSize: 13.5 }}>
        Deleted workspaces stay here for 30 days, then are permanently removed. Restore one to bring it and its
        projects back.
      </Typography>

      {forbidden ? (
        <Typography sx={{ color: tokens.attn }}>You need administrator access to view the archive.</Typography>
      ) : !rows ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      ) : rows.length === 0 ? (
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px" }}>
          <Inventory2RoundedIcon sx={{ fontSize: 30, color: tokens.text3, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>The archive is empty</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>Deleted workspaces will appear here.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25}>
          {rows.map((w) => {
            const accent = accentFromHex(w.accent);
            const Icon = ICON_REGISTRY[w.icon] ?? Inventory2RoundedIcon;
            const soon = (w.days_left ?? 99) <= 7;
            return (
              <Paper key={w.key} sx={{ p: 1.75, borderRadius: "6px", display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box sx={{ width: 40, height: 40, borderRadius: "9px", flexShrink: 0, display: "grid", placeItems: "center",
                  bgcolor: accent.soft, color: accent.ink }}>
                  <Icon sx={{ fontSize: 21 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 600 }} noWrap>{w.label}</Typography>
                  <Typography sx={{ fontSize: 12, color: tokens.text3 }}>
                    Archived {w.archived_at ? new Date(w.archived_at).toLocaleDateString() : ""}
                  </Typography>
                </Box>
                <Chip size="small"
                  label={w.days_left === 0 ? "Deletes today" : `${w.days_left}d left`}
                  sx={{ height: 22, fontSize: 11, fontWeight: 600,
                    color: soon ? tokens.attn : tokens.text2, bgcolor: soon ? tokens.attnWash : "#EEF0F3" }} />
                <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon sx={{ fontSize: 17 }} />}
                  disabled={busy === w.key} onClick={() => restore(w)}>
                  {busy === w.key ? "Restoring…" : "Restore"}
                </Button>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
