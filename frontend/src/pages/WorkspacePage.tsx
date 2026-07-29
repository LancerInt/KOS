import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";

import { getWorkspace } from "../features/workspaces/workspaces";
import { listProjects, createProject, deleteProject, type WorkspaceProject } from "../features/workspaces/projectsApi";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { DurationChip } from "../features/workspaces/durationDisplay";
import { tokens, monoFont } from "../theme";

export default function WorkspacePage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const ws = getWorkspace(key);
  const { mine, loading: accessLoading } = useMyAccess();

  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newErr, setNewErr] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    if (!ws) { setProjects([]); return; }
    listProjects(ws.key).then(setProjects).catch(() => setProjects([]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [key]);

  if (!ws) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        <Typography variant="h1" sx={{ fontSize: 26, mb: 0.5 }}>Workspace not found</Typography>
        <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>Pick a workspace from the sidebar.</Typography>
      </Box>
    );
  }

  const { Icon } = ws;
  const builtinCount = ws.categories?.length ?? 0;
  const level = accessLevel(mine, ws.key);
  const canEdit = level === "edit";
  const hasDuration = true; // project durations are available on every workspace

  const openNew = () => {
    setNewErr("");
    setNewName("");
    setNewStart(new Date().toISOString().slice(0, 10));
    setNewEnd("");
    setNewOpen(true);
  };

  const saveProject = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setNewErr("");
    try {
      const durDays = newStart && newEnd
        ? Math.round((new Date(newEnd).getTime() - new Date(newStart).getTime()) / 86400000)
        : 0;
      const extra = hasDuration && durDays > 0
        ? { start_date: newStart, duration_days: durDays }
        : undefined;
      const created = await createProject(ws.key, name, extra);
      setNewName("");
      setNewOpen(false);
      navigate(`/workspaces/${ws.key}/projects/${created.id}`);
    } catch (e) {
      const detail = (e as { response?: { data?: { name?: string[] } } }).response?.data?.name?.[0];
      setNewErr(detail ?? "Could not create project.");
    } finally {
      setCreating(false);
    }
  };

  const removeProject = async (p: WorkspaceProject) => {
    if (!window.confirm(`Delete "${p.name}"? This removes the project and everything inside it.`)) return;
    await deleteProject(p.id);
    load();
  };

  const header = (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.75 }}>
      <Box sx={{ width: 42, height: 42, borderRadius: "8px", flexShrink: 0, display: "grid", placeItems: "center",
        bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
        <Icon sx={{ fontSize: 23 }} />
      </Box>
      <Box>
        <Typography variant="h1" sx={{ fontSize: 26, lineHeight: 1.2 }}>{ws.label}</Typography>
        <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>{ws.blurb}</Typography>
      </Box>
    </Stack>
  );

  // Access still resolving.
  if (accessLoading) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        {header}
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      </Box>
    );
  }

  // No access to this workspace.
  if (level === "none") {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        {header}
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px", mt: 2 }}>
          <LockRoundedIcon sx={{ fontSize: 30, color: tokens.text3, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No access</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>
            Your role can't open the {ws.label} workspace. Ask an administrator if you need it.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      {header}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.5, mb: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600 }}>
            Projects
          </Typography>
          {!canEdit && (
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: tokens.text3 }}>
              <VisibilityRoundedIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: 11 }}>View only</Typography>
            </Stack>
          )}
        </Stack>
        {canEdit && (
          <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={openNew}>
            New project
          </Button>
        )}
      </Stack>

      {!projects && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>}

      {projects && projects.length === 0 && (
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px" }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No projects yet</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14, mb: canEdit ? 2 : 0 }}>
            {canEdit
              ? `Create your first ${ws.label} project — each one gets its own sections and records.`
              : "Nothing here yet. Projects will appear once someone adds them."}
          </Typography>
          {canEdit && (
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openNew}>
              New project
            </Button>
          )}
        </Paper>
      )}

      {projects && projects.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" }, gap: 1.25 }}>
          {projects.map((p) => (
            <Paper key={p.id} onClick={() => navigate(`/workspaces/${ws.key}/projects/${p.id}`)}
              sx={{ p: 1.75, borderRadius: "6px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 1,
                transition: "border-color .16s, box-shadow .16s, transform .16s",
                "&:hover": { borderColor: "#DADEE4", boxShadow: "0 2px 4px rgba(20,22,29,.05), 0 10px 26px rgba(20,22,29,.07)", transform: "translateY(-1px)" } }}>
              <Stack direction="row" alignItems="center" spacing={1.25}>
                <Box sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: "6px", display: "grid", placeItems: "center",
                  bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
                  <FolderRoundedIcon sx={{ fontSize: 19 }} />
                </Box>
                <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 15.5, fontWeight: 600, flex: 1, minWidth: 0, lineHeight: 1.25 }} noWrap>
                  {p.name}
                </Typography>
                {canEdit && (
                  <Tooltip title="Delete project">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeProject(p); }}>
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
              <DurationChip duration={p.duration} />
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Typography sx={{ fontSize: 11.5, color: tokens.text2, fontFamily: monoFont }}>
                  {builtinCount + p.section_count} sections
                </Typography>
                <Box sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: tokens.text3 }} />
                <Typography sx={{ fontSize: 11.5, color: tokens.text2, fontFamily: monoFont }}>
                  {p.record_count} record{p.record_count === 1 ? "" : "s"}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <ChevronRightRoundedIcon sx={{ fontSize: 18, color: tokens.text3 }} />
              </Stack>
              <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont }}>
                {p.created_by_name || "—"} · {p.created_at.slice(0, 10)}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}

      {/* New project dialog */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New {ws.label} project</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField size="small" label="Project name" value={newName} autoFocus fullWidth
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveProject(); }} />
            {hasDuration && (
              <>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" type="date" label="Start date" InputLabelProps={{ shrink: true }}
                    value={newStart} onChange={(e) => setNewStart(e.target.value)} sx={{ flex: 1 }} />
                  <TextField size="small" type="date" label="End date" InputLabelProps={{ shrink: true }}
                    value={newEnd} onChange={(e) => setNewEnd(e.target.value)} sx={{ flex: 1 }} />
                </Stack>
                <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
                  You'll get reminders as the end date nears, and if it's overdue.
                </Typography>
              </>
            )}
            {newErr && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{newErr}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveProject} disabled={creating || !newName.trim()}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
