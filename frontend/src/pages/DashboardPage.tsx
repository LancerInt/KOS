/**
 * Dashboard — the single home. Consolidates the personal work queue, the
 * portfolio overview, and reports over workspace projects (access-scoped).
 *
 * Interactions: metric tiles filter the list; a command strip
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
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
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

import { listAllProjects, completeProject, submitProject, approveProject, rejectProject, downloadProjectsXlsx, type WorkspaceProject } from "../features/workspaces/projectsApi";
import type { DurationStatus } from "../features/workspaces/projectsApi";
import { listSavedViews, createSavedView, deleteSavedView, type SavedView } from "../features/views/savedViewsApi";
import { getWorkspace } from "../features/workspaces/workspaces";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { useAppSelector } from "../hooks";
import { AiActionBar } from "../features/ai/AiActionButton";
import { useAiPageContext } from "../features/ai/AiContext";
import DailyStandupWidget from "../features/ai/DailyStandupWidget";
import PortfolioInsightsWidget from "../features/ai/PortfolioInsightsWidget";
import PortfolioCharts from "../features/dashboard/PortfolioCharts";
import { tokens, monoFont, categoryColors } from "../theme";

type Filter = "all" | DurationStatus | "blocked" | "needs_decision";
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

/** Every value a filter chip can hold, so a saved view restoring a stale or
 *  hand-edited config can't seat one the UI has no name for. */
const FILTERS: Filter[] = ["all", "due", "ending_soon", "active", "none", "completed", "blocked", "needs_decision"];
const asFilter = (value: unknown): Filter =>
  FILTERS.includes(value as Filter) ? (value as Filter) : "all";

/** The human name for the active filter.
 *
 *  `Filter` is wider than `DurationStatus` — it also carries the two review
 *  states — so this cannot be a plain `STATUS_UI` lookup. It used to be one,
 *  behind an `as DurationStatus` cast, which type-checked and then read
 *  `undefined.label` the moment anyone filtered by "Needs decision". Narrowing
 *  instead of casting means the compiler now catches the next filter added. */
function filterLabel(filter: Filter): string {
  if (filter === "all") return "All";
  if (filter === "blocked" || filter === "needs_decision") return REVIEW_UI[filter].label;
  return STATUS_UI[filter].label;
}
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
    default:
      // none — no dates. If it's in the approval flow, say that instead of the
      // bare "No duration set", which reads as a contradiction once submitted.
      if (p.review_state === "needs_decision") return { text: "Awaiting approval", color: "#C0417A" };
      if (p.review_state === "blocked") return { text: "Sent back for changes", color: "#C7891B" };
      return { text: "No duration set", color: tokens.text3 };
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

  // Reflect approvals/blocks made elsewhere (e.g. the Notifications action tab)
  // without waiting for a remount.
  useEffect(() => {
    const onChange = () => reload();
    window.addEventListener("kos:projects-changed", onChange);
    return () => window.removeEventListener("kos:projects-changed", onChange);
  }, []);

  const applyView = (v: SavedView) => {
    const c = v.config as Partial<DashConfig>;
    setFilter(asFilter(c.filter));
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
    const c = { all: (projects ?? []).length, due: 0, ending_soon: 0, active: 0, completed: 0, none: 0, blocked: 0, needs_decision: 0 } as Record<string, number>;
    for (const p of projects ?? []) {
      c[p.duration.status] += 1;
      if (p.review_state === "blocked") c.blocked += 1;
      else if (p.review_state === "needs_decision") c.needs_decision += 1;
    }
    return c;
  }, [projects]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (getWorkspace(p.workspace)?.label ?? p.workspace).toLowerCase().includes(q));
    return base;
  }, [projects, query]);

  const listShown = useMemo(() => {
    const out = searched.filter((p) =>
      filter === "all" ? true
        : filter === "blocked" ? p.review_state === "blocked"
          : filter === "needs_decision" ? p.review_state === "needs_decision"
            : p.duration.status === filter);
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
  // Approval workflow. Who may approve which project is decided server-side
  // (p.can_approve) so the "no self-approval / lone-approver" rules live in one place.
  const submitForApproval = (p: WorkspaceProject) => { submitProject(p.id).then(reload).catch(() => {}); };
  const approve = (p: WorkspaceProject) => { approveProject(p.id).then(reload).catch(() => {}); };
  const reject = (p: WorkspaceProject) => {
    const reason = window.prompt(`Block “${p.name}” — what needs to change? (the owner is notified)`);
    if (reason && reason.trim()) rejectProject(p.id, reason.trim()).then(reload).catch(() => {});
  };
  const dropTo = (p: WorkspaceProject, col: DurationStatus) => {
    if (!canEdit(p)) return;
    const isDone = p.duration.status === "completed";
    // Completion runs through approval now: dropping onto Completed submits for
    // sign-off (unless already done or already in review); dragging out reopens.
    if (col === "completed") {
      if (!isDone && !p.review_state) submitForApproval(p);
    } else if (isDone) {
      toggleComplete(p);
    }
  };
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(",", " ·");

  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const exportXlsx = async () => {
    setExporting(true); setExportErr("");
    try {
      await downloadProjectsXlsx();
    } catch {
      setExportErr("Couldn't build the Excel file. Try again in a moment.");
    } finally {
      setExporting(false);
    }
  };

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
        <Stack direction="row" alignItems="center" spacing={1.5}>
          {/* Administrators only — the whole portfolio in one file is a wider
              reach than the per-workspace access everyone else holds. The
              server enforces it; this only decides whether to offer it. */}
          {mine?.is_admin && (
            <Button size="small" variant="outlined" disabled={exporting}
              startIcon={exporting
                ? <CircularProgressDot />
                : <DownloadRoundedIcon sx={{ fontSize: 17 }} />}
              onClick={exportXlsx}
              sx={{ color: tokens.text2, borderColor: tokens.line, whiteSpace: "nowrap",
                "&:hover": { borderColor: tokens.kriya, bgcolor: "rgba(15,122,139,.06)" } }}>
              {exporting ? "Preparing…" : "Export Excel"}
            </Button>
          )}
          <Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>{dateStr}</Typography>
        </Stack>
      </Stack>
      {exportErr && (
        <Typography sx={{ fontSize: 12.5, color: tokens.attn, mb: 1.5 }}>{exportErr}</Typography>
      )}

      {/* AI actions */}
      <Box sx={{ mb: 2 }}>
        <AiActionBar>
          <DailyStandupWidget />
          <PortfolioInsightsWidget />
        </AiActionBar>
      </Box>

      {/* A · metric tiles as filters — one row: duration status + review states.
          minmax(0,1fr) lets the 7 tracks shrink instead of forcing the page wider. */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", sm: "repeat(4, minmax(0,1fr))", lg: "repeat(7, minmax(0,1fr))" }, gap: 1.25, mb: 2 }}>
        <MetricTile label="Projects" value={counts.all} active={filter === "all"} onClick={() => setFilter("all")} icon={<FolderRoundedIcon sx={{ fontSize: 20 }} />} />
        <MetricTile label="Overdue" value={counts.due} active={filter === "due"} onClick={() => setFilter("due")} icon={<WarningAmberRoundedIcon sx={{ fontSize: 20 }} />} attn />
        <MetricTile label="Ending soon" value={counts.ending_soon} active={filter === "ending_soon"} onClick={() => setFilter("ending_soon")} icon={<AccessTimeRoundedIcon sx={{ fontSize: 20 }} />} />
        <MetricTile label="In progress" value={counts.active} active={filter === "active"} onClick={() => setFilter("active")} icon={<AutorenewRoundedIcon sx={{ fontSize: 20 }} />} />
        <MetricTile label="Blocked" value={counts.blocked} active={filter === "blocked"} onClick={() => setFilter("blocked")} icon={<BlockRoundedIcon sx={{ fontSize: 20 }} />} tone="#C7891B" />
        <MetricTile label="Needs decision" value={counts.needs_decision} active={filter === "needs_decision"} onClick={() => setFilter("needs_decision")} icon={<GavelRoundedIcon sx={{ fontSize: 20 }} />} tone="#C0417A" />
        <MetricTile label="Completed" value={counts.completed} active={filter === "completed"} onClick={() => setFilter("completed")} icon={<CheckCircleRoundedIcon sx={{ fontSize: 20 }} />} />
      </Box>

      {/* B · portfolio charts — where the work sits, and the weeks ahead */}
      {projects && <PortfolioCharts projects={projects} />}

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
            // Full width: the side rail that used to sit here held the panels
            // that have since been removed, and an empty 320px column would
            // just be a margin pretending to be a layout.
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
                    <ProjectCard key={p.id} p={p} dense={dense} canEdit={canEdit(p)} onOpen={() => openWorkspace(p)}
                      onSubmit={() => submitForApproval(p)} onApprove={() => approve(p)} onReject={() => reject(p)} />
                  ))}
                </Stack>
              )}
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
            <ViewChipHint label={`Status: ${filterLabel(filter)}`} />
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

function StatusPill({ status }: { status: DurationStatus }) {
  const s = STATUS_UI[status];
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 0.9, py: 0.25, borderRadius: "5px", bgcolor: s.bg }}>
      <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: s.fg }} />
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: s.fg }}>{s.label}</Typography>
    </Box>
  );
}

function MetricTile({ label, value, active, onClick, icon, attn, tone }: {
  label: string; value: number; active: boolean; onClick: () => void; icon: ReactNode; attn?: boolean; tone?: string;
}) {
  const shown = useCountUp(value);
  const hot = Boolean(attn) && value > 0;
  // A custom tone (Blocked / Needs decision) tints the tile when it has items or
  // is selected; otherwise fall back to the brand teal (or attn red for Overdue).
  const toned = Boolean(tone) && (value > 0 || active);
  const accent = hot ? tokens.attn : toned ? tone! : tokens.kriya;
  const iconBg = hot ? tokens.attnWash : toned ? `${tone}1A` : active ? tokens.kriyaWash : "#F1F3F6";
  const iconColor = hot ? tokens.attn : toned ? tone! : active ? tokens.kriyaInk : tokens.text2;
  const numColor = hot ? tokens.attn : toned && value > 0 ? tone! : value > 0 ? tokens.ink : tokens.text3;
  return (
    <Paper onClick={onClick}
      sx={{ p: 1.5, borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 1.25, position: "relative",
        border: active ? `1.5px solid ${accent}` : `1px solid ${tokens.line}`, boxShadow: active ? `0 0 0 3px ${accent}22` : "none",
        transition: "border-color .16s, box-shadow .16s, transform .12s",
        "&:hover": { transform: "translateY(-1px)", boxShadow: `0 8px 22px rgba(20,22,29,.08)${active ? `, 0 0 0 3px ${accent}22` : ""}` } }}>
      <Box sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: "7px", display: "grid", placeItems: "center", bgcolor: iconBg, color: iconColor }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 23, fontWeight: 600, lineHeight: 1, color: numColor }}>{shown}</Typography>
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

const REVIEW_UI: Record<"blocked" | "needs_decision", { label: string; color: string; wash: string }> = {
  needs_decision: { label: "Awaiting approval", color: "#9C2E5E", wash: "#FAE7F0" },
  blocked: { label: "Sent back", color: "#8A5A0F", wash: "#FBF2DF" },
};

function ReviewBadge({ state, reason }: { state: "blocked" | "needs_decision"; reason?: string }) {
  const r = REVIEW_UI[state];
  const badge = (
    <Box sx={{ display: "inline-flex", alignItems: "center", px: 0.85, py: 0.2, borderRadius: "5px", bgcolor: r.wash }}>
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: r.color }}>{r.label}</Typography>
    </Box>
  );
  return reason ? <Tooltip title={reason}>{badge}</Tooltip> : badge;
}

function ProjectCard({ p, dense, canEdit, onOpen, onSubmit, onApprove, onReject }: {
  p: WorkspaceProject; dense: boolean; canEdit: boolean;
  onOpen: () => void; onSubmit: () => void; onApprove: () => void; onReject: () => void;
}) {
  const ws = getWorkspace(p.workspace);
  const s = STATUS_UI[p.duration.status];
  const meta = durMeta(p);
  const isCompleted = p.duration.status === "completed";
  // A completed project carries no pending review. Everyone who can edit submits;
  // a *different* approver signs off — nobody approves their own submission.
  const review = !isCompleted && (p.review_state === "blocked" || p.review_state === "needs_decision") ? p.review_state : null;
  return (
    <Paper onClick={onOpen}
      sx={{ p: dense ? 1.25 : 1.75, borderRadius: "8px", cursor: "pointer", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: `${dense ? 2 : 4}px 13px`, overflow: "hidden",
        transition: "box-shadow .16s, transform .16s, border-color .16s",
        "& .qa": { opacity: 0, transition: "opacity .14s" },
        "&:hover": { boxShadow: "0 2px 4px rgba(20,22,29,.06), 0 12px 32px rgba(20,22,29,.1)", transform: "translateY(-1px)", borderColor: "#DADEE4" },
        "&:hover .qa": { opacity: 1 } }}>
      <Box sx={{ width: 9, height: 9, borderRadius: "50%", mt: 0.9, bgcolor: s.fg }} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
          <Typography sx={{ fontSize: dense ? 13.5 : 14.5, fontWeight: 600 }}>{p.name}</Typography>
          <StatusPill status={p.duration.status} />
          {review && <ReviewBadge state={review} reason={review === "blocked" ? p.review_reason : undefined} />}
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
        <Box sx={{ mt: dense ? 0.85 : 1.1 }}><StageRail p={p} /></Box>
      </Box>
      <Stack alignItems="flex-end" justifyContent="space-between">
        <Stack direction="row" alignItems="center">
          <Avatar title={p.created_by_name || undefined} sx={{ width: 24, height: 24, fontSize: 10, bgcolor: tokens.kriyaInk }}>{initials(p.created_by_name)}</Avatar>
          <StarRoundedIcon sx={{ fontSize: 12, color: "#E5A138", ml: 0.25 }} />
        </Stack>
        <Stack className="qa" direction="row" spacing={0.5} sx={{ mt: 1 }} alignItems="center">
          <QuickAction icon={<LaunchRoundedIcon sx={{ fontSize: 14 }} />} label="Open" onClick={onOpen} />
          {/* Awaiting approval → a *different* approver decides (or the lone approver) */}
          {review === "needs_decision" && p.can_approve && <>
            <QuickAction icon={<CheckCircleRoundedIcon sx={{ fontSize: 14 }} />} label="Approve" onClick={onApprove} accent />
            <QuickAction icon={<BlockRoundedIcon sx={{ fontSize: 14 }} />} label="Block" onClick={onReject} danger />
          </>}
          {/* Sent back → whoever can edit fixes and resubmits */}
          {review === "blocked" && canEdit && (
            <QuickAction icon={<SendRoundedIcon sx={{ fontSize: 14 }} />} label="Resubmit" onClick={onSubmit} primary />
          )}
          {/* Normal → everyone who can edit submits for sign-off (no self-complete) */}
          {!review && !isCompleted && canEdit && (
            <QuickAction icon={<SendRoundedIcon sx={{ fontSize: 14 }} />} label="Submit" onClick={onSubmit} primary />
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

function QuickAction({ icon, label, onClick, accent, danger, primary }: {
  icon: ReactNode; label: string; onClick: () => void; accent?: boolean; danger?: boolean; primary?: boolean;
}) {
  const v = danger
    ? { border: `${tokens.attn}55`, bg: tokens.attnWash, color: tokens.attn, hover: tokens.attn }
    : primary
      ? { border: `${tokens.kriya}55`, bg: tokens.kriyaWash, color: tokens.kriyaInk, hover: tokens.kriya }
      : accent
        ? { border: `${categoryColors.done}66`, bg: STATUS_UI.completed.bg, color: STATUS_UI.completed.fg, hover: categoryColors.done }
        : { border: tokens.line, bg: "#fff", color: tokens.text2, hover: "#C5CAD2" };
  return (
    <Box component="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.4, px: 0.75, py: 0.35, borderRadius: 1.5, cursor: "pointer",
        border: `1px solid ${v.border}`, bgcolor: v.bg, color: v.color, fontSize: 11, fontWeight: 600,
        "&:hover": { borderColor: v.hover } }}>
      {icon}{label}
    </Box>
  );
}

// The approval lifecycle rail. Duration (overdue / ending soon) still shows in
// the status pill + time text; this rail tracks the sign-off flow instead.
// The happy path: Started → In progress → Submitted → Approval → Completed.
// "Blocked" isn't a permanent stage — it only replaces the tail when a project
// is actually sent back, so a normal project never shows a Blocked step.
const STAGES_MAIN = ["Started", "In progress", "Submitted", "Approval", "Completed"];
const STAGES_BLOCKED = ["Started", "In progress", "Submitted", "Approval", "Blocked"];

/** A project's lifecycle stages, its current index and colour. */
function railStage(p: WorkspaceProject): { stages: string[]; cur: number; color: string } {
  if (p.duration.status === "completed") return { stages: STAGES_MAIN, cur: 4, color: "#2FA36B" };
  if (p.review_state === "blocked") return { stages: STAGES_BLOCKED, cur: 4, color: "#C7891B" };
  if (p.review_state === "needs_decision") return { stages: STAGES_MAIN, cur: 3, color: "#C0417A" };
  if (p.duration.status === "none") return { stages: STAGES_MAIN, cur: 0, color: tokens.kriya };
  return { stages: STAGES_MAIN, cur: 1, color: tokens.kriya };   // active / ending soon / due → In progress
}

function StageRail({ p }: { p: WorkspaceProject }) {
  const { stages, cur, color } = railStage(p);
  const lit = (i: number) => i <= cur;
  return (
    <Box>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        {stages.map((_, i) => (
          <Box key={i} sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: lit(i) ? color : tokens.line, transition: "background-color .2s" }} />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
        {stages.map((label, i) => (
          <Typography key={label} sx={{ flex: 1, textAlign: "center", fontSize: 10, lineHeight: 1.2,
            color: i === cur ? color : tokens.text3, fontWeight: i === cur ? 700 : 400,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</Typography>
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

