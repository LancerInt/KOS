import { useEffect, useState } from "react";
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";

import {
  listArchivedWorkspaces, listDeletedItems, restoreDeletedItem, restoreWorkspace,
  type DeletedItem, type DynamicWorkspace,
} from "../features/workspaces/workspacesApi";
import { loadDynamicWorkspaces, ICON_REGISTRY, getWorkspace, useWorkspaces } from "../features/workspaces/workspaces";
import { accentFromHex } from "../features/workspaces/accent";
import { tokens } from "../theme";

const KIND_LABEL: Record<string, string> = { project: "Project", section: "Section", record: "Record", field: "Field" };

function whenLabel(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ArchivePage() {
  useWorkspaces();                          // resolve workspace labels for the keys
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [isSup, setIsSup] = useState(false);
  const [archived, setArchived] = useState<DynamicWorkspace[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadDeleted = () =>
    listDeletedItems().then((r) => { setItems(r.items); setIsSup(r.is_supervisor); }).catch(() => setItems([]));
  // Archived workspaces are admin-only; a 403 just hides that section.
  const loadArchived = () =>
    listArchivedWorkspaces().then(setArchived).catch(() => setArchived([]));
  useEffect(() => { loadDeleted(); loadArchived(); }, []);

  const restore = async (w: DynamicWorkspace) => {
    setBusy(w.key);
    try { await restoreWorkspace(w.key); await loadDynamicWorkspaces(true); loadArchived(); }
    finally { setBusy(null); }
  };

  const restoreItem = async (it: DeletedItem) => {
    setBusy(`${it.kind}:${it.id}`);
    try { await restoreDeletedItem(it.kind, it.id); await loadDeleted(); }
    finally { setBusy(null); }
  };

  const wsLabel = (key: string) => getWorkspace(key)?.label ?? key;

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 0.5 }}>Archive</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, fontSize: 13.5 }}>
        {isSup
          ? "Everything that's been deleted — projects, sections and records. Restore within 30 days; after that it's gone for good."
          : "Projects, sections and records you can restore. Deleted items stay for 30 days, then are permanently removed."}
      </Typography>

      {/* ---------- Deleted items (everyone) ---------- */}
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 1 }}>
        Deleted items{items ? ` · ${items.length}` : ""}
      </Typography>

      {!items ? (
        <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>
      ) : items.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center", borderRadius: "8px", mb: 4 }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 28, color: tokens.text3, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.25 }}>Nothing deleted</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            {isSup ? "No deletions yet." : "Items you delete will be listed here, ready to restore."}
          </Typography>
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: "10px", overflow: "hidden", mb: 4 }}>
          {items.map((it, i) => {
            const soon = it.days_left <= 7;
            const key = `${it.kind}:${it.id}`;
            return (
              <Stack key={key} direction="row" alignItems="center" spacing={1.25}
                sx={{ px: 1.75, py: 1.1, borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
                <Chip label={KIND_LABEL[it.kind] ?? it.kind} size="small"
                  sx={{ height: 20, fontSize: 10.5, fontWeight: 600, bgcolor: "#F1F3F5", color: tokens.text2, flexShrink: 0, width: 66 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 500 }} noWrap>{it.name}</Typography>
                  <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>
                    {wsLabel(it.workspace)}{it.context ? ` · ${it.context}` : ""}
                    {isSup ? ` · ${it.actor}` : ""} · {whenLabel(it.at)}
                  </Typography>
                </Box>
                <Chip size="small" label={it.days_left === 0 ? "Deletes today" : `${it.days_left}d left`}
                  sx={{ height: 22, fontSize: 11, fontWeight: 600, flexShrink: 0,
                    color: soon ? tokens.attn : tokens.text2, bgcolor: soon ? tokens.attnWash : "#EEF0F3" }} />
                <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon sx={{ fontSize: 16 }} />}
                  disabled={busy === key} onClick={() => restoreItem(it)} sx={{ flexShrink: 0 }}>
                  {busy === key ? "Restoring…" : "Restore"}
                </Button>
              </Stack>
            );
          })}
        </Paper>
      )}

      {/* ---------- Archived workspaces (admins only) ---------- */}
      {archived && archived.length > 0 && (
        <>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 1 }}>
            Archived workspaces · {archived.length}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1.5, fontSize: 12.5 }}>
            Deleted workspaces stay 30 days, then are permanently removed. Restore brings the workspace and its projects back.
          </Typography>
          <Stack spacing={1.25}>
            {archived.map((w) => {
              const accent = accentFromHex(w.accent);
              const Icon = ICON_REGISTRY[w.icon] ?? Inventory2RoundedIcon;
              const soon = (w.days_left ?? 99) <= 7;
              return (
                <Paper key={w.key} sx={{ p: 1.75, borderRadius: "8px", display: "flex", alignItems: "center", gap: 1.5 }}>
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
                  <Chip size="small" label={w.days_left === 0 ? "Deletes today" : `${w.days_left}d left`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 600, color: soon ? tokens.attn : tokens.text2, bgcolor: soon ? tokens.attnWash : "#EEF0F3" }} />
                  <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon sx={{ fontSize: 17 }} />}
                    disabled={busy === w.key} onClick={() => restore(w)}>
                    {busy === w.key ? "Restoring…" : "Restore"}
                  </Button>
                </Paper>
              );
            })}
          </Stack>
        </>
      )}
    </Box>
  );
}
