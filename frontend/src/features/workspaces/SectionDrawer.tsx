import { useMemo, useState } from "react";
import {
  Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Paper, Radio,
  RadioGroup, Select, Snackbar, Stack, Switch, TextField, Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import type { WorkspaceRecord } from "./recordsApi";
import { createRecord, deleteRecord, completeRecord } from "./recordsApi";
import { ancestorTrail, type SectionNode } from "./sectionTree";
import {
  FIELD_GROUPS, FIELD_TYPES, TYPE_ORDER, newField, primaryField, isDurationField,
  type FieldDef, type FieldType,
} from "./fields";
import { DurationChip, durationText } from "./durationDisplay";
import { tokens, monoFont } from "../../theme";

type Tab = "fields" | "records" | "children";

/**
 * One section, at any depth. The drawer walks the tree in place: the breadcrumb
 * climbs back out and the Sub-sections tab descends, so unlimited nesting never
 * needs a second navigation surface.
 */
export function SectionDrawer({
  node, projectName, project, records, canEdit, showDuration, initialTab,
  onClose, onOpenNode, onAddChild, onRestoreChild,
  onRecordsChanged, onSaveFields, onDeleteSection,
}: {
  node: SectionNode;
  projectName: string;
  project: number;
  records: WorkspaceRecord[];
  canEdit: boolean;
  showDuration: boolean;
  initialTab: Tab;
  onClose: () => void;
  onOpenNode: (key: string) => void;
  onAddChild: () => void;
  onRestoreChild: (id: number) => void;
  onRecordsChanged: () => void;
  onSaveFields: (fields: FieldDef[]) => Promise<void>;
  onDeleteSection?: () => void;
}) {
  const savedFields = node.fieldDefs;
  const [tab, setTab] = useState<Tab>(canEdit ? initialTab : "records");
  const trail = ancestorTrail(node).slice(0, -1);      // ancestors, not the node

  const TABS: Tab[] = canEdit ? ["records", "fields", "children"] : ["records", "children"];
  const tabLabel = (t: Tab) =>
    t === "records" ? "Records"
      : t === "fields" ? "Fields"
      : `Sub-sections${node.children.length ? ` (${node.children.length})` : ""}`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* header */}
      <Box sx={{ px: 3, pt: 2.5, pb: 1.75, borderBottom: `1px solid ${tokens.line}` }}>
        {/* breadcrumb — the way back up out of a nested section */}
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
          <Crumb onClick={onClose}>{projectName}</Crumb>
          {trail.map((a) => (
            <Box key={a.key} sx={{ display: "inline-flex", alignItems: "center" }}>
              <Sep />
              <Crumb onClick={() => onOpenNode(a.key)}>{a.name}</Crumb>
            </Box>
          ))}
        </Stack>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3" sx={{ fontSize: 19, lineHeight: 1.3 }}>{node.name}</Typography>
            <Typography sx={{ fontSize: 12.5, color: tokens.text3, mt: 0.25 }}>{node.blurb}</Typography>
          </Box>
          <IconButton size="small" onClick={onClose}><CloseRoundedIcon sx={{ fontSize: 18 }} /></IconButton>
        </Stack>
        <Box sx={{ display: "inline-flex", mt: 1.75, p: "3px", borderRadius: "9px", bgcolor: "#EEF0F3", border: `1px solid ${tokens.line}` }}>
          {TABS.map((t) => (
            <Box key={t} component="button" onClick={() => setTab(t)}
              sx={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12.5,
                px: 1.75, py: 0.75, borderRadius: "7px", whiteSpace: "nowrap",
                color: tab === t ? tokens.kriyaInk : tokens.text2,
                bgcolor: tab === t ? "#fff" : "transparent",
                boxShadow: tab === t ? "0 1px 2px rgba(20,22,29,.12)" : "none" }}>
              {tabLabel(t)}
            </Box>
          ))}
        </Box>
      </Box>

      {/* body */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 2.25 }}>
        {tab === "fields" && canEdit ? (
          <FieldBuilder key={node.key} initial={savedFields} onSave={onSaveFields} />
        ) : tab === "children" ? (
          <SubSectionsTab node={node} canEdit={canEdit} onOpenNode={onOpenNode}
            onAddChild={onAddChild} onRestoreChild={onRestoreChild} />
        ) : (
          <RecordsTab
            node={node} project={project} records={records} fields={savedFields}
            canEdit={canEdit} showDuration={showDuration} onChanged={onRecordsChanged}
          />
        )}

        {onDeleteSection && tab !== "children" && (
          <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${tokens.line}` }}>
            <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />}
              onClick={onDeleteSection}>
              Delete this section
            </Button>
            <Typography sx={{ fontSize: 11, color: tokens.text3, mt: 0.5 }}>
              Hides it from this project — records and sub-sections are kept, and you can
              restore it or Undo.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

const Sep = () => (
  <Typography component="span" sx={{ fontSize: 12, color: tokens.text3, mx: 0.5 }}>›</Typography>
);

function Crumb({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Box component="button" onClick={onClick}
      sx={{ border: "none", background: "transparent", p: 0, cursor: "pointer", fontFamily: "inherit",
        fontSize: 12, color: tokens.text3, "&:hover": { color: tokens.kriyaInk, textDecoration: "underline" } }}>
      {children}
    </Box>
  );
}

/* ---------------------------- Sub-sections tab ---------------------------- */

function SubSectionsTab({ node, canEdit, onOpenNode, onAddChild, onRestoreChild }: {
  node: SectionNode;
  canEdit: boolean;
  onOpenNode: (key: string) => void;
  onAddChild: () => void;
  onRestoreChild: (id: number) => void;
}) {
  return (
    <Stack spacing={1.25}>
      {node.children.length === 0 && (
        <Typography sx={{ fontSize: 13, color: tokens.text3 }}>
          No sub-sections yet. A sub-section is a full section — its own fields, its own records.
        </Typography>
      )}
      {node.children.map((c) => (
        <Box key={c.key} onClick={() => onOpenNode(c.key)}
          sx={{ p: 1.25, borderRadius: "6px", border: `1px solid ${tokens.line}`, cursor: "pointer",
            transition: "border-color .16s, background-color .16s",
            "&:hover": { borderColor: tokens.kriya, bgcolor: "rgba(15,122,139,.04)" } }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</Typography>
          <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.25 }}>
            {c.ownCount ? `${c.ownCount} record${c.ownCount === 1 ? "" : "s"}` : "No records yet"}
            {c.children.length ? ` · ${c.children.length} sub-section${c.children.length === 1 ? "" : "s"}` : ""}
          </Typography>
        </Box>
      ))}

      {canEdit && (
        <Button size="small" variant="outlined" startIcon={<AddRoundedIcon sx={{ fontSize: 17 }} />}
          onClick={onAddChild} sx={{ alignSelf: "flex-start" }}>
          Add sub-section
        </Button>
      )}

      {canEdit && node.hiddenChildren.length > 0 && (
        <Box sx={{ mt: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: tokens.text3, mr: 0.25 }}>Hidden:</Typography>
          {node.hiddenChildren.map((h) => (
            <Box key={h.key} onClick={() => h.id != null && onRestoreChild(h.id)}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.375, borderRadius: "999px",
                border: `1px dashed ${tokens.line}`, color: tokens.text2, cursor: "pointer", fontSize: 11.5,
                "&:hover": { borderColor: tokens.kriya, color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.06)" } }}>
              {h.name}
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}

/* ------------------------------ Fields tab ------------------------------ */

type Drag = { kind: "move"; id: string } | { kind: "new"; type: FieldType } | null;

function FieldBuilder({ initial, onSave }: { initial: FieldDef[]; onSave: (f: FieldDef[]) => Promise<void> }) {
  const [fields, setFields] = useState<FieldDef[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(initial.length === 0);
  const [drag, setDrag] = useState<Drag>(null);
  const [overZone, setOverZone] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [undoField, setUndoField] = useState<{ field: FieldDef; index: number } | null>(null);

  const mutate = (next: FieldDef[]) => { setFields(next); setSaved(false); };
  const patch = (id: string, p: Partial<FieldDef>) =>
    mutate(fields.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const addType = (t: FieldType) => { const f = newField(t); mutate([...fields, f]); setOpenId(f.id); };
  const dup = (id: string) => {
    const i = fields.findIndex((f) => f.id === id);
    if (i < 0) return;
    const copy = { ...structuredClone(fields[i]), id: newField(fields[i].type).id };
    mutate([...fields.slice(0, i + 1), copy, ...fields.slice(i + 1)]);
  };
  const del = (id: string) => {
    const index = fields.findIndex((f) => f.id === id);
    if (index < 0) return;
    const field = fields[index];
    mutate(fields.filter((f) => f.id !== id));
    if (openId === id) setOpenId(null);
    setUndoField({ field, index });
  };
  const undoDelete = () => {
    if (!undoField) return;
    const next = [...fields];
    next.splice(Math.min(undoField.index, next.length), 0, undoField.field);
    mutate(next);
    setUndoField(null);
  };

  const drop = (index: number) => {
    const d = drag; setDrag(null); setOverZone(null);
    if (!d) return;
    if (d.kind === "new") {
      const f = newField(d.type);
      mutate([...fields.slice(0, index), f, ...fields.slice(index)]);
      setOpenId(f.id);
      return;
    }
    const from = fields.findIndex((f) => f.id === d.id);
    if (from < 0) return;
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    next.splice(from < index ? index - 1 : index, 0, moved);
    mutate(next);
  };

  const save = async () => {
    setSaving(true);
    try { await onSave(fields); setSaved(true); }
    finally { setSaving(false); }
  };

  const Zone = ({ index }: { index: number }) => (
    <Box
      onDragOver={(e) => { e.preventDefault(); setOverZone(index); }}
      onDragLeave={() => setOverZone((z) => (z === index ? null : z))}
      onDrop={(e) => { e.preventDefault(); drop(index); }}
      sx={{ height: overZone === index ? 26 : 8, my: "1px", borderRadius: "6px",
        transition: "height .12s, background-color .12s",
        ...(overZone === index ? { bgcolor: tokens.kriyaWash, border: `2px dashed ${tokens.kriya}` } : {}) }} />
  );

  return (
    <Box>
      <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 700, mb: 1 }}>
        Fields · {fields.length}
      </Typography>

      {fields.length === 0 && !picking && (
        <Typography sx={{ fontSize: 13, color: tokens.text3, mb: 1 }}>No fields yet — add the first one below.</Typography>
      )}

      <Zone index={0} />
      {fields.map((f, i) => (
        <Box key={f.id}>
          <FieldCard
            field={f} open={openId === f.id}
            onToggle={() => setOpenId((o) => (o === f.id ? null : f.id))}
            onPatch={(p) => patch(f.id, p)}
            onDup={() => dup(f.id)} onDel={() => del(f.id)}
            onDragStart={() => setDrag({ kind: "move", id: f.id })} onDragEnd={() => setDrag(null)}
          />
          <Zone index={i + 1} />
        </Box>
      ))}

      {picking ? (
        <TypePicker onPick={addType} onDone={() => setPicking(false)}
          onDragType={(t) => setDrag({ kind: "new", type: t })} onDragEnd={() => setDrag(null)} />
      ) : (
        <Button fullWidth onClick={() => setPicking(true)} startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
          sx={{ mt: 1, py: 1.25, borderRadius: "9px", border: "1.5px dashed #C9BCA6", color: tokens.kriyaInk,
            bgcolor: "#FDFBF7", "&:hover": { borderColor: tokens.kriya, bgcolor: "rgba(15,122,139,.06)" } }}>
          Add field
        </Button>
      )}

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 2.5 }}>
        <Button variant="contained" onClick={save} disabled={saving || saved}>
          {saving ? "Saving…" : saved ? "Saved" : "Save fields"}
        </Button>
        {!saved && <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>Unsaved changes</Typography>}
      </Stack>

      <Snackbar open={!!undoField} autoHideDuration={5000} onClose={() => setUndoField(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }} message="Field deleted"
        action={<Button size="small" onClick={undoDelete} sx={{ color: tokens.kriyaGlow, fontWeight: 700 }}>Undo</Button>} />
    </Box>
  );
}

function TypeGlyph({ type, size = 20 }: { type: FieldType; size?: number }) {
  const g = FIELD_GROUPS[FIELD_TYPES[type].group];
  return (
    <Box sx={{ width: size, height: size, borderRadius: "6px", flexShrink: 0, display: "grid", placeItems: "center",
      fontFamily: monoFont, fontSize: size > 18 ? 11 : 10, bgcolor: g.soft, color: g.color }}>
      {FIELD_TYPES[type].glyph}
    </Box>
  );
}

function FieldCard({ field, open, onToggle, onPatch, onDup, onDel, onDragStart, onDragEnd }: {
  field: FieldDef; open: boolean;
  onToggle: () => void; onPatch: (p: Partial<FieldDef>) => void;
  onDup: () => void; onDel: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  return (
    <Box draggable={!open} onDragStart={onDragStart} onDragEnd={onDragEnd}
      sx={{ border: `1px solid ${open ? tokens.kriya : tokens.line}`, borderRadius: "10px", bgcolor: "#fff", overflow: "hidden",
        "&:hover": { boxShadow: "0 4px 12px rgba(20,22,29,.07)" } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 1 }}>
        <DragIndicatorRoundedIcon sx={{ fontSize: 17, color: tokens.text3, cursor: "grab" }} />
        <TypeGlyph type={field.type} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: tokens.ink, flex: 1, minWidth: 0 }} noWrap>
          {field.label || "Untitled"}
        </Typography>
        {field.required && (
          <Box sx={{ fontFamily: monoFont, fontSize: 8.5, color: tokens.attn, bgcolor: tokens.attnWash, px: 0.6, py: "1px", borderRadius: "5px", textTransform: "uppercase" }}>Req</Box>
        )}
        <IconButton size="small" onClick={onToggle} title={open ? "Done editing" : "Edit field"}>
          {open ? <CheckRoundedIcon sx={{ fontSize: 15 }} /> : <EditRoundedIcon sx={{ fontSize: 15 }} />}
        </IconButton>
        <IconButton size="small" onClick={onDel} title="Delete field"
          sx={{ color: tokens.text3, "&:hover": { color: tokens.attn, bgcolor: tokens.attnWash } }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>

      {/* preview */}
      <Box sx={{ px: 1.5, pb: 1.25, pointerEvents: "none", opacity: 0.92 }}>
        <FieldPreview field={field} />
      </Box>

      {open && <FieldConfig field={field} onPatch={onPatch} onDup={onDup} onDel={onDel} />}
    </Box>
  );
}

function FieldPreview({ field }: { field: FieldDef }) {
  const label = (
    <Typography component="label" sx={{ display: "block", fontSize: 11, color: tokens.text2, mb: 0.5, fontWeight: 500 }}>
      {field.label || "Untitled"}{field.required && <span style={{ color: tokens.attn }}> *</span>}
    </Typography>
  );
  const sx = { "& .MuiInputBase-root": { fontSize: 12.5, bgcolor: "#FCFCFB" } } as const;
  let control: React.ReactNode;
  if (field.type === "paragraph") control = <TextField size="small" fullWidth multiline minRows={2} placeholder={field.placeholder} sx={sx} />;
  else if (field.type === "number") control = <TextField size="small" fullWidth type="number" placeholder={field.placeholder || "0"} sx={sx} />;
  else if (field.type === "date") control = <TextField size="small" fullWidth type="date" sx={sx} />;
  else if (field.type === "file")
    control = (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.6,
        border: `1px solid ${tokens.line}`, borderRadius: "8px", fontSize: 12.5, color: tokens.text2, bgcolor: "#FCFCFB" }}>
        <AttachFileRoundedIcon sx={{ fontSize: 15 }} /> Attach file
      </Box>
    );
  else if (field.type === "dropdown")
    control = <Select size="small" fullWidth displayEmpty value="" sx={{ fontSize: 12.5, bgcolor: "#FCFCFB" }}>
      <MenuItem value="" sx={{ fontSize: 12.5 }}>Select…</MenuItem>
      {(field.options ?? []).map((o, i) => <MenuItem key={i} value={o} sx={{ fontSize: 12.5 }}>{o}</MenuItem>)}
    </Select>;
  else if (field.type === "radio")
    control = <Stack spacing={0.25}>{(field.options ?? []).map((o, i) => (
      <FormControlLabel key={i} control={<Radio size="small" />} label={<span style={{ fontSize: 12 }}>{o}</span>} sx={{ m: 0 }} />
    ))}</Stack>;
  else if (field.type === "checkbox")
    control = <Stack spacing={0.25}>{(field.options ?? []).map((o, i) => (
      <FormControlLabel key={i} control={<Checkbox size="small" />} label={<span style={{ fontSize: 12 }}>{o}</span>} sx={{ m: 0 }} />
    ))}</Stack>;
  else control = <TextField size="small" fullWidth placeholder={field.placeholder} sx={sx} />;
  return (
    <Box>
      {label}
      {control}
      {field.help && <Typography sx={{ fontSize: 10, color: tokens.text3, mt: 0.4 }}>{field.help}</Typography>}
    </Box>
  );
}

function FieldConfig({ field, onPatch, onDup, onDel }: {
  field: FieldDef; onPatch: (p: Partial<FieldDef>) => void; onDup: () => void; onDel: () => void;
}) {
  const hasOptions = !!FIELD_TYPES[field.type].hasOptions;
  const hasPlaceholder = !["radio", "checkbox", "dropdown", "date", "file"].includes(field.type);
  const setOpt = (i: number, v: string) => onPatch({ options: (field.options ?? []).map((o, j) => (j === i ? v : o)) });
  const addOpt = () => onPatch({ options: [...(field.options ?? []), "New option"] });
  const delOpt = (i: number) => onPatch({ options: (field.options ?? []).filter((_, j) => j !== i) });
  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <Typography sx={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3, fontWeight: 700, mb: 0.5 }}>{children}</Typography>
  );
  return (
    <Box sx={{ borderTop: `1px dashed ${tokens.line}`, bgcolor: "#FAFAF8", p: 1.5 }}>
      <Box sx={{ mb: 1.25 }}>
        <Lbl>Label</Lbl>
        <TextField size="small" fullWidth value={field.label} onChange={(e) => onPatch({ label: e.target.value })} />
      </Box>
      {hasPlaceholder && (
        <Box sx={{ mb: 1.25 }}>
          <Lbl>Placeholder</Lbl>
          <TextField size="small" fullWidth value={field.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value })} />
        </Box>
      )}
      {hasOptions && (
        <Box sx={{ mb: 1.25 }}>
          <Lbl>Options</Lbl>
          <Stack spacing={0.75}>
            {(field.options ?? []).map((o, i) => (
              <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                <TextField size="small" fullWidth value={o} onChange={(e) => setOpt(i, e.target.value)} />
                <IconButton size="small" onClick={() => delOpt(i)}><CloseRoundedIcon sx={{ fontSize: 14 }} /></IconButton>
              </Stack>
            ))}
            <Button size="small" onClick={addOpt} startIcon={<AddRoundedIcon sx={{ fontSize: 15 }} />}
              sx={{ alignSelf: "flex-start", color: tokens.text2 }}>Add option</Button>
          </Stack>
        </Box>
      )}
      <Box sx={{ mb: 1 }}>
        <Lbl>Help text</Lbl>
        <TextField size="small" fullWidth placeholder="Optional hint" value={field.help ?? ""} onChange={(e) => onPatch({ help: e.target.value })} />
      </Box>
      <FormControlLabel
        control={<Switch size="small" checked={!!field.required} onChange={(e) => onPatch({ required: e.target.checked })} />}
        label={<span style={{ fontSize: 12.5, color: tokens.text2 }}>Required field</span>} />

      <Stack direction="row" alignItems="center" justifyContent="space-between"
        sx={{ mt: 1.25, pt: 1.25, borderTop: `1px dashed ${tokens.line}` }}>
        <Button size="small" onClick={onDup} startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 15 }} />} sx={{ color: tokens.text2 }}>
          Duplicate
        </Button>
        <Button size="small" color="error" onClick={onDel} startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />}>
          Delete field
        </Button>
      </Stack>
    </Box>
  );
}

function TypePicker({ onPick, onDone, onDragType, onDragEnd }: {
  onPick: (t: FieldType) => void; onDone: () => void;
  onDragType: (t: FieldType) => void; onDragEnd: () => void;
}) {
  return (
    <Box sx={{ mt: 1.25, p: 1.5, borderRadius: "11px", border: `1px solid ${FIELD_GROUPS.media.soft}`, bgcolor: "#FDFBF7" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "#8A551A", fontWeight: 700 }}>
          Add a field — click, or drag into place
        </Typography>
        <Button size="small" onClick={onDone} sx={{ color: tokens.text2, minWidth: 0 }}>Done</Button>
      </Stack>
      {TYPE_ORDER.map((group) => (
        <Box key={group} sx={{ mb: 1 }}>
          <Typography sx={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 700, mb: 0.6 }}>
            {FIELD_GROUPS[group].name}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {(Object.keys(FIELD_TYPES) as FieldType[]).filter((t) => FIELD_TYPES[t].group === group).map((t) => (
              <Box key={t} draggable onDragStart={() => onDragType(t)} onDragEnd={onDragEnd} onClick={() => onPick(t)}
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: 1, py: 0.6, borderRadius: "8px",
                  border: `1px solid ${tokens.line}`, bgcolor: "#fff", cursor: "grab", fontSize: 11.5, fontWeight: 600,
                  "&:hover": { boxShadow: "0 4px 10px rgba(20,22,29,.1)", transform: "translateY(-1px)" }, transition: "box-shadow .12s, transform .1s" }}>
                <TypeGlyph type={t} size={17} />{FIELD_TYPES[t].label}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/* ------------------------------ Records tab ------------------------------ */

function RecordsTab({ node, project, records, fields, canEdit, showDuration, onChanged }: {
  node: SectionNode;
  project: number;
  records: WorkspaceRecord[];
  fields: FieldDef[];
  canEdit: boolean;
  showDuration: boolean;
  onChanged: () => void;
}) {
  // Duration steps replace their "Duration" field with real start/end inputs.
  const formFields = useMemo(() => fields.filter((f) => !(showDuration && isDurationField(f))), [fields, showDuration]);
  const hasFileField = node.allowFiles || fields.some((f) => f.type === "file");
  const primary = primaryField(formFields);
  const headField = primary?.label ?? "";

  const [form, setForm] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [durStart, setDurStart] = useState("");
  const [durEnd, setDurEnd] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const primaryFilled = !primary || (form[primary.label] ?? "").trim().length > 0;
  const durValid = !!durStart && !!durEnd && new Date(durEnd).getTime() > new Date(durStart).getTime();

  const localNow = () => {
    const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const set = (label: string, v: string) => setForm((s) => ({ ...s, [label]: v }));
  const startAdding = () => {
    setForm({}); setFiles([]);
    setDurStart(showDuration ? localNow() : ""); setDurEnd("");
    setAdding(true);
  };
  const reset = () => { setForm({}); setFiles([]); setDurStart(""); setDurEnd(""); setAdding(false); };

  const save = async () => {
    if (!primaryFilled) return;
    setSaving(true);
    try {
      const data: Record<string, string> = {};
      for (const f of formFields) {
        if (f.type === "file") continue;
        const v = (form[f.label] ?? "").trim();
        if (v) data[f.label] = v;
      }
      const schedule = showDuration && durValid
        ? { start_at: new Date(durStart).toISOString(), end_at: new Date(durEnd).toISOString() }
        : undefined;
      // `section` is the real link; `category` rides along as the name mirror and
      // is all an unadopted built-in can offer (the backend resolves that case).
      await createRecord(project, { section: node.id, category: node.name }, data,
                         hasFileField ? files : null, schedule);
      reset();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => { await deleteRecord(id); onChanged(); };
  const toggle = async (id: number) => { await completeRecord(id); onChanged(); };

  return (
    <Box>
      {canEdit && (!adding ? (
        <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={startAdding} sx={{ mb: 2 }}>
          Add {node.name.toLowerCase()}
        </Button>
      ) : (
        <Paper sx={{ p: 2, borderRadius: "10px", mb: 2, bgcolor: tokens.paper }}>
          <Stack spacing={1.5}>
            {formFields.length === 0 && (
              <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>
                This section has no fields yet — add some in the Fields tab.
              </Typography>
            )}
            {formFields.map((f) => (
              <RecordInput key={f.id} field={f} value={form[f.label] ?? ""} autoFocus={f.label === headField}
                onChange={(v) => set(f.label, v)} />
            ))}
            {showDuration && (
              <>
                <TextField size="small" type="datetime-local" label="Starts" InputLabelProps={{ shrink: true }}
                  value={durStart} onChange={(e) => setDurStart(e.target.value)} fullWidth />
                <TextField size="small" type="datetime-local" label="Ends" InputLabelProps={{ shrink: true }}
                  value={durEnd} onChange={(e) => setDurEnd(e.target.value)} fullWidth />
                <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
                  Optional — set a date &amp; time; you'll be notified when this duration is complete.
                </Typography>
              </>
            )}
            {hasFileField && (
              <Box>
                <Button component="label" variant="outlined" size="small" startIcon={<AttachFileRoundedIcon sx={{ fontSize: 16 }} />}>
                  {files.length ? "Add more files" : "Attach files"}
                  <input type="file" hidden multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      // Append, de-duping by name+size so the same file isn't added twice.
                      setFiles((prev) => {
                        const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
                        return [...prev, ...picked.filter((f) => !seen.has(`${f.name}:${f.size}`))];
                      });
                      e.target.value = "";  // let the same file be re-picked after removal
                    }} />
                </Button>
                {files.length > 0 && (
                  <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                    {files.map((f, i) => (
                      <Stack key={`${f.name}:${f.size}:${i}`} direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                        <AttachFileRoundedIcon sx={{ fontSize: 13, color: tokens.text3 }} />
                        <Typography sx={{ fontSize: 12, color: tokens.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.name}</Typography>
                        <IconButton size="small" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                          <CloseRoundedIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="contained" size="small" onClick={save} disabled={saving || !primaryFilled}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="small" onClick={reset}>Cancel</Button>
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
            const headline = (headField && r.data[headField]) || "Untitled";
            const rest = formFields.filter((f) => f.label !== headField && f.type !== "file")
              .map((f) => r.data[f.label]).filter(Boolean).slice(0, 3).join(" · ");
            const hasDur = r.duration && r.duration.status !== "none";
            return (
              <Paper key={r.id} sx={{ p: 1.25, borderRadius: "10px" }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{headline}</Typography>
                    {rest && <Typography sx={{ fontSize: 11.5, color: tokens.text2 }} noWrap>{rest}</Typography>}
                    {(() => {
                      // New multi-file attachments, plus the legacy single one for older records.
                      const links = [
                        ...(r.attachments ?? []).map((a) => ({ href: a.file, name: a.name })),
                        ...(r.attachment ? [{ href: r.attachment, name: r.attachment_name || "Attachment" }] : []),
                      ];
                      return links.length > 0 ? (
                        <Stack spacing={0.1} sx={{ mt: 0.25 }}>
                          {links.map((l, i) => (
                            <Typography key={i} component="a" href={l.href} target="_blank" rel="noopener"
                              sx={{ fontSize: 11.5, color: tokens.kriyaInk, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                              <AttachFileRoundedIcon sx={{ fontSize: 13 }} />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{l.name}</span>
                            </Typography>
                          ))}
                        </Stack>
                      ) : null;
                    })()}
                    {hasDur && (
                      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.6 }}>
                        <DurationChip duration={r.duration} />
                        <Typography sx={{ fontSize: 11, color: tokens.text3 }}>{durationText(r.duration, r.completed_at)}</Typography>
                        {canEdit && (
                          <Box component="button" onClick={() => toggle(r.id)}
                            sx={{ border: "none", background: "transparent", p: 0, cursor: "pointer", fontSize: 11, fontWeight: 600,
                              color: r.duration.status === "completed" ? tokens.text3 : tokens.kriyaInk }}>
                            {r.duration.status === "completed" ? "Reopen" : "Mark complete"}
                          </Box>
                        )}
                      </Stack>
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
    </Box>
  );
}

function RecordInput({ field, value, autoFocus, onChange }: {
  field: FieldDef; value: string; autoFocus?: boolean; onChange: (v: string) => void;
}) {
  const req = !!field.required;
  if (field.type === "paragraph")
    return <TextField size="small" fullWidth multiline minRows={3} label={field.label} required={req} autoFocus={autoFocus}
      placeholder={field.placeholder} value={value} onChange={(e) => onChange(e.target.value)} helperText={field.help || undefined} />;
  if (field.type === "number")
    return <TextField size="small" fullWidth type="number" label={field.label} required={req} autoFocus={autoFocus}
      placeholder={field.placeholder} value={value} onChange={(e) => onChange(e.target.value)} helperText={field.help || undefined} />;
  if (field.type === "date")
    return <TextField size="small" fullWidth type="date" label={field.label} required={req} InputLabelProps={{ shrink: true }}
      value={value} onChange={(e) => onChange(e.target.value)} helperText={field.help || undefined} />;
  if (field.type === "dropdown")
    return (
      <TextField select size="small" fullWidth label={field.label} required={req} value={value}
        onChange={(e) => onChange(e.target.value)} helperText={field.help || undefined}>
        <MenuItem value=""><em>Select…</em></MenuItem>
        {(field.options ?? []).map((o, i) => <MenuItem key={i} value={o}>{o}</MenuItem>)}
      </TextField>
    );
  if (field.type === "radio")
    return (
      <Box>
        <Typography sx={{ fontSize: 12, color: tokens.text2, mb: 0.25 }}>{field.label}{req && " *"}</Typography>
        <RadioGroup value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o, i) => (
            <FormControlLabel key={i} value={o} control={<Radio size="small" />} label={<span style={{ fontSize: 13 }}>{o}</span>} sx={{ my: -0.35 }} />
          ))}
        </RadioGroup>
        {field.help && <Typography sx={{ fontSize: 11, color: tokens.text3 }}>{field.help}</Typography>}
      </Box>
    );
  if (field.type === "checkbox") {
    const selected = value ? value.split(", ") : [];
    const toggle = (o: string) => {
      const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o];
      onChange(next.join(", "));
    };
    return (
      <Box>
        <Typography sx={{ fontSize: 12, color: tokens.text2, mb: 0.25 }}>{field.label}{req && " *"}</Typography>
        <Stack>
          {(field.options ?? []).map((o, i) => (
            <FormControlLabel key={i} control={<Checkbox size="small" checked={selected.includes(o)} onChange={() => toggle(o)} />}
              label={<span style={{ fontSize: 13 }}>{o}</span>} sx={{ my: -0.35 }} />
          ))}
        </Stack>
        {field.help && <Typography sx={{ fontSize: 11, color: tokens.text3 }}>{field.help}</Typography>}
      </Box>
    );
  }
  // A file field has no inline text input — the shared "Attach file" button
  // below the fields handles the single per-record attachment. Rendering a text
  // box here just looked broken (it accepted typing but saved nothing).
  if (field.type === "file") return null;
  // text
  return <TextField size="small" fullWidth label={field.label} required={req} autoFocus={autoFocus}
    placeholder={field.placeholder} value={value} onChange={(e) => onChange(e.target.value)} helperText={field.help || undefined} />;
}
