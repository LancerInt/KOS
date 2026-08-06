import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, Paper, Snackbar, Stack, TextField, Typography } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { getWorkspace, useWorkspaces, dynamicWorkspacesReady, type WorkspaceCategory } from "../features/workspaces/workspaces";
import { getProject, updateProject, completeProject, type WorkspaceProject } from "../features/workspaces/projectsApi";
import { listRecords, type WorkspaceRecord } from "../features/workspaces/recordsApi";
import { listSections, createSection, updateSection } from "../features/workspaces/sectionsApi";
import { stringsToFields, toFieldDefs, type FieldDef } from "../features/workspaces/fields";
import { SectionDrawer } from "../features/workspaces/SectionDrawer";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { DurationPanel } from "../features/workspaces/durationDisplay";
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
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"fields" | "records">("records");
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [sections, setSections] = useState<{ id: number; name: string; blurb: string; fields: FieldDef[]; hidden: boolean }[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBlurb, setNewBlurb] = useState("");
  const [newErr, setNewErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; undo: () => void } | null>(null);

  const load = () => {
    if (!pid) { setRecords([]); return; }
    listRecords(pid).then(setRecords).catch(() => setRecords([]));
  };
  const refreshSections = () =>
    listSections(pid).then((rows) => setSections(rows.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, fields: toFieldDefs(s.fields), hidden: !!s.hidden }))));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelectedName(null);
    if (pid) getProject(pid).then(setProject).catch(() => setProject(null));
    load();
    refreshSections().catch(() => setSections([]));
  }, [projectId]);

  const countByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of records) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [records]);

  // Merge built-in categories (from config) with the project's section rows.
  // A row that shares a built-in's name customises that built-in's fields (and,
  // when hidden, drops it from this project); remaining rows are custom sections.
  const { cats: allCats, hiddenSections } = useMemo(() => {
    const builtins = ws?.categories ?? [];
    const builtinNames = new Set(builtins.map((c) => c.name.toLowerCase()));
    const rowByName = new Map(sections.map((s) => [s.name.toLowerCase(), s]));
    const merged: WorkspaceCategory[] = builtins.map((c) => {
      const row = rowByName.get(c.name.toLowerCase());
      const fieldDefs = row && row.fields.length ? row.fields : stringsToFields(c.fields);
      return { ...c, fieldDefs, sectionId: row?.id, isCustom: false, hidden: !!row?.hidden };
    });
    const custom: WorkspaceCategory[] = sections
      .filter((s) => !builtinNames.has(s.name.toLowerCase()) && !s.hidden)
      .map((s) => ({
        name: s.name,
        blurb: s.blurb || "Custom section.",
        fields: ["Description"],
        fieldDefs: s.fields.length ? s.fields : stringsToFields(["Description"]),
        sectionId: s.id,
        isCustom: true,
      }));
    // Every hidden row (built-in or custom) can be restored via a chip.
    const hidden = sections.filter((s) => s.hidden).map((s) => ({ name: s.name, sectionId: s.id }));
    return { cats: [...merged.filter((m) => !m.hidden), ...custom], hiddenSections: hidden };
  }, [ws, sections]);

  const selected = selectedName ? allCats.find((c) => c.name === selectedName) ?? null : null;
  const selectedRecords = selected ? records.filter((r) => r.category === selected.name) : [];

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

  const openSection = (name: string, tab: "fields" | "records" = "records") => {
    setSelectedTab(tab);
    setSelectedName(name);
  };

  const saveFields = async (cat: WorkspaceCategory, fields: FieldDef[]) => {
    if (cat.sectionId) {
      await updateSection(cat.sectionId, { fields });
    } else {
      await createSection(pid, cat.name, cat.blurb, fields);
    }
    await refreshSections();
  };

  const saveSection = async () => {
    const name = newName.trim();
    if (!name || !pid) return;
    setCreating(true);
    setNewErr("");
    try {
      const created = await createSection(pid, name, newBlurb.trim(), stringsToFields(["Description"]));
      setNewName("");
      setNewBlurb("");
      setNewOpen(false);
      await refreshSections();
      openSection(created.name, "fields");
    } catch (e) {
      const detail = (e as { response?: { data?: { name?: string[] } } }).response?.data?.name?.[0];
      setNewErr(detail ?? "Could not create section.");
    } finally {
      setCreating(false);
    }
  };

  // Delete works on every section and is reversible: the section is hidden for
  // this project (its records are kept), so it can be undone or restored intact.
  const deleteSectionCat = async (cat: WorkspaceCategory) => {
    // A built-in section not yet in the DB is adopted as a hidden row first.
    const id = cat.sectionId ?? (await createSection(pid, cat.name, cat.blurb, cat.fieldDefs ?? [], true)).id;
    if (cat.sectionId) await updateSection(id, { hidden: true });
    setSelectedName(null);
    await refreshSections();
    load();
    setSnack({ msg: `"${cat.name}" deleted`, undo: () => restoreSection(id) });
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
        <Box>
          <Typography variant="h1" sx={{ fontSize: 26, lineHeight: 1.2 }}>{project?.name ?? "Project"}</Typography>
          <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>{ws.label} · project</Typography>
        </Box>
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
          />
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
        {allCats.map((c) => {
          const count = countByCategory[c.name] ?? 0;
          return (
            <SectionTag key={c.name} name={c.name}
              subtitle={count ? `${count} record${count === 1 ? "" : "s"}` : "No records yet"}
              subtleSub={!count} onClick={() => openSection(c.name)}
              onDelete={canEdit ? () => deleteSectionCat(c) : undefined} />
          );
        })}
        {/* Add-a-section tile — editors only */}
        {canEdit && (
          <Box onClick={() => { setNewErr(""); setNewOpen(true); }}
            sx={{ minHeight: 78, borderRadius: "3px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0.5,
              border: "1.5px dashed #C9BCA6", color: tokens.text2, cursor: "pointer", textAlign: "center",
              transition: "border-color .16s, background-color .16s, color .16s",
              "&:hover": { borderColor: tokens.kriya, color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.06)" } }}>
            <AddRoundedIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>New section</Typography>
          </Box>
        )}
      </Box>

      {/* Restore sections that were deleted (hidden) for this project */}
      {canEdit && hiddenSections.length > 0 && (
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: tokens.text3, mr: 0.25 }}>Hidden:</Typography>
          {hiddenSections.map((h) => (
            <Box key={h.name} onClick={() => restoreSection(h.sectionId)}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.375, borderRadius: "999px",
                border: `1px dashed ${tokens.line}`, color: tokens.text2, cursor: "pointer", fontSize: 11.5,
                "&:hover": { borderColor: tokens.kriya, color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.06)" } }}>
              <ReplayRoundedIcon sx={{ fontSize: 13 }} />
              {h.name}
            </Box>
          ))}
        </Box>
      )}

      {/* Section drawer — Fields builder + generated Records form */}
      <Drawer anchor="right" open={!!selected} onClose={() => setSelectedName(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, maxWidth: "96vw", overflow: "hidden" } }}>
        {selected && (
          <SectionDrawer
            key={selected.name}
            category={selected}
            project={pid}
            records={selectedRecords}
            canEdit={canEdit}
            showDuration={isEnt}
            initialTab={selectedTab}
            onClose={() => setSelectedName(null)}
            onRecordsChanged={load}
            onSaveFields={(fields) => saveFields(selected, fields)}
            onDeleteSection={canEdit ? () => deleteSectionCat(selected) : undefined}
          />
        )}
      </Drawer>

      {/* New section dialog */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New section</DialogTitle>
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

function SectionTag({ name, subtitle, subtleSub, onClick, onDelete }: {
  name: string; subtitle: string; subtleSub?: boolean; onClick?: () => void; onDelete?: () => void;
}) {
  return (
    <Box onClick={onClick}
      sx={{ position: "relative", bgcolor: SECTION_BG, color: SECTION_TEXT, border: `1px solid ${SECTION_BORDER}`, borderRadius: "3px", minHeight: 78, px: 1.25, py: 1.25,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
        cursor: onClick ? "pointer" : "default", transition: "background-color .16s, box-shadow .16s, transform .16s",
        ...(onClick ? { "&:hover": { bgcolor: "#E3D9C6", boxShadow: "0 4px 12px rgba(20,22,29,.1)", transform: "translateY(-1px)" } } : {}),
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
    </Box>
  );
}
