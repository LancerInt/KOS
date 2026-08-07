/**
 * Dashboard — the single home. Consolidates the personal work queue, the
 * portfolio overview, and reports over workspace projects (access-scoped).
 *
 * Interactions: metric tiles + status ring filter the list; a command strip
 * (find · sort · density) tunes it; List ⇄ Board (drag a card to Completed to
 * close it / out to reopen); cards carry a duration stage rail with a "today"
 * marker and hover quick-actions. Clicking a project opens its workspace —
 * details live there, not here.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  InputAdornment, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import BookmarkAddRoundedIcon from "@mui/icons-material/BookmarkAddRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import ViewKanbanRoundedIcon from "@mui/icons-material/ViewKanbanRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";

import { listAllProjects, completeProject, type WorkspaceProject } from "../features/workspaces/projectsApi";
import type { DurationStatus } from "../features/workspaces/projectsApi";
import { listSavedViews, createSavedView, deleteSavedView, type SavedView } from "../features/views/savedViewsApi";
import { getWorkspace } from "../features/workspaces/workspaces";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { useAppSelector } from "../hooks";
import { AiActionBar } from "../features/ai/AiActionButton";
import { useAiPageContext } from "../features/ai/AiContext";
import DailyStandupWidget from "../features/ai/DailyStandupWidget";
import { tokens, monoFont, categoryColors } from "../theme";

type Filter = "all" | DurationStatus;
type SortKey = "urgency" | "end" | "name" | "workspace";
type Layout = "list" | "board";

/** The Dashboard state a saved view captures. Stored verbatim as the view config. */
type DashConfig = { filter: Filter; query: string; sort: SortKey; layout: Layout };
const VIEW_SURFACE = "dashboard";

// Every status colour is drawn from the app theme — brand teal for "in progress",
// the single coral for "overdue", canonical categoryColors for the rest.
const STATUS_UI: Record<DurationStatus, { label: string; fg: string; bg: string; ring: string }> = {
  none: { label: "No duration", fg: tokens.text2, bg: "#EEF0F3", ring: categoryColors.notStarted },
  active: { label: "In progress", fg: tokens.kriyaInk, bg: tokens.kriyaWash, ring: tokens.kriya },
  ending_soon: { label: "Ending soon", fg: "#9A6A16", bg: "#FBF2DF", ring: categoryColors.waiting },
  due: { label: "Overdue", fg: tokens.attn, bg: tokens.attnWash, ring: tokens.attn },
  completed: { label: "Completed", fg: "#1E7A50", bg: "#E7F4EC", ring: categoryColors.done },
};

const ORDER: Record<DurationStatus, number> = { due: 0, ending_soon: 1, active: 2, none: 3, completed: 4 };
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/** Compact "time since" for overdue items: "3h", "2d 4h", "45m". */
function sinceLabel(ms: number): string {
  const s = Math.max(0, ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.max(1, m)}m`;
}

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function progressPct(p: WorkspaceProject): number {
  const d = p.duration;
  if (d.status === "completed" || d.status === "due") return 100;
  return d.pct ?? 0;
}

function urgency(a: WorkspaceProject, b: WorkspaceProject): number {
  const d = ORDER[a.duration.status] - ORDER[b.duration.status];
  if (d !== 0) return d;
  const ae = a.duration.end_date ?? "9999-12-31";
  const be = b.duration.end_date ?? "9999-12-31";
  return ae < be ? -1 : ae > be ? 1 : 0;
}

function durMeta(p: WorkspaceProject): { text: string; color: string } {
  const d = p.duration;
  switch (d.status) {
    case "completed": return { text: p.completed_at ? `Completed ${fmt(p.completed_at)}` : "Completed", color: "#1E7A50" };
    case "due": {
      const over = d.end_at ? sinceLabel(Date.now() - new Date(d.end_at).getTime()) : "";
      return { text: over ? `Overdue ${over}` : "Overdue", color: tokens.attn };
    }
    case "ending_soon": return { text: d.left_label ? `${d.left_label} left` : "Ending soon", color: "#9A6A16" };
    case "active": return { text: d.left_label ? `${d.left_label} left` : "In progress", color: tokens.text2 };
    default: return { text: "No duration set", color: tokens.text3 };
  }
}

/** Count from 0 → target once, for the tile flourish. */
function useCountUp(target: number, ms = 550): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function exportCsv(projects: WorkspaceProject[]) {
  const cell = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ["Project", "Workspace", "Status", "Progress %", "Records", "Start", "End", "Created by"];
  const lines = projects.map((p) => [
    p.name, getWorkspace(p.workspace)?.label ?? p.workspace, STATUS_UI[p.duration.status].label,
    progressPct(p), p.record_count, p.start_at ?? "", p.duration.end_at ?? "", p.created_by_name ?? "",
  ]);
  const csv = [headers, ...lines].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "kos-projects.csv"; a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const user = useAppSelector((s) => s.auth.user);
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canReports = "view_reports" in caps || "administer" in caps;
  const navigate = useNavigate();
  const { mine } = useMyAccess();

  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const [view, setView] = useState<"work" | "reports">("work");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("urgency");
  // Always compact — the density toggle was removed in favour of one tight layout.
  const dense = true;

  // Saved views — per-user filter/sort/layout presets for this screen.
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const reload = () => listAllProjects().then(setProjects).catch(() => setProjects([]));
  const loadViews = () => listSavedViews(VIEW_SURFACE).then(setSavedViews).catch(() => setSavedViews([]));
  useEffect(() => { reload(); loadViews(); }, []);

  const applyView = (v: SavedView) => {
    const c = v.config as Partial<DashConfig>;
    setFilter((c.filter as Filter) ?? "all");
    setQuery(typeof c.query === "string" ? c.query : "");
    setSort((c.sort as SortKey) ?? "urgency");
    setLayout((c.layout as Layout) ?? "list");
  };

  const isActiveView = (v: SavedView) => {
    const c = v.config as Partial<DashConfig>;
    return (c.filter ?? "all") === filter && (c.query ?? "") === query
      && (c.sort ?? "urgency") === sort && (c.layout ?? "list") === layout;
  };

  const saveCurrent = async () => {
    const name = saveName.trim();
    if (!name) { setSaveErr("Give the view a name."); return; }
    const config: DashConfig = { filter, query, sort, layout };
    try {
      await createSavedView(VIEW_SURFACE, name, config);
      setSaveOpen(false); setSaveName(""); setSaveErr("");
      loadViews();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { name?: string[]; detail?: string } } })?.response?.data;
      setSaveErr(d?.name?.[0] || d?.detail || "Could not save the view.");
    }
  };

  const removeView = (v: SavedView) => {
    if (!window.confirm(`Delete the view "${v.name}"?`)) return;
    deleteSavedView(v.id).then(loadViews).catch(() => {});
  };

  const canEdit = (p: WorkspaceProject) => accessLevel(mine, p.workspace) === "edit";

  const counts = useMemo(() => {
    const c = { all: (projects ?? []).length, due: 0, ending_soon: 0, active: 0, completed: 0, none: 0 } as Record<string, number>;
    for (const p of projects ?? []) c[p.duration.status] += 1;
    return c;
  }, [projects]);

  const byWorkspace = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects ?? []) m.set(p.workspace, (m.get(p.workspace) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);

  const attention = useMemo(
    () => (projects ?? []).filter((p) => p.duration.status === "due" || p.duration.status === "ending_soon").sort(urgency),
    [projects],
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (getWorkspace(p.workspace)?.label ?? p.workspace).toLowerCase().includes(q));
    return base;
  }, [projects, query]);

  const listShown = useMemo(() => {
    const out = searched.filter((p) => filter === "all" || p.duration.status === filter);
    return [...out].sort((a, b) => {
      if (sort === "urgency") return urgency(a, b);
      if (sort === "end") return (a.duration.end_date ?? "9999").localeCompare(b.duration.end_date ?? "9999");
      if (sort === "name") return a.name.localeCompare(b.name);
      return (getWorkspace(a.workspace)?.label ?? a.workspace).localeCompare(getWorkspace(b.workspace)?.label ?? b.workspace);
    });
  }, [searched, filter, sort]);

  const rollup = useMemo(() => [...(projects ?? [])].sort(urgency), [projects]);

  useAiPageContext(
    useMemo(
      () =>
        projects
          ? {
              label: "Dashboard",
              text:
                `The user is viewing their projects across workspaces: ${projects.length} total, ` +
                `${counts.due} overdue, ${counts.ending_soon} ending soon, ${counts.active} in progress, ${counts.completed} completed.\n\n` +
                projects.slice(0, 30).map((p) => `- "${p.name}" (${p.workspace}, ${p.duration.status}${p.duration.end_date ? `, ends ${p.duration.end_date}` : ""})`).join("\n"),
            }
          : null,
      [projects, counts],
    ),
  );

  const openWorkspace = (p: WorkspaceProject) => navigate(`/workspaces/${p.workspace}`);
  const toggleComplete = (p: WorkspaceProject) => { completeProject(p.id).then(reload).catch(() => {}); };
  const dropTo = (p: WorkspaceProject, col: DurationStatus) => {
    if (!canEdit(p)) return;
    const isDone = p.duration.status === "completed";
    if (col === "completed" ? !isDone : isDone) toggleComplete(p); // drop into Completed → close; out of it → reopen
  };
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(",", " ·");

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      {/* head */}
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={2} flexWrap="wrap" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 26 }}>Dashboard</Typography>
          <Typography sx={{ mt: 0.4, color: tokens.text2, fontSize: 13.5 }}>
            {projects
              ? <>Welcome, {user?.first_name || user?.username}. <b style={{ color: counts.due ? tokens.attn : tokens.text }}>{counts.due}</b> overdue · <b style={{ color: tokens.text }}>{counts.ending_soon}</b> ending soon across <b style={{ color: tokens.text }}>{counts.all}</b> project{counts.all === 1 ? "" : "s"}.</>
              : "Loading your projects…"}
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>{dateStr}</Typography>
      </Stack>

      {/* AI actions */}
      <Box sx={{ mb: 2 }}>
        <AiActionBar>
          <DailyStandupWidget />
        </AiActionBar>
      </Box>

      {/* A · metric tiles as filters */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(5,1fr)" }, gap: 1.25, mb: 2 }}>
        <MetricTile label="Projects" value={counts.all} active={filter === "all"} onClick={() => setFilter("all")} icon={<FolderRoundedIcon sx={{ fontSize: 20 }} />} />
        <MetricTile label="Overdue" value={counts.due} active={filter === "due"} onClick={() => setFilter("due")} icon={<WarningAmberRoundedIcon sx={{ fontSize: 20 }} />} attn />
        <MetricTile label="Ending soon" value={counts.ending_soon} active={filter === "ending_soon"} onClick={() => setFilter("ending_soon")} icon={<AccessTimeRoundedIcon sx={{ fontSize: 20 }} />} />
        <MetricTile label="In progress" value={counts.active} active={filter === "active"} onClick={() => setFilter("active")} icon={<AutorenewRoundedIcon sx={{ fontSize: 20 }} />} />
        <MetricTile label="Completed" value={counts.completed} active={filter === "completed"} onClick={() => setFilter("completed")} icon={<CheckCircleRoundedIcon sx={{ fontSize: 20 }} />} />
      </Box>

      {/* view switch — My work vs Reports (reports gated) */}
      {canReports && (
        <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2 }}>
          {(["work", "reports"] as const).map((v) => {
            const active = v === view;
            return (
              <Box key={v} onClick={() => setView(v)}
                sx={{ cursor: "pointer", px: 1.75, py: 1.1, fontSize: 13.5, fontWeight: 600,
                  color: active ? tokens.kriyaInk : tokens.text2, borderBottom: `2px solid ${active ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
                {v === "work" ? "My work" : "Reports"}
              </Box>
            );
          })}
        </Stack>
      )}

      {!projects && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgressDot /></Stack>}

      {projects && view === "work" && (
        <>
          {/* Saved views — per-user filter/sort/layout presets */}
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1.5, flexWrap: "wrap" }} useFlexGap>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: tokens.text3, pr: 0.25 }}>
              <BookmarkBorderRoundedIcon sx={{ fontSize: 16 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Views</Typography>
            </Stack>
            {savedViews.map((v) => {
              const active = isActiveView(v);
              return (
                <Chip key={v.id} label={v.name} size="small"
                  onClick={() => applyView(v)} onDelete={() => removeView(v)}
                  variant={active ? "filled" : "outlined"}
                  sx={{ height: 26, fontSize: 12, fontWeight: 500, borderRadius: "6px",
                    ...(active
                      ? { bgcolor: tokens.kriyaWash, color: tokens.kriyaInk, border: `1px solid ${tokens.kriya}`,
                          "& .MuiChip-deleteIcon": { color: tokens.kriyaInk } }
                      : { color: tokens.text2, borderColor: tokens.line, "& .MuiChip-deleteIcon": { color: tokens.text3 } }),
                    "& .MuiChip-deleteIcon:hover": { color: tokens.attn } }} />
              );
            })}
            {savedViews.length === 0 && (
              <Typography sx={{ fontSize: 12, color: tokens.text3 }}>None yet — tune the filters below, then save them.</Typography>
            )}
            <Button size="small" variant="text" startIcon={<BookmarkAddRoundedIcon sx={{ fontSize: 16 }} />}
              onClick={() => { setSaveName(""); setSaveErr(""); setSaveOpen(true); }}
              sx={{ fontSize: 12, textTransform: "none", color: tokens.kriyaInk, minWidth: 0 }}>
              Save current
            </Button>
          </Stack>

          {/* C · command strip + B · view toggle */}
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 2, flexWrap: "wrap" }} useFlexGap>
            <TextField size="small" placeholder="Find a project…" value={query} onChange={(e) => setQuery(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ fontSize: 18, color: tokens.text3 }} /></InputAdornment> }}
              sx={{ minWidth: 210, flex: 1, maxWidth: 340, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            <Select size="small" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} sx={{ fontSize: 13, minWidth: 150, borderRadius: 2 }}>
              <MenuItem value="urgency" sx={{ fontSize: 13 }}>Sort: Urgency</MenuItem>
              <MenuItem value="end" sx={{ fontSize: 13 }}>Sort: End date</MenuItem>
              <MenuItem value="name" sx={{ fontSize: 13 }}>Sort: Name</MenuItem>
              <MenuItem value="workspace" sx={{ fontSize: 13 }}>Sort: Workspace</MenuItem>
            </Select>
            <Box sx={{ flex: 1 }} />
            <Segmented value={layout} onChange={(v) => setLayout(v as "list" | "board")}
              options={[
                { key: "list", label: "List", icon: <FormatListBulletedRoundedIcon sx={{ fontSize: 15 }} /> },
                { key: "board", label: "Board", icon: <ViewKanbanRoundedIcon sx={{ fontSize: 15 }} /> },
              ]} />
          </Stack>

          {layout === "list" ? (
            // Rail widened from 270px to fit the stand-up's prose comfortably.
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 320px" }, gap: 3, alignItems: "start" }}>
              <Box sx={{ minWidth: 0 }}>
                {listShown.length === 0 ? (
                  <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px" }}>
                    <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{counts.all === 0 ? "No projects yet" : "Nothing here"}</Typography>
                    <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                      {counts.all === 0 ? "Open a workspace from the sidebar to create your first project." : "No projects match this filter/search."}
                    </Typography>
                  </Paper>
                ) : (
                  <Stack spacing={dense ? 0.75 : 1.25}>
                    {listShown.map((p) => (
                      <ProjectCard key={p.id} p={p} dense={dense} canEdit={canEdit(p)} onOpen={() => openWorkspace(p)} onComplete={() => toggleComplete(p)} />
                    ))}
                  </Stack>
                )}
              </Box>

              <Box sx={{ position: { md: "sticky" }, top: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                <Panel title="By status">
                  <StatusRing counts={counts} active={filter} onPick={setFilter} />
                </Panel>
                <Panel title="Needs attention">
                  {attention.length === 0 ? (
                    <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Nothing overdue or ending soon.</Typography>
                  ) : (
                    <Stack spacing={0}>
                      {attention.slice(0, 6).map((p, i) => {
                        const ws = getWorkspace(p.workspace);
                        return (
                          <Stack key={p.id} direction="row" alignItems="center" spacing={1} onClick={() => openWorkspace(p)}
                            sx={{ py: 0.9, cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${tokens.line}`, "&:hover": { color: tokens.kriyaInk } }}>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography sx={{ fontSize: 12.5, fontWeight: 550 }} noWrap>{p.name}</Typography>
                              <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>{ws?.label ?? p.workspace}</Typography>
                            </Box>
                            <StatusDot status={p.duration.status} />
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}
                </Panel>
                <Panel title="By workspace">
                  {byWorkspace.length === 0 ? (
                    <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No projects yet.</Typography>
                  ) : (
                    <Stack spacing={0.25}>
                      {byWorkspace.map(([wsKey, n]) => {
                        const ws = getWorkspace(wsKey);
                        const Icon = ws?.Icon ?? FolderRoundedIcon;
                        return (
                          <Stack key={wsKey} direction="row" alignItems="center" spacing={1} onClick={() => navigate(`/workspaces/${wsKey}`)}
                            sx={{ py: 0.7, cursor: "pointer", "&:hover .wsLabel": { color: tokens.kriyaInk } }}>
                            <Box sx={{ width: 24, height: 24, borderRadius: "5px", flexShrink: 0, display: "grid", placeItems: "center", bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
                              <Icon sx={{ fontSize: 14 }} />
                            </Box>
                            <Typography className="wsLabel" sx={{ fontSize: 12.5, flex: 1, color: tokens.text }} noWrap>{ws?.label ?? wsKey}</Typography>
                            <Typography sx={{ fontSize: 12, fontFamily: monoFont, color: tokens.text2 }}>{n}</Typography>
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}
                </Panel>
              </Box>
            </Box>
          ) : (
            <Board projects={searched} canEdit={canEdit} onDropTo={dropTo} onOpen={openWorkspace} dense={dense} />
          )}
        </>
      )}

      {projects && view === "reports" && canReports && (
        <Box>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }} flexWrap="wrap" gap={1}>
            <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>Every project you can see — status, timeline progress and workload. Click a row to open its workspace.</Typography>
            <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} disabled={rollup.length === 0} onClick={() => exportCsv(rollup)}>Export CSV</Button>
          </Stack>
          <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ "& th": { fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: tokens.text3, fontWeight: 600, borderColor: tokens.line } }}>
                  <TableCell>Project</TableCell><TableCell>Workspace</TableCell><TableCell>Status</TableCell>
                  <TableCell align="right">Progress</TableCell><TableCell align="right">Records</TableCell><TableCell align="right">Ends</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rollup.map((p) => {
                  const ws = getWorkspace(p.workspace);
                  return (
                    <TableRow key={p.id} hover onClick={() => openWorkspace(p)} sx={{ cursor: "pointer", "& td": { borderColor: tokens.line } }}>
                      <TableCell>
                        <Typography sx={{ fontSize: 13, fontWeight: 550 }}>{p.name}</Typography>
                        <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont }}>{p.created_by_name || "—"}</Typography>
                      </TableCell>
                      <TableCell><Typography sx={{ fontSize: 12.5 }}>{ws?.label ?? p.workspace}</Typography></TableCell>
                      <TableCell><StatusPill status={p.duration.status} /></TableCell>
                      <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.text2 }}>{p.duration.status === "none" ? "—" : `${progressPct(p)}%`}</Typography></TableCell>
                      <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.text2 }}>{p.record_count}</Typography></TableCell>
                      <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>{p.duration.end_label ?? "—"}</Typography></TableCell>
                    </TableRow>
                  );
                })}
                {rollup.length === 0 && (
                  <TableRow><TableCell colSpan={6}><Typography sx={{ fontSize: 13.5, color: tokens.text3, py: 1 }}>No projects to report on.</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      {/* Save-view dialog */}
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 18 }}>Save this view</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: tokens.text3, mb: 1.5 }}>
            Captures the current filter, search, sort and layout. It'll appear as a chip you can click to re-apply.
          </Typography>
          <TextField autoFocus fullWidth size="small" label="View name" value={saveName}
            onChange={(e) => { setSaveName(e.target.value); setSaveErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
            placeholder="e.g. Overdue this week" error={Boolean(saveErr)} helperText={saveErr || " "} />
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", mt: 0.5 }} useFlexGap>
            <ViewChipHint label={`Status: ${filter === "all" ? "All" : STATUS_UI[filter as DurationStatus].label}`} />
            {query.trim() && <ViewChipHint label={`Search: "${query.trim()}"`} />}
            <ViewChipHint label={`Sort: ${sort}`} />
            <ViewChipHint label={`Layout: ${layout}`} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveCurrent}>Save view</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ---------- small pieces ---------- */
function ViewChipHint({ label }: { label: string }) {
  return (
    <Box sx={{ px: 0.85, py: 0.3, borderRadius: "5px", bgcolor: "#F1F3F6", fontSize: 11, color: tokens.text2 }}>{label}</Box>
  );
}
function CircularProgressDot() {
  return <Box sx={{ width: 26, height: 26, borderRadius: "50%", border: `3px solid ${tokens.line}`, borderTopColor: tokens.kriya, animation: "spin 0.8s linear infinite", "@keyframes spin": { to: { transform: "rotate(360deg)" } } }} />;
}

function StatusDot({ status }: { status: DurationStatus }) {
  return <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: STATUS_UI[status].ring, flexShrink: 0 }} />;
}

function StatusPill({ status }: { status: DurationStatus }) {
  const s = STATUS_UI[status];
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 0.9, py: 0.25, borderRadius: "5px", bgcolor: s.bg }}>
      <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: s.fg }} />
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: s.fg }}>{s.label}</Typography>
    </Box>
  );
}

function MetricTile({ label, value, active, onClick, icon, attn }: {
  label: string; value: number; active: boolean; onClick: () => void; icon: ReactNode; attn?: boolean;
}) {
  const shown = useCountUp(value);
  const hot = Boolean(attn) && value > 0;
  const accent = hot ? tokens.attn : tokens.kriya;
  return (
    <Paper onClick={onClick}
      sx={{ p: 1.5, borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 1.25, position: "relative",
        border: active ? `1.5px solid ${accent}` : `1px solid ${tokens.line}`, boxShadow: active ? `0 0 0 3px ${accent}22` : "none",
        transition: "border-color .16s, box-shadow .16s, transform .12s",
        "&:hover": { transform: "translateY(-1px)", boxShadow: `0 8px 22px rgba(20,22,29,.08)${active ? `, 0 0 0 3px ${accent}22` : ""}` } }}>
      <Box sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: "7px", display: "grid", placeItems: "center",
        bgcolor: hot ? tokens.attnWash : active ? tokens.kriyaWash : "#F1F3F6", color: hot ? tokens.attn : active ? tokens.kriyaInk : tokens.text2 }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 23, fontWeight: 600, lineHeight: 1, color: hot ? tokens.attn : value > 0 ? tokens.ink : tokens.text3 }}>{shown}</Typography>
        <Typography sx={{ fontSize: 11.5, color: tokens.text2, mt: 0.4 }} noWrap>{label}</Typography>
      </Box>
    </Paper>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { key: string; label: string; icon?: ReactNode }[] }) {
  return (
    <Stack direction="row" sx={{ p: 0.35, borderRadius: 2, bgcolor: "#EEF0F3", border: `1px solid ${tokens.line}` }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Box key={o.key} onClick={() => onChange(o.key)}
            sx={{ px: 1.25, py: 0.5, borderRadius: 1.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 0.5,
              fontSize: 12.5, fontWeight: 600, color: active ? tokens.kriyaInk : tokens.text2,
              bgcolor: active ? "#fff" : "transparent", boxShadow: active ? "0 1px 2px rgba(20,22,29,.12)" : "none", transition: "background-color .14s" }}>
            {o.icon}{o.label}
          </Box>
        );
      })}
    </Stack>
  );
}

function StatusRing({ counts, active, onPick }: { counts: Record<string, number>; active: Filter; onPick: (s: Filter) => void }) {
  const segs = ([
    { key: "due", n: counts.due }, { key: "ending_soon", n: counts.ending_soon },
    { key: "active", n: counts.active }, { key: "completed", n: counts.completed }, { key: "none", n: counts.none },
  ] as { key: DurationStatus; n: number }[]).filter((s) => s.n > 0);
  const total = segs.reduce((s, x) => s + x.n, 0) || 1;
  const r = 52, C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Box>
      <Box sx={{ display: "grid", placeItems: "center", py: 0.5 }}>
        <Box sx={{ position: "relative", width: 132, height: 132 }}>
          <svg width="132" height="132" viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="70" cy="70" r={r} fill="none" stroke={tokens.line} strokeWidth="16" />
            {segs.map((s) => {
              const len = (s.n / total) * C;
              const el = <circle key={s.key} cx="70" cy="70" r={r} fill="none" stroke={STATUS_UI[s.key].ring} strokeWidth={active === s.key ? 20 : 16}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} style={{ cursor: "pointer", transition: "stroke-width .16s" }}
                onClick={() => onPick(active === s.key ? "all" : s.key)} />;
              offset += len;
              return el;
            })}
          </svg>
          <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <Box sx={{ textAlign: "center" }}>
              <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 25, fontWeight: 700, lineHeight: 1 }}>{counts.all}</Typography>
              <Typography sx={{ fontSize: 10.5, color: tokens.text3 }}>projects</Typography>
            </Box>
          </Box>
        </Box>
      </Box>
      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
        {([["due", "Overdue"], ["ending_soon", "Ending soon"], ["active", "In progress"], ["completed", "Completed"]] as [DurationStatus, string][]).map(([k, label]) => (
          <Stack key={k} direction="row" alignItems="center" spacing={1} onClick={() => onPick(active === k ? "all" : k)}
            sx={{ py: 0.4, px: 0.5, borderRadius: 1, cursor: "pointer", bgcolor: active === k ? STATUS_UI[k].bg : "transparent", "&:hover": { bgcolor: STATUS_UI[k].bg } }}>
            <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: STATUS_UI[k].ring }} />
            <Typography sx={{ fontSize: 12, flex: 1, color: tokens.text2 }}>{label}</Typography>
            <Typography sx={{ fontSize: 12, fontFamily: monoFont, color: tokens.text }}>{counts[k]}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function ProjectCard({ p, dense, canEdit, onOpen, onComplete }: {
  p: WorkspaceProject; dense: boolean; canEdit: boolean; onOpen: () => void; onComplete: () => void;
}) {
  const ws = getWorkspace(p.workspace);
  const s = STATUS_UI[p.duration.status];
  const meta = durMeta(p);
  return (
    <Paper onClick={onOpen}
      sx={{ p: dense ? 1.25 : 1.75, borderRadius: "8px", cursor: "pointer", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: `${dense ? 2 : 4}px 13px`,
        transition: "box-shadow .16s, transform .16s, border-color .16s",
        "& .qa": { opacity: 0, transition: "opacity .14s" },
        "&:hover": { boxShadow: "0 2px 4px rgba(20,22,29,.06), 0 12px 32px rgba(20,22,29,.1)", transform: "translateY(-1px)", borderColor: "#DADEE4" },
        "&:hover .qa": { opacity: 1 } }}>
      <Box sx={{ width: 9, height: 9, borderRadius: "50%", mt: 0.9, bgcolor: s.fg }} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
          <Typography sx={{ fontSize: dense ? 13.5 : 14.5, fontWeight: 600 }}>{p.name}</Typography>
          <StatusPill status={p.duration.status} />
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mt: 0.6, flexWrap: "wrap" }} useFlexGap>
          <Box component="span" sx={{ fontFamily: monoFont, fontSize: 10.5, fontWeight: 600, px: 0.75, py: 0.15, borderRadius: "4px", bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>{ws?.label ?? p.workspace}</Box>
          <Stack direction="row" alignItems="center" spacing={0.4}>
            <AccessTimeRoundedIcon sx={{ fontSize: 13, color: meta.color }} />
            <Typography sx={{ fontSize: 12, color: meta.color, fontWeight: p.duration.status === "due" ? 600 : 400 }}>{meta.text}</Typography>
          </Stack>
          <Box sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: tokens.text3 }} />
          <Typography sx={{ fontSize: 11.5, color: tokens.text3, fontFamily: monoFont }}>{p.record_count} record{p.record_count === 1 ? "" : "s"}</Typography>
        </Stack>
        <Box sx={{ mt: dense ? 0.85 : 1.1 }}><StageRail status={p.duration.status} progress={progressPct(p)} /></Box>
      </Box>
      <Stack alignItems="flex-end" justifyContent="space-between">
        <Stack direction="row" alignItems="center">
          <Avatar title={p.created_by_name || undefined} sx={{ width: 24, height: 24, fontSize: 10, bgcolor: tokens.kriyaInk }}>{initials(p.created_by_name)}</Avatar>
          <StarRoundedIcon sx={{ fontSize: 12, color: "#E5A138", ml: 0.25 }} />
        </Stack>
        <Stack className="qa" direction="row" spacing={0.5} sx={{ mt: 1 }}>
          <QuickAction icon={<LaunchRoundedIcon sx={{ fontSize: 14 }} />} label="Open" onClick={onOpen} />
          {canEdit && p.duration.status !== "completed" && p.duration.status !== "none" && (
            <QuickAction icon={<CheckCircleRoundedIcon sx={{ fontSize: 14 }} />} label="Done" onClick={onComplete} accent />
          )}
        </Stack>
        {/* Open is redundant with the whole-card click but kept as a clear affordance. */}
      </Stack>
    </Paper>
  );
}

function QuickAction({ icon, label, onClick, accent }: { icon: ReactNode; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <Box component="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.4, px: 0.75, py: 0.35, borderRadius: 1.5, cursor: "pointer",
        border: `1px solid ${accent ? `${categoryColors.done}66` : tokens.line}`, bgcolor: accent ? STATUS_UI.completed.bg : "#fff",
        color: accent ? STATUS_UI.completed.fg : tokens.text2, fontSize: 11, fontWeight: 600,
        "&:hover": { borderColor: accent ? categoryColors.done : "#C5CAD2" } }}>
      {icon}{label}
    </Box>
  );
}

const STAGES = ["Started", "In progress", "Ending soon", "Due", "Completed"];
const STAGE_INDEX: Record<DurationStatus, number> = { none: -1, active: 1, ending_soon: 2, due: 3, completed: 4 };

function StageRail({ status, progress }: { status: DurationStatus; progress: number }) {
  if (status === "none") return <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>No duration set — add one in the workspace to track progress.</Typography>;
  const cur = STAGE_INDEX[status];
  const color = STATUS_UI[status].ring;
  return (
    <Box>
      <Box sx={{ position: "relative", height: 12 }}>
        <Box sx={{ position: "absolute", top: -2, left: `calc(${Math.min(100, Math.max(0, progress))}% - 4px)`, transition: "left .3s",
          width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `5px solid ${tokens.ink}` }} />
        <Box sx={{ display: "flex", gap: 0.5, position: "absolute", top: 5, left: 0, right: 0 }}>
          {STAGES.map((_, i) => (
            <Box key={i} sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: i <= cur ? color : tokens.line, transition: "background-color .2s" }} />
          ))}
        </Box>
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
        {STAGES.map((label, i) => (
          <Typography key={label} sx={{ flex: 1, textAlign: "center", fontSize: 10, lineHeight: 1.2, color: i === cur ? color : tokens.text3, fontWeight: i === cur ? 700 : 400 }}>{label}</Typography>
        ))}
      </Box>
    </Box>
  );
}

const COLUMNS: { key: DurationStatus; label: string }[] = [
  { key: "due", label: "Overdue" }, { key: "ending_soon", label: "Ending soon" },
  { key: "active", label: "In progress" }, { key: "completed", label: "Completed" },
];

function Board({ projects, canEdit, onDropTo, onOpen, dense }: {
  projects: WorkspaceProject[]; canEdit: (p: WorkspaceProject) => boolean;
  onDropTo: (p: WorkspaceProject, s: DurationStatus) => void; onOpen: (p: WorkspaceProject) => void; dense: boolean;
}) {
  const dragged = useRef<WorkspaceProject | null>(null);
  const [over, setOver] = useState<DurationStatus | null>(null);
  const inCol = (k: DurationStatus) => projects.filter((p) => p.duration.status === k);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,1fr)", lg: "repeat(4,1fr)" }, gap: 1.5, alignItems: "start" }}>
      {COLUMNS.map((col) => {
        const items = inCol(col.key);
        const isOver = over === col.key;
        return (
          <Box key={col.key}
            onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={() => { if (dragged.current) onDropTo(dragged.current, col.key); dragged.current = null; setOver(null); }}
            sx={{ borderRadius: "8px", p: 1, minHeight: 120, bgcolor: isOver ? STATUS_UI[col.key].bg : "#F5F6F8",
              border: `1.5px ${isOver ? "dashed" : "solid"} ${isOver ? STATUS_UI[col.key].ring : tokens.line}`, transition: "background-color .12s, border-color .12s" }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 0.5, py: 0.5, mb: 0.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: STATUS_UI[col.key].ring }} />
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{col.label}</Typography>
              <Typography sx={{ fontSize: 11.5, fontFamily: monoFont, color: tokens.text3 }}>{items.length}</Typography>
            </Stack>
            <Stack spacing={1}>
              {items.map((p) => {
                const s = STATUS_UI[p.duration.status];
                const meta = durMeta(p);
                const draggable = canEdit(p);
                return (
                  <Paper key={p.id} draggable={draggable} onClick={() => onOpen(p)}
                    onDragStart={() => { dragged.current = p; }} onDragEnd={() => { dragged.current = null; setOver(null); }}
                    sx={{ p: dense ? 1 : 1.25, borderRadius: "6px", cursor: draggable ? "grab" : "pointer", borderLeft: `3px solid ${s.ring}`,
                      "&:active": draggable ? { cursor: "grabbing" } : {}, "&:hover": { boxShadow: "0 6px 18px rgba(20,22,29,.1)" } }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>{p.name}</Typography>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.5, flexWrap: "wrap" }} useFlexGap>
                      <Box component="span" sx={{ fontFamily: monoFont, fontSize: 9.5, fontWeight: 600, px: 0.6, py: 0.1, borderRadius: "4px", bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>{getWorkspace(p.workspace)?.label ?? p.workspace}</Box>
                      <Typography sx={{ fontSize: 11, color: meta.color, fontWeight: p.duration.status === "due" ? 600 : 400 }}>{meta.text}</Typography>
                    </Stack>
                    <Box sx={{ mt: 0.75, height: 5, borderRadius: 3, bgcolor: tokens.line, overflow: "hidden" }}>
                      <Box sx={{ width: `${progressPct(p)}%`, height: "100%", bgcolor: s.ring, transition: "width .3s" }} />
                    </Box>
                  </Paper>
                );
              })}
              {items.length === 0 && <Typography sx={{ fontSize: 11, color: tokens.text3, px: 0.5, py: 1.5, textAlign: "center" }}>{col.key === "completed" ? "Drop here to complete" : "Nothing here"}</Typography>}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2, borderRadius: "6px" }}>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".07em", color: tokens.text3, fontWeight: 600, mb: 1.5 }}>{title}</Typography>
      {children}
    </Paper>
  );
}
