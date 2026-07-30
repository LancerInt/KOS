import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";

import { getWorkspace } from "../features/workspaces/workspaces";
import { listProjects, createProject, deleteProject, type WorkspaceProject } from "../features/workspaces/projectsApi";
import type { DurationStatus } from "../features/workspaces/projectsApi";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { workspaceAccent } from "../features/workspaces/accent";
import { tokens, monoFont } from "../theme";

const STATUS_DOT: Record<DurationStatus, string> = {
  none: "#9AA3B2", active: tokens.kriya, ending_soon: "#E0A83D", due: tokens.attn, completed: "#2FA36B",
};
function progressPct(p: WorkspaceProject): number {
  const d = p.duration;
  if (d.status === "completed" || d.status === "due") return 100;
  return d.pct ?? 0;
}
const localNowInput = () => {
  const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function WorkspacePage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const ws = getWorkspace(key);
  const { mine, loading: accessLoading } = useMyAccess();
  const acc = workspaceAccent(ws?.key);

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

  const openNew = () => {
    setNewErr("");
    setNewName("");
    setNewStart(localNowInput());
    setNewEnd("");
    setNewOpen(true);
  };

  const saveProject = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setNewErr("");
    try {
      const valid = newStart && newEnd && new Date(newEnd).getTime() > new Date(newStart).getTime();
      const extra = valid ? { start_at: new Date(newStart).toISOString(), end_at: new Date(newEnd).toISOString() } : undefined;
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
      <Box sx={{ width: 44, height: 44, borderRadius: "11px", flexShrink: 0, display: "grid", placeItems: "center",
        background: `linear-gradient(150deg, ${acc.base}, ${acc.ink})`, color: "#fff", boxShadow: `0 6px 16px ${acc.base}40` }}>
        <Icon sx={{ fontSize: 23 }} />
      </Box>
      <Box>
        <Typography variant="h1" sx={{ fontSize: 26, lineHeight: 1.2 }}>{ws.label}</Typography>
        <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>{ws.blurb}</Typography>
      </Box>
    </Stack>
  );

  if (accessLoading) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        {header}
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      </Box>
    );
  }

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

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.5, mb: 1.75 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600 }}>
            Projects{projects ? ` · ${projects.length}` : ""}
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
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openNew}>New project</Button>
          )}
        </Paper>
      )}

      {/* Aisle — compact project cards on a shelf rail */}
      {projects && projects.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3,1fr)", lg: "repeat(4,1fr)" }, gap: 2 }}>
          {projects.map((p) => {
            const dot = STATUS_DOT[p.duration.status];
            const pct = progressPct(p);
            const sections = builtinCount + p.section_count;
            const overdue = p.duration.status === "due";
            return (
              <Box key={p.id}>
                <Paper onClick={() => navigate(`/workspaces/${ws.key}/projects/${p.id}`)}
                  sx={{ borderRadius: "10px", overflow: "hidden", cursor: "pointer", position: "relative",
                    "& .del": { opacity: 0, transition: "opacity .14s" },
                    transition: "transform .16s, box-shadow .16s, border-color .16s",
                    "&:hover": { transform: "translateY(-2px)", boxShadow: "0 10px 26px rgba(20,22,29,.12)", borderColor: acc.soft },
                    "&:hover .del": { opacity: 1 } }}>
                  {/* thumbnail */}
                  <Box sx={{ height: 60, position: "relative", display: "grid", placeItems: "center",
                    background: `linear-gradient(135deg, ${acc.soft}, ${acc.base}22)` }}>
                    <Icon sx={{ fontSize: 25, color: acc.base }} />
                    <Tooltip title={p.duration.status.replace("_", " ")}>
                      <Box sx={{ position: "absolute", top: 7, left: 8, width: 9, height: 9, borderRadius: "50%", bgcolor: dot, border: "2px solid rgba(255,255,255,.85)" }} />
                    </Tooltip>
                    {canEdit && (
                      <IconButton className="del" size="small" onClick={(e) => { e.stopPropagation(); removeProject(p); }}
                        sx={{ position: "absolute", top: 4, right: 4, bgcolor: "rgba(255,255,255,.85)", "&:hover": { bgcolor: "#fff" } }}>
                        <DeleteOutlineRoundedIcon sx={{ fontSize: 15, color: tokens.text2 }} />
                      </IconButton>
                    )}
                  </Box>
                  {/* body */}
                  <Box sx={{ p: "10px 12px 12px" }}>
                    <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 13.5, lineHeight: 1.25, color: tokens.ink,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 34 }}>
                      {p.name}
                    </Typography>
                    <Typography sx={{ fontFamily: monoFont, fontSize: 9.5, color: tokens.text3, mt: 0.35 }} noWrap>
                      {p.created_by_name || "—"} · {p.created_at.slice(0, 10)}
                    </Typography>
                    <Box sx={{ height: 6, borderRadius: 3, bgcolor: tokens.line, overflow: "hidden", mt: 1 }}>
                      <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: acc.base, transition: "width .3s" }} />
                    </Box>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.9 }}>
                      <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>
                        {sections} sec · {p.record_count} rec{p.record_count === 1 ? "" : "s"}
                      </Typography>
                      <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: overdue ? tokens.attn : tokens.text3, fontWeight: overdue ? 600 : 400 }}>
                        {p.duration.end_label ?? "—"}
                      </Typography>
                    </Stack>
                  </Box>
                </Paper>
                {/* the shelf under each card */}
                <Box sx={{ height: 9, mx: 0.75, borderRadius: "0 0 7px 7px",
                  background: "linear-gradient(180deg,#D9CDB6,#E6DCC9)", boxShadow: "0 8px 10px -7px rgba(20,22,29,.3)" }} />
              </Box>
            );
          })}
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
            <TextField size="small" type="datetime-local" label="Starts" InputLabelProps={{ shrink: true }}
              value={newStart} onChange={(e) => setNewStart(e.target.value)} fullWidth />
            <TextField size="small" type="datetime-local" label="Ends" InputLabelProps={{ shrink: true }}
              value={newEnd} onChange={(e) => setNewEnd(e.target.value)} fullWidth />
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
              Set a date &amp; time. You'll get reminders as the end nears, and if it's overdue.
            </Typography>
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
