import { useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "../useAutoRefresh";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, Paper, Snackbar, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import { getWorkspace, useWorkspaces, dynamicWorkspacesReady } from "../features/workspaces/workspaces";
import { getProject, updateProject, completeProject, submitProject, approveProject, rejectProject, type WorkspaceProject } from "../features/workspaces/projectsApi";
import MembersDialog from "../features/workspaces/MembersDialog";
import { listProjectMembers, projectMemberScope } from "../features/workspaces/projectMembersApi";
import { listRecords, type WorkspaceRecord } from "../features/workspaces/recordsApi";
import { listSections, createSection, updateSection, type WorkspaceSection } from "../features/workspaces/sectionsApi";
import { buildSectionTree, builtinKeyOf, recordIn, type SectionNode } from "../features/workspaces/sectionTree";
import { stringsToFields, type FieldDef } from "../features/workspaces/fields";
import { SectionDrawer } from "../features/workspaces/SectionDrawer";
import { InlineRename } from "../features/workspaces/InlineRename";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { DurationPanel } from "../features/workspaces/durationDisplay";
import { ApprovalTimeline } from "../features/workspaces/ApprovalTimeline";
import RepeatPanel from "../features/workspaces/RepeatPanel";
import { tokens } from "../theme";

// Warm sand section tiles (dark ink text), on the near-white page.
const SECTION_BG = "#EAE1D2";
const SECTION_BORDER = "#DDD2BF";
const SECTION_TEXT = "#2A2620";

export default function WorkspaceProjectPage() {
  const { key, projectId } = useParams<{ key: string; projectId: string }>();
  const navigate = useNavigate();
  useWorkspaces();                                    // load + subscribe so dynamic workspaces resolve
  const ws = getWorkspace(key);
  const pid = Number(projectId);
  const { mine, loading: accessLoading } = useMyAccess();

  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [params, setParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState<"fields" | "records" | "children">("records");
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [rows, setRows] = useState<WorkspaceSection[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newParent, setNewParent] = useState<SectionNode | null>(null);
  const [newName, setNewName] = useState("");
  const [newBlurb, setNewBlurb] = useState("");
  const [newErr, setNewErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; undo: () => void } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  // Stable across renders — the dialog reloads whenever its scope identity changes.
  const memberScope = useMemo(() => projectMemberScope(pid), [pid]);

  const load = () => {
    if (!pid) { setRecords([]); return; }
    listRecords(pid).then(setRecords).catch(() => setRecords([]));
  };
  const refreshSections = () => listSections(pid).then(setRows);
  useAutoRefresh(() => { load(); refreshSections().catch(() => {}); });
  const refreshMemberCount = () => {
    if (!pid) return;
    listProjectMembers(pid).then((m) => setMemberCount(m.length)).catch(() => {});
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pid) getProject(pid).then(setProject).catch(() => setProject(null));
    load();
    refreshMemberCount();
    refreshSections().catch(() => setRows([]));
  }, [projectId]);

  // Built-in categories merged with the project's section rows, assembled into a
  // tree. Only *top-level* rows may claim a built-in's identity, which is what
  // lets two sub-sections in different branches share a name.
  const tree = useMemo(
    () => buildSectionTree(ws?.categories ?? [], rows, records),
    [ws, rows, records],
  );

  // The open section rides in the URL, so a refresh or a pasted link lands in
  // the same place. Selection used to be component state and was lost on reload.
  const currentKey = params.get("section");
  const selected = currentKey ? tree.byKey.get(currentKey) ?? null : null;
  const selectedRecords = selected ? records.filter((r) => recordIn(r, selected)) : [];

  // A key that no longer resolves (deleted elsewhere, or a stale link) drops
  // back to the grid rather than showing an empty drawer.
  useEffect(() => {
    if (currentKey && rows.length && !tree.byKey.has(currentKey)) {
      setParams((p) => { const n = new URLSearchParams(p); n.delete("section"); return n; }, { replace: true });
    }
  }, [currentKey, rows.length, tree, setParams]);

  const openNode = (key: string | null, tab: "fields" | "records" | "children" = "records") => {
    setSelectedTab(tab);
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (key) n.set("section", key); else n.delete("section");
      return n;
    }, { replace: true });
  };

  if (!ws) {
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
  const level = accessLevel(mine, ws.key);
  const canEdit = level === "edit";
  const isEnt = ws.key === "entomology";

  /** A built-in section has no row until it is customised. Anything that needs
   *  an id — saving a schema, adding a sub-section — adopts it first. */
  const ensureRow = async (node: SectionNode): Promise<number> => {
    if (node.id != null) return node.id;
    // Built-ins nest, and a row's parent is a real foreign key — so adopting a
    // built-in sub-section means adopting the trail above it first. Recursion
    // terminates at a root (parent null) or at any ancestor already adopted.
    const parent = node.parent ? await ensureRow(node.parent) : null;
    const builtin = builtinKeyOf(node);
    try {
      const row = await createSection({
        project: pid, name: node.name, blurb: node.blurb, fields: node.fieldDefs, parent,
        builtinKey: builtin,
      });
      return row.id;
    } catch (e) {
      // A 400 means something adopted it first (a double-click, a second tab).
      // Re-read and reuse that row rather than surfacing a confusing error.
      const fresh = await listSections(pid);
      setRows(fresh);
      const found = fresh.find((r) => (
        // Prefer the key: it identifies the built-in even if it was renamed
        // between our read and this write.
        builtin ? r.builtin_key === builtin
          : r.parent === parent && r.name.trim().toLowerCase() === node.name.trim().toLowerCase()
      ));
      if (found) return found.id;
      throw e;
    }
  };

  /** Rename the project. Throws with a message the heading shows inline —
   *  the server rejects a name another project in this workspace already has. */
  const renameProject = async (name: string) => {
    try {
      setProject(await updateProject(pid, { name }));
    } catch (e) {
      const data = (e as { response?: { data?: Record<string, string[]> } }).response?.data;
      throw new Error(data?.name?.[0] ?? "Could not rename this project.");
    }
  };

  const saveFields = async (node: SectionNode, fields: FieldDef[]) => {
    await updateSection(await ensureRow(node), { fields });
    await refreshSections();
  };

  /** Rename a section (and its description). Throws with a message the drawer
   *  shows inline. Built-ins are adopted first, exactly as saving fields does. */
  const renameSection = async (node: SectionNode, name: string, blurb: string) => {
    // Sibling clash. The server enforces this over *rows*, which cannot see a
    // built-in nobody has customised yet — renaming onto one of those would
    // otherwise pass and leave two identically named tiles side by side.
    const siblings = node.parent ? node.parent.children : tree.roots;
    const clash = siblings.some(
      (s) => s.key !== node.key && s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (clash) throw new Error("A section with this name already exists here.");

    const id = await ensureRow(node);
    // Send the built-in key alongside: a section adopted before that column
    // existed has none, and without it this rename would detach it from the
    // built-in it stands for. Re-sending the same key on a row that has one is
    // accepted; repointing it is not.
    const builtin = builtinKeyOf(node);
    try {
      await updateSection(id, { name, blurb, ...(builtin ? { builtin_key: builtin } : {}) });
    } catch (e) {
      const data = (e as { response?: { data?: Record<string, string[]> } }).response?.data;
      throw new Error(data?.name?.[0] ?? data?.detail?.[0] ?? "Could not rename this section.");
    }
    await refreshSections();
    load();     // the server mirrors the new name onto this section's records
  };

  const saveSection = async () => {
    const name = newName.trim();
    if (!name || !pid) return;
    setCreating(true);
    setNewErr("");
    try {
      const parent = newParent ? await ensureRow(newParent) : null;
      const created = await createSection({
        project: pid, parent, name, blurb: newBlurb.trim(), fields: stringsToFields(["Description"]),
      });
      setNewName("");
      setNewBlurb("");
      setNewOpen(false);
      setNewParent(null);
      await refreshSections();
      openNode(String(created.id), "fields");
    } catch (e) {
      const detail = (e as { response?: { data?: { name?: string[] } } }).response?.data?.name?.[0];
      setNewErr(detail ?? "Could not create section.");
      // The parent may have been adopted before the child failed; keep the tree
      // honest either way.
      refreshSections().catch(() => {});
    } finally {
      setCreating(false);
    }
  };

  const openNewSection = (parent: SectionNode | null) => {
    setNewErr("");
    setNewName("");
    setNewBlurb("");
    setNewParent(parent);
    setNewOpen(true);
  };

  // Delete works on every section and is reversible: the section is hidden for
  // this project (its records are kept), so it can be undone or restored intact.
  // Sub-sections are left alone — they are hidden by their ancestor, so a
  // restore brings the subtree back exactly as it was.
  const deleteSectionNode = async (node: SectionNode) => {
    const id = node.id ?? (await createSection({
      project: pid, name: node.name, blurb: node.blurb, fields: node.fieldDefs, hidden: true,
      // A built-in sub-section deleted before it was ever customised still needs
      // its parent, or the row would land at the root of the project.
      parent: node.parent ? await ensureRow(node.parent) : null,
      builtinKey: builtinKeyOf(node),
    })).id;
    if (node.id) await updateSection(id, { hidden: true });
    openNode(node.parent ? node.parent.key : null);
    await refreshSections();
    load();
    setSnack({ msg: `"${node.name}" deleted`, undo: () => restoreSection(id) });
  };

  const restoreSection = async (id: number) => {
    await updateSection(id, { hidden: false });
    setSnack(null);
    refreshSections();
    load();
  };

  const backBtn = (
    <Button size="small" startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 17 }} />} onClick={() => navigate(`/workspaces/${ws.key}`)}
      sx={{ color: tokens.text2, mb: 1, ml: -0.5 }}>
      {ws.label}
    </Button>
  );

  if (accessLoading) {
    return (
      <Box sx={{ px: 3, py: 2.5 }}>
        {backBtn}
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      </Box>
    );
  }
  if (level === "none") {
    return (
      <Box sx={{ px: 3, py: 2.5 }}>
        {backBtn}
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: "6px", mt: 1 }}>
          <LockRoundedIcon sx={{ fontSize: 30, color: tokens.text3, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No access</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>
            Your role can't open the {ws.label} workspace.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      {/* breadcrumb back to the workspace's project list */}
      {backBtn}

      {/* head */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.75 }}>
        <Box sx={{ width: 42, height: 42, borderRadius: "8px", flexShrink: 0, display: "grid", placeItems: "center",
          bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
          <Icon sx={{ fontSize: 23 }} />
        </Box>
        <InlineRename
          value={project?.name ?? "Project"}
          label="Project name"
          onSave={canEdit && project ? renameProject : undefined}
          subtitle={
            <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>{ws.label} · project</Typography>
          }
        />
        <Tooltip title={memberCount
          ? "Members — this project is limited to them"
          : "Members — open to everyone in this workspace"}>
          <Button size="small" variant="outlined" startIcon={<GroupRoundedIcon sx={{ fontSize: 17 }} />}
            onClick={() => setMembersOpen(true)}
            sx={{ color: tokens.text2, borderColor: tokens.line, whiteSpace: "nowrap", flexShrink: 0,
              "&:hover": { borderColor: tokens.kriya, bgcolor: "rgba(15,122,139,.06)" } }}>
            Members{memberCount ? ` · ${memberCount}` : ""}
          </Button>
        </Tooltip>
      </Stack>

      {project && (
        <Box sx={{ mt: 1.5 }}>
          <DurationPanel
            duration={project.duration}
            completedAt={project.completed_at}
            canEdit={canEdit}
            allowSet={true}
            onSet={(startAt, endAt) => updateProject(pid, { start_at: startAt, end_at: endAt }).then(setProject)}
            onToggleComplete={() => completeProject(pid).then(setProject)}
            reviewState={project.review_state}
            reviewReason={project.review_reason}
            canApprove={project.can_approve}
            onSubmit={() => submitProject(pid).then(setProject)}
            onApprove={() => approveProject(pid).then(setProject)}
            onReject={() => {
              const r = window.prompt(`Block “${project.name}” — what needs to change? (the owner is notified)`);
              return r && r.trim() ? rejectProject(pid, r.trim()).then(setProject) : undefined;
            }}
          />
          <Box sx={{ mt: 1.5 }}>
            <RepeatPanel project={project} canEdit={canEdit}
              onChange={(f) => updateProject(pid, { repeat_frequency: f }).then(setProject)} />
          </Box>
          <Box sx={{ mt: 1.5 }}>
            {/* Refreshes whenever the project's lifecycle state moves. */}
            <ApprovalTimeline projectId={pid}
              reloadKey={`${project.review_state}|${project.submitted_at}|${project.reviewed_at}|${project.completed_at}`} />
          </Box>
        </Box>
      )}

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2.5, mb: 1.25 }}>
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600 }}>
          Sections
        </Typography>
        {!canEdit && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: tokens.text3 }}>
            <VisibilityRoundedIcon sx={{ fontSize: 14 }} />
            <Typography sx={{ fontSize: 11 }}>View only</Typography>
          </Stack>
        )}
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)" }, gap: 1 }}>
        {tree.roots.map((n) => (
          <SectionTag key={n.key} name={n.name}
            subtitle={n.ownCount ? `${n.ownCount} record${n.ownCount === 1 ? "" : "s"}` : "No records yet"}
            subtleSub={!n.ownCount} childCount={n.children.length} totalCount={n.totalCount}
            onClick={() => openNode(n.key)}
            onDelete={canEdit ? () => deleteSectionNode(n) : undefined} />
        ))}
        {/* Add-a-section tile — editors only */}
        {canEdit && (
          <Box onClick={() => openNewSection(null)}
            sx={{ minHeight: 78, borderRadius: "3px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0.5,
              border: "1.5px dashed #C9BCA6", color: tokens.text2, cursor: "pointer", textAlign: "center",
              transition: "border-color .16s, background-color .16s, color .16s",
              "&:hover": { borderColor: tokens.kriya, color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.06)" } }}>
            <AddRoundedIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>New section</Typography>
          </Box>
        )}
      </Box>

      {/* Restore top-level sections that were deleted (hidden) for this project.
          A deleted sub-section is restored from inside its parent, which is
          where it was deleted. */}
      {canEdit && tree.hiddenRoots.length > 0 && (
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: tokens.text3, mr: 0.25 }}>Hidden:</Typography>
          {tree.hiddenRoots.map((h) => (
            <Box key={h.key} onClick={() => h.id != null && restoreSection(h.id)}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.375, borderRadius: "999px",
                border: `1px dashed ${tokens.line}`, color: tokens.text2, cursor: "pointer", fontSize: 11.5,
                "&:hover": { borderColor: tokens.kriya, color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.06)" } }}>
              <ReplayRoundedIcon sx={{ fontSize: 13 }} />
              {h.name}
            </Box>
          ))}
        </Box>
      )}

      {/* Section drawer — sub-sections, Fields builder, generated Records form */}
      <Drawer anchor="right" open={!!selected} onClose={() => openNode(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, maxWidth: "96vw", overflow: "hidden" } }}>
        {selected && (
          <SectionDrawer
            key={selected.key}
            node={selected}
            projectName={project?.name ?? "Project"}
            project={pid}
            records={selectedRecords}
            canEdit={canEdit}
            showDuration={isEnt}
            initialTab={selectedTab}
            onClose={() => openNode(null)}
            onOpenNode={(key) => openNode(key)}
            onAddChild={() => openNewSection(selected)}
            onRestoreChild={(id) => restoreSection(id)}
            onRecordsChanged={load}
            onSaveFields={(fields) => saveFields(selected, fields)}
            onRenameSection={canEdit ? (name, blurb) => renameSection(selected, name, blurb) : undefined}
            onDeleteSection={canEdit ? () => deleteSectionNode(selected) : undefined}
          />
        )}
      </Drawer>

      {/* Who can open this project. Empty = the whole workspace, so the note has
          to say so — otherwise "no members" reads as "nobody has access". */}
      <MembersDialog open={membersOpen} onClose={() => setMembersOpen(false)}
        scope={memberScope} canManage={canEdit} onChanged={refreshMemberCount}
        removeTooltip="Remove from project"
        note={<>
          Who can open <b>{project?.name ?? "this project"}</b>. With nobody listed it's open to
          everyone who can open {ws.label}; add someone and it's limited to that list.
          IT&nbsp;Team, Management and admins always see it.
        </>}
        emptyNote={<>
          Nobody listed — everyone with access to {ws.label} can open this project.
          {canEdit ? " Add someone above to limit it." : ""}
        </>} />

      {/* New section / sub-section dialog */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>
          {newParent ? `New sub-section in ${newParent.name}` : "New section"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField size="small" label="Section name" value={newName} autoFocus fullWidth
              onChange={(e) => setNewName(e.target.value)} />
            <TextField size="small" label="Description (optional)" value={newBlurb} fullWidth multiline minRows={2}
              onChange={(e) => setNewBlurb(e.target.value)} />
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
              You'll set up its fields next.
            </Typography>
            {newErr && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{newErr}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveSection} disabled={creating || !newName.trim()}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Undo a section delete */}
      <Snackbar open={!!snack} autoHideDuration={6000} onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={snack?.msg}
        action={
          <Button size="small" onClick={() => snack?.undo()} sx={{ color: tokens.kriyaGlow, fontWeight: 700 }}>
            Undo
          </Button>
        } />
    </Box>
  );
}

export function SectionTag({ name, subtitle, subtleSub, childCount = 0, totalCount = 0, onClick, onDelete }: {
  name: string; subtitle: string; subtleSub?: boolean; childCount?: number; totalCount?: number;
  onClick?: () => void; onDelete?: () => void;
}) {
  const hasChildren = childCount > 0;
  return (
    <Box onClick={onClick}
      sx={{ position: "relative", bgcolor: SECTION_BG, color: SECTION_TEXT, border: `1px solid ${SECTION_BORDER}`, borderRadius: "3px", minHeight: hasChildren ? 92 : 78, px: 1.25, py: 1.25,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
        cursor: onClick ? "pointer" : "default", transition: "background-color .16s, box-shadow .16s, transform .16s",
        ...(onClick ? { "&:hover": { bgcolor: "#E3D9C6", boxShadow: "0 4px 12px rgba(20,22,29,.1)", transform: "translateY(-1px)" } } : {}),
        // A stacked-paper edge reads as "there's more inside" without spending a
        // new colour or an icon on it.
        ...(hasChildren ? {
          "&::after": {
            content: '""', position: "absolute", inset: 0, zIndex: -1,
            transform: "translate(4px, 4px)", borderRadius: "3px",
            bgcolor: SECTION_BG, border: `1px solid ${SECTION_BORDER}`,
          },
        } : {}),
        "&:hover .sec-del": { opacity: 1 } }}>
      {onDelete && (
        <IconButton className="sec-del" size="small" title="Delete section"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          sx={{ position: "absolute", top: 4, right: 4, opacity: 0, transition: "opacity .14s, color .14s, background-color .14s",
            color: "#8A8270", bgcolor: "rgba(255,255,255,.7)", "&:hover": { color: tokens.attn, bgcolor: tokens.attnWash } }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{name}</Typography>
      <Typography sx={{ fontSize: 10.5, color: subtleSub ? "#A79E8C" : "#8A8270", mt: 0.25 }}>{subtitle}</Typography>
      {hasChildren && (
        <Typography sx={{ fontSize: 10, color: "#8A8270", mt: 0.4 }}>
          {childCount} sub-section{childCount === 1 ? "" : "s"}
          {totalCount > 0 ? ` · ${totalCount} total` : ""}
        </Typography>
      )}
    </Box>
  );
}
