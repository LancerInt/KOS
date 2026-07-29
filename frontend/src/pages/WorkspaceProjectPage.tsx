import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";

import { getWorkspace, type WorkspaceCategory } from "../features/workspaces/workspaces";
import { getProject, type WorkspaceProject } from "../features/workspaces/projectsApi";
import { listRecords, createRecord, deleteRecord, type WorkspaceRecord } from "../features/workspaces/recordsApi";
import { listSections, createSection, deleteSection, type WorkspaceSection } from "../features/workspaces/sectionsApi";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { tokens, monoFont } from "../theme";

// Warm sand section tiles (dark ink text), on the near-white page.
const SECTION_BG = "#EAE1D2";
const SECTION_BORDER = "#DDD2BF";
const SECTION_TEXT = "#2A2620";

export default function WorkspaceProjectPage() {
  const { key, projectId } = useParams<{ key: string; projectId: string }>();
  const navigate = useNavigate();
  const ws = getWorkspace(key);
  const pid = Number(projectId);
  const { mine, loading: accessLoading } = useMyAccess();

  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [selected, setSelected] = useState<WorkspaceCategory | null>(null);
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [sections, setSections] = useState<WorkspaceSection[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBlurb, setNewBlurb] = useState("");
  const [newErr, setNewErr] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    if (!pid) { setRecords([]); return; }
    listRecords(pid).then(setRecords).catch(() => setRecords([]));
  };
  const loadSections = () => {
    if (!pid) { setSections([]); return; }
    listSections(pid).then(setSections).catch(() => setSections([]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelected(null);
    if (pid) getProject(pid).then(setProject).catch(() => setProject(null));
    load();
    loadSections();
  }, [projectId]);

  const countByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of records) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [records]);

  if (!ws) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        <Typography variant="h1" sx={{ fontSize: 26, mb: 0.5 }}>Workspace not found</Typography>
        <Typography sx={{ color: tokens.text3, fontSize: 13.5 }}>Pick a workspace from the sidebar.</Typography>
      </Box>
    );
  }

  const { Icon } = ws;
  // Built-in categories from config + the user's own sections (Description box each).
  const customCats: WorkspaceCategory[] = sections.map((s) => ({
    name: s.name, blurb: s.blurb || "Custom section.", fields: ["Description"], sectionId: s.id,
  }));
  const allCats: WorkspaceCategory[] = [...(ws.categories ?? []), ...customCats];
  const selectedRecords = selected ? records.filter((r) => r.category === selected.name) : [];
  const level = accessLevel(mine, ws.key);
  const canEdit = level === "edit";

  const saveSection = async () => {
    const name = newName.trim();
    if (!name || !pid) return;
    setCreating(true);
    setNewErr("");
    try {
      await createSection(pid, name, newBlurb.trim());
      setNewName("");
      setNewBlurb("");
      setNewOpen(false);
      loadSections();
    } catch (e) {
      const detail = (e as { response?: { data?: { name?: string[] } } }).response?.data?.name?.[0];
      setNewErr(detail ?? "Could not create section.");
    } finally {
      setCreating(false);
    }
  };

  const removeSection = async (id: number) => {
    await deleteSection(id);
    setSelected(null);
    loadSections();
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
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        {backBtn}
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      </Box>
    );
  }
  if (level === "none") {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
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
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
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
              subtleSub={!count} onClick={() => setSelected(c)} />
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

      {/* Add / view records */}
      <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 }, overflowY: "auto" } }}>
        {selected && (
          <CategoryPanel
            key={selected.name}
            project={pid}
            category={selected}
            records={selectedRecords}
            canEdit={canEdit}
            onClose={() => setSelected(null)}
            onChanged={load}
            onDeleteSection={canEdit && selected.sectionId ? () => removeSection(selected.sectionId!) : undefined}
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
    </Box>
  );
}

function SectionTag({ name, subtitle, subtleSub, onClick }: {
  name: string; subtitle: string; subtleSub?: boolean; onClick?: () => void;
}) {
  return (
    <Box onClick={onClick}
      sx={{ bgcolor: SECTION_BG, color: SECTION_TEXT, border: `1px solid ${SECTION_BORDER}`, borderRadius: "3px", minHeight: 78, px: 1.25, py: 1.25,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
        cursor: onClick ? "pointer" : "default", transition: "background-color .16s, box-shadow .16s, transform .16s",
        ...(onClick ? { "&:hover": { bgcolor: "#E3D9C6", boxShadow: "0 4px 12px rgba(20,22,29,.1)", transform: "translateY(-1px)" } } : {}) }}>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{name}</Typography>
      <Typography sx={{ fontSize: 10.5, color: subtleSub ? "#A79E8C" : "#8A8270", mt: 0.25 }}>{subtitle}</Typography>
    </Box>
  );
}

function CategoryPanel({ project, category, records, canEdit, onClose, onChanged, onDeleteSection }: {
  project: number;
  category: WorkspaceCategory;
  records: WorkspaceRecord[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleteSection?: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  // The "primary" field is the meaningful one — it's the record's headline and
  // the field required to save (a name or a description).
  const primaryField = category.fields.find((f) => /name|title|description|subject/i.test(f)) ?? category.fields[0];
  const primaryFilled = (form[primaryField] ?? "").trim().length > 0;

  const set = (f: string, v: string) => setForm((s) => ({ ...s, [f]: v }));
  const resetForm = () => { setForm({}); setFile(null); setAdding(false); };

  const save = async () => {
    if (!primaryFilled) return;
    setSaving(true);
    try {
      const data: Record<string, string> = {};
      for (const f of category.fields) {
        const v = (form[f] ?? "").trim();
        if (v) data[f] = v;
      }
      await createRecord(project, category.name, data, file);
      resetForm();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => { await deleteRecord(id); onChanged(); };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h3" sx={{ fontSize: 19, lineHeight: 1.3 }}>{category.name}</Typography>
          <Typography sx={{ fontSize: 13, color: tokens.text3, mt: 0.25 }}>{category.blurb}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><CloseRoundedIcon sx={{ fontSize: 18 }} /></IconButton>
      </Stack>

      {canEdit && (!adding ? (
        <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={() => setAdding(true)}
          sx={{ alignSelf: "flex-start", mb: 2 }}>
          Add {category.name.toLowerCase()}
        </Button>
      ) : (
        <Paper sx={{ p: 2, borderRadius: "6px", mb: 2, bgcolor: tokens.paper }}>
          <Stack spacing={1.25}>
            {category.fields.map((f) => {
              const multiline = /description|notes|remarks|details|comment/i.test(f);
              return (
                <TextField key={f} size="small" label={f} value={form[f] ?? ""} onChange={(e) => set(f, e.target.value)}
                  required={f === primaryField} autoFocus={f === primaryField} fullWidth
                  multiline={multiline} minRows={multiline ? 3 : undefined} />
              );
            })}
            {category.allowFiles && (
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Button component="label" variant="outlined" size="small" startIcon={<AttachFileRoundedIcon sx={{ fontSize: 16 }} />}>
                  {file ? "Change file" : "Attach file"}
                  <input type="file" hidden accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </Button>
                {file && (
                  <Typography sx={{ fontSize: 12, color: tokens.text2, display: "inline-flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>{file.name}</span>
                    <IconButton size="small" onClick={() => setFile(null)}><CloseRoundedIcon sx={{ fontSize: 14 }} /></IconButton>
                  </Typography>
                )}
              </Stack>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="contained" size="small" onClick={save} disabled={saving || !primaryFilled}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="small" onClick={resetForm}>Cancel</Button>
          </Stack>
        </Paper>
      ))}

      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 1 }}>
        {records.length} record{records.length === 1 ? "" : "s"}
      </Typography>

      {records.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: tokens.text3 }}>Nothing here yet. Add the first one.</Typography>
      ) : (
        <Stack spacing={1}>
          {records.map((r) => {
            const headline = r.data[primaryField] || "Untitled";
            const rest = category.fields.filter((f) => f !== primaryField).map((f) => r.data[f]).filter(Boolean).slice(0, 3).join(" · ");
            return (
              <Paper key={r.id} sx={{ p: 1.25, borderRadius: "6px" }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{headline}</Typography>
                    {rest && <Typography sx={{ fontSize: 11.5, color: tokens.text2 }} noWrap>{rest}</Typography>}
                    {r.attachment && (
                      <Typography component="a" href={r.attachment} target="_blank" rel="noopener"
                        sx={{ fontSize: 11.5, color: tokens.kriyaInk, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
                        <AttachFileRoundedIcon sx={{ fontSize: 13 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{r.attachment_name || "Attachment"}</span>
                      </Typography>
                    )}
                    <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont, mt: 0.25 }}>
                      {r.created_by_name || "—"} · {r.created_at.slice(0, 10)}
                    </Typography>
                  </Box>
                  {canEdit && (
                    <IconButton size="small" onClick={() => remove(r.id)}>
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                    </IconButton>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {onDeleteSection && (
        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${tokens.line}` }}>
          <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={onDeleteSection}>
            Delete this section
          </Button>
          <Typography sx={{ fontSize: 11, color: tokens.text3, mt: 0.5 }}>
            Removes the section and its records.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
