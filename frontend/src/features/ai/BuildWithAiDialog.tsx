import { useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, TextField, Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { scaffoldWorkspace, aiErrorMessage, type ScaffoldPlan } from "./aiApi";
import { createProject } from "../workspaces/projectsApi";
import { createSection } from "../workspaces/sectionsApi";
import { fieldId, FIELD_TYPES, FIELD_GROUPS, type FieldDef, type FieldType } from "../workspaces/fields";
import { tokens, monoFont } from "../../theme";

const AI = "#7C5CD6"; // AI accent — a calm violet, distinct from the brand teal

const EXAMPLES = [
  "A product launch tracker with sections for regulatory approvals, label design, and packaging",
  "A field trial project: trial setup, observations, pest counts, and a final report",
];

export default function BuildWithAiDialog({ open, onClose, workspace, workspaceLabel, onCreated }: {
  open: boolean;
  onClose: () => void;
  workspace: string;
  workspaceLabel: string;
  onCreated: (projectId: number) => void;
}) {
  const [phase, setPhase] = useState<"prompt" | "review">("prompt");
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<ScaffoldPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => { setPhase("prompt"); setPrompt(""); setPlan(null); setErr(""); setBusy(false); setCreating(false); };
  const close = () => { reset(); onClose(); };

  const generate = async () => {
    const p = prompt.trim();
    if (!p) return;
    setBusy(true); setErr("");
    try {
      const outcome = await scaffoldWorkspace(workspace, p, workspaceLabel);
      const data = outcome.data as ScaffoldPlan;
      if (!data?.sections?.length) { setErr("The assistant couldn't turn that into sections. Try describing the work in more detail."); return; }
      setPlan(data);
      setPhase("review");
    } catch (e) {
      setErr(aiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeSection = (i: number) =>
    setPlan((p) => (p ? { ...p, sections: p.sections.filter((_, x) => x !== i) } : p));
  const removeField = (si: number, fi: number) =>
    setPlan((p) => (p ? {
      ...p,
      sections: p.sections.map((s, x) => (x === si ? { ...s, fields: s.fields.filter((_, y) => y !== fi) } : s)),
    } : p));

  const create = async () => {
    if (!plan) return;
    const name = plan.project_name.trim();
    if (!name) { setErr("Give the project a name."); return; }
    setCreating(true); setErr("");
    try {
      const project = await createProject(workspace, name);
      const seen = new Set<string>();
      for (const s of plan.sections) {
        const key = s.name.trim().toLowerCase();
        if (!s.name.trim() || seen.has(key)) continue;
        seen.add(key);
        const fields: FieldDef[] = s.fields.map((f) => {
          const type = (FIELD_TYPES[f.type as FieldType] ? f.type : "text") as FieldType;
          const fd: FieldDef = { id: fieldId(), type, label: f.label, required: !!f.required };
          if (f.options?.length) fd.options = f.options;
          return fd;
        });
        // The scaffold contract is flat, so every generated section is top-level.
        await createSection({ project: project.id, name: s.name.trim(), blurb: s.blurb ?? "", fields });
      }
      onCreated(project.id);
      reset();
    } catch (e) {
      const detail = (e as { response?: { data?: { name?: string[] } } }).response?.data?.name?.[0];
      setErr(detail ?? "Could not create the project. Try a different name.");
    } finally {
      setCreating(false);
    }
  };

  const fieldCount = plan?.sections.reduce((n, s) => n + s.fields.length, 0) ?? 0;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19, display: "flex", alignItems: "center", gap: 1 }}>
        <AutoAwesomeRoundedIcon sx={{ color: AI, fontSize: 20 }} />
        Build with AI
      </DialogTitle>

      <DialogContent>
        {phase === "prompt" ? (
          <Stack spacing={1.75} sx={{ mt: 0.5 }}>
            <Typography sx={{ fontSize: 13, color: tokens.text2 }}>
              Describe the project you want in <b>{workspaceLabel}</b>. The assistant drafts a project with
              sections and fields — you review and edit before anything is created.
            </Typography>
            <TextField autoFocus multiline minRows={4} fullWidth placeholder="e.g. A new product registration project with sections for documents, approvals, and label versions…"
              value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {EXAMPLES.map((ex) => (
                <Chip key={ex} label={ex.length > 46 ? ex.slice(0, 44) + "…" : ex} size="small" onClick={() => setPrompt(ex)}
                  sx={{ bgcolor: "#F1F3F5", color: tokens.text2, fontSize: 11.5, maxWidth: "100%" }} />
              ))}
            </Box>
            {err && <Alert severity="error" sx={{ fontSize: 12.5 }}>{err}</Alert>}
          </Stack>
        ) : plan ? (
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3, mb: 0.5 }}>Project name</Typography>
              <TextField fullWidth size="small" value={plan.project_name}
                onChange={(e) => setPlan((p) => (p ? { ...p, project_name: e.target.value } : p))} />
            </Box>
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
              {plan.sections.length} section{plan.sections.length === 1 ? "" : "s"} · {fieldCount} field{fieldCount === 1 ? "" : "s"} — remove anything you don't want; you can refine each section after it's created.
            </Typography>

            <Stack spacing={1}>
              {plan.sections.map((s, si) => (
                <Box key={si} sx={{ border: `1px solid ${tokens.line}`, borderRadius: "10px", overflow: "hidden" }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, bgcolor: "#FAFAF8" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 13.5 }} noWrap>{s.name}</Typography>
                      {s.blurb && <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>{s.blurb}</Typography>}
                    </Box>
                    <IconButton size="small" onClick={() => removeSection(si)} title="Remove section"
                      sx={{ color: tokens.text3, "&:hover": { color: tokens.attn, bgcolor: tokens.attnWash } }}>
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Stack>
                  {s.fields.length > 0 && (
                    <Stack sx={{ px: 1, py: 0.5 }}>
                      {s.fields.map((f, fi) => {
                        const type = (FIELD_TYPES[f.type as FieldType] ? f.type : "text") as FieldType;
                        const g = FIELD_GROUPS[FIELD_TYPES[type].group];
                        return (
                          <Stack key={fi} direction="row" alignItems="center" spacing={1} sx={{ px: 0.5, py: 0.5 }}>
                            <Box sx={{ width: 18, height: 18, borderRadius: "5px", flexShrink: 0, display: "grid", placeItems: "center",
                              fontFamily: monoFont, fontSize: 10, bgcolor: g.soft, color: g.color }}>{FIELD_TYPES[type].glyph}</Box>
                            <Typography sx={{ fontSize: 12.5, flex: 1, minWidth: 0 }} noWrap>
                              {f.label}
                              {f.options?.length ? <Box component="span" sx={{ color: tokens.text3, fontSize: 11 }}> · {f.options.join(", ")}</Box> : null}
                            </Typography>
                            {f.required && <Box sx={{ fontFamily: monoFont, fontSize: 8.5, color: tokens.attn, bgcolor: tokens.attnWash, px: 0.6, py: "1px", borderRadius: "5px", textTransform: "uppercase" }}>Req</Box>}
                            <IconButton size="small" onClick={() => removeField(si, fi)} title="Remove field" sx={{ color: tokens.text3 }}>
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              ))}
            </Stack>
            {err && <Alert severity="error" sx={{ fontSize: 12.5 }}>{err}</Alert>}
            <Typography sx={{ fontSize: 10.5, color: tokens.text3 }}>AI can be wrong — review before creating.</Typography>
          </Stack>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {phase === "prompt" ? (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="contained" onClick={generate} disabled={busy || !prompt.trim()}
              startIcon={busy ? <CircularProgress size={15} color="inherit" /> : <AutoAwesomeRoundedIcon />}
              sx={{ bgcolor: AI, "&:hover": { bgcolor: "#5B41A5" } }}>
              {busy ? "Drafting…" : "Draft it"}
            </Button>
          </>
        ) : (
          <>
            <Button startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 17 }} />} onClick={() => { setPhase("prompt"); setErr(""); }}>Back</Button>
            <Button variant="contained" onClick={create} disabled={creating || !plan?.sections.length}>
              {creating ? "Creating…" : "Create project"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
