import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";

import { getWorkspace, useWorkspaces, loadDynamicWorkspaces, dynamicWorkspacesReady, iconNameOf, isBuiltinWorkspace } from "../features/workspaces/workspaces";
import { InlineRename } from "../features/workspaces/InlineRename";
import BuildWithAiDialog from "../features/ai/BuildWithAiDialog";
import MembersDialog from "../features/workspaces/MembersDialog";
import { listMembers, workspaceMemberScope } from "../features/workspaces/workspaceMembersApi";
import {
  listProjects, createProject, deleteProject, addMonths, repeatLabel,
  REPEAT_OPTIONS, type WorkspaceProject, type RepeatFrequency,
} from "../features/workspaces/projectsApi";
import type { DurationStatus } from "../features/workspaces/projectsApi";
import { archiveWorkspace, updateWorkspace } from "../features/workspaces/workspacesApi";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { workspaceAccent, accentFromHex } from "../features/workspaces/accent";
import { tokens, monoFont } from "../theme";

const STATUS_DOT: Record<DurationStatus, string> = {
  none: "#9AA3B2", active: tokens.kriya, ending_soon: "#E0A83D", due: tokens.attn, completed: "#2FA36B",
};
function progressPct(p: WorkspaceProject): number {
  const d = p.duration;
  if (d.status === "completed" || d.status === "due") return 100;
  return d.pct ?? 0;
}

const repeatMonths = (f: RepeatFrequency): number =>
  REPEAT_OPTIONS.find((o) => o.value === f)?.months ?? 0;

/** Which summary tile is driving the project grid. */
type TileFilter = "all" | "due" | "in_progress";

/** One definition per slice, so a tile's count and the grid it opens can never
 *  disagree — both run through this. */
const matchesTile = (tile: TileFilter) => (p: WorkspaceProject): boolean => {
  if (tile === "due") return p.duration.status === "due";
  if (tile === "in_progress") return p.duration.status === "active" || p.duration.status === "ending_soon";
  return true;
};

const TILE_HEADING: Record<TileFilter, string> = {
  all: "Projects", due: "Overdue", in_progress: "In progress",
};
const TILE_EMPTY: Record<TileFilter, string> = {
  all: "here", due: "overdue", in_progress: "in progress",
};
const localNowInput = () => {
  const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function WorkspacePage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  useWorkspaces();                                    // load + subscribe so dynamic workspaces resolve
  const ws = getWorkspace(key);
  const { mine, loading: accessLoading } = useMyAccess();
  const acc = ws?.dynamic && ws.accent ? accentFromHex(ws.accent) : workspaceAccent(ws?.key);

  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newErr, setNewErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [buildAiOpen, setBuildAiOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [tile, setTile] = useState<TileFilter>("all");
  const [newRepeat, setNewRepeat] = useState<RepeatFrequency>("");

  const nextRunPreview = useMemo(() => {
    if (!newRepeat || !newStart) return "";
    return addMonths(newStart, repeatMonths(newRepeat))
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }, [newRepeat, newStart]);
  // Stable across renders — the dialog reloads whenever its scope identity changes.
  const memberScope = useMemo(() => workspaceMemberScope(ws?.key ?? ""), [ws?.key]);

  const load = () => {
    if (!ws) { setProjects([]); return; }
    listProjects(ws.key).then(setProjects).catch(() => setProjects([]));
  };

  const refreshMemberCount = () => {
    if (!ws) return;
    listMembers(ws.key).then((m) => setMemberCount(m.length)).catch(() => {});
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (ws && !accessLoading) refreshMemberCount(); }, [key, accessLoading]);

  if (!ws) {
    // A user-added workspace may still be loading — don't flash "not found".
    if (!dynamicWorkspacesReady()) {
      return (
        <Box sx={{ px: 3, py: 2.5 }}>
          <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
        </Box>
      );
    }
    return (
      <Box sx={{ px: 3, py: 2.5 }}>
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
    setNewRepeat("");
    setNewOpen(true);
  };

  const saveProject = async () => {
    const name = newName.trim();
    if (!name) return;
    // The schedule is measured from the start date, so a repeat without one has
    // nothing to count from. Caught here as well as server-side, to say so
    // before the round trip rather than after it.
    if (newRepeat && !newStart) {
      setNewErr("A repeating project needs a start date — the schedule counts from it.");
      return;
    }
    setCreating(true);
    setNewErr("");
    try {
      // The end is optional — a start on its own is kept; an end before the
      // start is not a window, so the whole thing is dropped.
      const endOk = !newEnd || new Date(newEnd).getTime() > new Date(newStart).getTime();
      const extra = newStart && endOk
        ? {
            start_at: new Date(newStart).toISOString(),
            ...(newEnd ? { end_at: new Date(newEnd).toISOString() } : {}),
            ...(newRepeat ? { repeat_frequency: newRepeat } : {}),
          }
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

  const archiveWs = async () => {
    const builtin = isBuiltinWorkspace(ws.key);
    const msg = builtin
      ? `Delete the built-in "${ws.label}" workspace? It's hidden for everyone and filed in the Archive, where an admin can restore it anytime.`
      : `Delete the "${ws.label}" workspace? It moves to the Archive and is permanently removed after 30 days unless restored.`;
    if (!window.confirm(msg)) return;
    await archiveWorkspace(ws.key);
    await loadDynamicWorkspaces(true);
    navigate("/");
  };
  // Any admin can delete (archive) a workspace — built-in or user-added.
  const canArchive = !!mine?.is_admin;
  // Renaming is administrators-only, matching the server. Built-in workspaces
  // rename too — the server creates their row on the first edit.
  const canRenameWs = !!mine?.is_admin;

  const renameWs = async (label: string) => {
    try {
      await updateWorkspace(ws.key, {
        label,
        // Sent so the row that stands in for a built-in keeps its identity
        // rather than falling back to a default folder icon and empty blurb.
        blurb: ws.blurb,
        icon: iconNameOf(ws),
        accent: ws.accent ?? "",
      });
    } catch (e) {
      const data = (e as { response?: { data?: Record<string, string[] | string> } }).response?.data;
      const first = data?.label ?? data?.detail;
      throw new Error(
        (Array.isArray(first) ? first[0] : first) ?? "Could not rename this workspace.");
    }
    // Force, so the freshly written label replaces the cached one everywhere —
    // the sidebar reads the same cache this page does.
    await loadDynamicWorkspaces(true);
  };

  const header = (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.75 }}>
      <Tooltip title="Back to dashboard">
        <IconButton onClick={() => navigate("/")} aria-label="Back to dashboard"
          sx={{ color: tokens.text2, flexShrink: 0, ml: -0.5, "&:hover": { color: tokens.kriyaInk, bgcolor: tokens.kriyaWash } }}>
          <ArrowBackRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Box sx={{ width: 44, height: 44, borderRadius: "11px", flexShrink: 0, display: "grid", placeItems: "center",
        background: `linear-gradient(150deg, ${acc.base}, ${acc.ink})`, color: "#fff", boxShadow: `0 6px 16px ${acc.base}40` }}>
        <Icon sx={{ fontSize: 23 }} />
      </Box>
      <InlineRename
        value={ws.label}
        label="Workspace name"
        onSave={canRenameWs ? renameWs : undefined}
        subtitle={
          <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>{ws.blurb || "Custom workspace."}</Typography>
        }
      />
      {!accessLoading && level !== "none" && (
        <Tooltip title="Members — who can open this workspace">
          <Button size="small" variant="outlined" startIcon={<GroupRoundedIcon sx={{ fontSize: 17 }} />}
            onClick={() => setMembersOpen(true)}
            sx={{ color: tokens.text2, borderColor: tokens.line, whiteSpace: "nowrap", flexShrink: 0,
              "&:hover": { borderColor: acc.base, bgcolor: `${acc.base}0A` } }}>
            Members{memberCount !== null ? ` · ${memberCount}` : ""}
          </Button>
        </Tooltip>
      )}
      {canArchive && (
        <Tooltip title="Delete workspace (archive)">
          <IconButton onClick={archiveWs} sx={{ color: tokens.text3, "&:hover": { color: tokens.attn, bgcolor: tokens.attnWash } }}>
            <Inventory2RoundedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );

  if (accessLoading) {
    return (
      <Box sx={{ px: 3, py: 2.5 }}>
        {header}
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      </Box>
    );
  }

  if (level === "none") {
    return (
      <Box sx={{ px: 3, py: 2.5 }}>
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

  const overdueCount = (projects ?? []).filter(matchesTile("due")).length;
  const inProgressCount = (projects ?? []).filter(matchesTile("in_progress")).length;
  const recordCount = (projects ?? []).reduce((s, p) => s + p.record_count, 0);
  // The grid shows whichever slice the active tile names. Clicking the live
  // tile again clears it, so the tiles are a filter you can always get out of.
  const shown = (projects ?? []).filter(matchesTile(tile));
  const pickTile = (next: TileFilter) => setTile((cur) => (cur === next ? "all" : next));

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      {header}

      {projects && projects.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(4,1fr)" }, gap: 1.25, mt: 2 }}>
          <StatTile label="Projects" value={projects.length} accent={acc}
            active={tile === "all"} onClick={() => setTile("all")} />
          <StatTile label="Overdue" value={overdueCount} accent={acc} attn
            active={tile === "due"} onClick={() => pickTile("due")} />
          <StatTile label="In progress" value={inProgressCount} accent={acc}
            active={tile === "in_progress"} onClick={() => pickTile("in_progress")} />
          {/* Records counts a different thing — records, not projects — so it
              can't name a slice of this grid. Left inert rather than wired to
              a filter whose result wouldn't match the number on the tile. */}
          <StatTile label="Records" value={recordCount} accent={acc} />
        </Box>
      )}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.5, mb: 1.75 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600 }}>
            {TILE_HEADING[tile]}{projects ? ` · ${shown.length}` : ""}
          </Typography>
          {tile !== "all" && (
            <Chip label="Clear" size="small" onDelete={() => setTile("all")} onClick={() => setTile("all")}
              sx={{ height: 20, fontSize: 10.5, bgcolor: acc.soft, color: acc.ink,
                "& .MuiChip-deleteIcon": { fontSize: 14, color: acc.ink } }} />
          )}
          {!canEdit && (
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: tokens.text3 }}>
              <VisibilityRoundedIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: 11 }}>View only</Typography>
            </Stack>
          )}
        </Stack>
        {canEdit && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />}
              onClick={() => setBuildAiOpen(true)}
              sx={{ color: "#5B41A5", borderColor: "#D6CCF2", "&:hover": { borderColor: "#7C5CD6", bgcolor: "rgba(124,92,214,.06)" } }}>
              Build with AI
            </Button>
            <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={openNew}>
              New project
            </Button>
          </Stack>
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

      {/* A filter that matches nothing is not the same as an empty workspace,
          and must not read like one — the way out is the point. */}
      {projects && projects.length > 0 && shown.length === 0 && (
        <Paper sx={{ p: 4, textAlign: "center", borderRadius: "10px", borderStyle: "dashed" }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Nothing {TILE_EMPTY[tile]}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14, mb: 2 }}>
            {ws.label} has {projects.length} project{projects.length === 1 ? "" : "s"}, none in this state.
          </Typography>
          <Button variant="outlined" size="small" onClick={() => setTile("all")}>Show all projects</Button>
        </Paper>
      )}

      {/* Aisle — compact project cards on a shelf rail */}
      {projects && shown.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3,1fr)", lg: "repeat(4,1fr)" }, gap: 2 }}>
          {shown.map((p) => {
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
                    {/* A roster means the project is narrower than its workspace —
                        worth seeing before you open it. */}
                    {p.member_count > 0 && (
                      <Tooltip title={`Limited to ${p.member_count} member${p.member_count === 1 ? "" : "s"}`}>
                        <Stack direction="row" alignItems="center" spacing={0.25}
                          sx={{ position: "absolute", bottom: 6, left: 8, px: 0.6, py: 0.15, borderRadius: "999px",
                            bgcolor: "rgba(255,255,255,.85)", color: tokens.text2 }}>
                          <GroupRoundedIcon sx={{ fontSize: 12 }} />
                          <Typography sx={{ fontFamily: monoFont, fontSize: 9.5, fontWeight: 600 }}>
                            {p.member_count}
                          </Typography>
                        </Stack>
                      </Tooltip>
                    )}
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
                    {p.repeat_frequency && (
                      <Stack direction="row" alignItems="center" spacing={0.4} sx={{ mt: 0.5 }}>
                        <AutorenewRoundedIcon sx={{ fontSize: 12, color: acc.ink }} />
                        <Typography sx={{ fontSize: 10, fontWeight: 600, color: acc.ink }}>
                          {repeatLabel(p.repeat_frequency)}
                        </Typography>
                      </Stack>
                    )}
                    <Box sx={{ height: 6, borderRadius: 3, bgcolor: tokens.line, overflow: "hidden", mt: 1 }}>
                      <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: acc.base, transition: "width .3s" }} />
                    </Box>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.9 }}>
                      <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>
                        {sections} section{sections === 1 ? "" : "s"} · {p.record_count} record{p.record_count === 1 ? "" : "s"}
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

      <BuildWithAiDialog open={buildAiOpen} onClose={() => setBuildAiOpen(false)}
        workspace={ws.key} workspaceLabel={ws.label}
        onCreated={(projectId) => { setBuildAiOpen(false); navigate(`/workspaces/${ws.key}/projects/${projectId}`); }} />

      <MembersDialog open={membersOpen} onClose={() => setMembersOpen(false)}
        scope={memberScope} canManage={canEdit} onChanged={refreshMemberCount}
        removeTooltip="Remove from workspace"
        note={<>
          Who can open <b>{ws.label}</b>. IT&nbsp;Team, Management and admins see every
          workspace and aren't listed here.
        </>} />

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
            <TextField size="small" type="datetime-local" label="Ends (optional)" InputLabelProps={{ shrink: true }}
              value={newEnd} onChange={(e) => setNewEnd(e.target.value)} fullWidth />
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
              Set a date &amp; time. The end is optional — add one to get reminders as it nears, and if it's overdue.
            </Typography>

            <TextField select size="small" label="Repeats" value={newRepeat} fullWidth
              onChange={(e) => setNewRepeat(e.target.value as RepeatFrequency)}>
              {REPEAT_OPTIONS.map((o) => (
                <MenuItem key={o.value || "once"} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
            {newRepeat && (
              <Box sx={{ px: 1.25, py: 1, borderRadius: "8px", bgcolor: acc.soft }}>
                <Typography sx={{ fontSize: 11.5, color: acc.ink }}>
                  {newStart
                    ? <>When this one is approved, the next <b>{repeatLabel(newRepeat).toLowerCase()}</b> run
                        starts <b>{nextRunPreview}</b> — same date, {repeatMonths(newRepeat)} month
                        {repeatMonths(newRepeat) === 1 ? "" : "s"} on.</>
                    : <>Add a start date — the repeat schedule counts from it.</>}
                </Typography>
              </Box>
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

/** A small at-a-glance metric on the workspace landing (projects / overdue / …). */
/** A tile is clickable only when it names a slice of the project grid. Without
 *  ``onClick`` it stays a plain readout — no pointer, no hover, no focus ring —
 *  so nothing looks pressable that isn't. */
function StatTile({ label, value, accent, attn, active, onClick }: {
  label: string; value: number; accent: { ink: string; base: string; soft: string };
  attn?: boolean; active?: boolean; onClick?: () => void;
}) {
  const hot = Boolean(attn) && value > 0;
  const edge = hot ? tokens.attn : accent.base;
  return (
    <Paper
      onClick={onClick}
      // Role + key handling rather than a real <button>, which would drag in
      // the UA button reset and fight the Paper surface.
      {...(onClick ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-pressed": Boolean(active),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
        },
      } : {})}
      sx={{ p: 1.5, borderRadius: "10px", display: "flex", flexDirection: "column", gap: 0.3,
        border: active ? `1.5px solid ${edge}` : `1px solid ${tokens.line}`,
        boxShadow: active ? `0 0 0 3px ${edge}22` : "none",
        ...(onClick && {
          cursor: "pointer",
          transition: "border-color .16s, box-shadow .16s, transform .12s",
          "&:hover": { transform: "translateY(-1px)", boxShadow: `0 8px 22px rgba(20,22,29,.08)${active ? `, 0 0 0 3px ${edge}22` : ""}` },
          "&:focus-visible": { outline: `2px solid ${edge}`, outlineOffset: 2 },
        }) }}>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 24, fontWeight: 700, lineHeight: 1,
        color: hot ? tokens.attn : value > 0 ? accent.ink : tokens.text3 }}>{value}</Typography>
      <Typography sx={{ fontSize: 11.5, color: tokens.text2 }}>{label}</Typography>
    </Paper>
  );
}
