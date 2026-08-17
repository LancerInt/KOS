import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, MenuItem,
  Paper, Radio, Select, Stack, TextField, Typography,
} from "@mui/material";

import {
  customizeWorkflow, getWorkflow, revertWorkflow, saveWorkflow,
  type ResolvedWorkflow, type WStatus, type WTransition,
} from "../features/workflows/workflowsApi";
import type { Category } from "../features/tasks/types";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "../features/tasks/display";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const CATEGORIES: Category[] = ["not_started", "active", "waiting", "in_review", "done", "cancelled"];
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "status";

export default function WorkflowPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canManage = "manage_workflows" in caps || "administer" in caps;

  const [wf, setWf] = useState<ResolvedWorkflow | null>(null);
  const [statuses, setStatuses] = useState<WStatus[]>([]);
  const [transitions, setTransitions] = useState<WTransition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const hydrate = (w: ResolvedWorkflow) => {
    setWf(w);
    setStatuses(w.statuses.map((s) => ({ ...s })));
    setTransitions(w.transitions.map((t) => ({ ...t })));
    setError(null);
  };

  useEffect(() => {
    if (id) getWorkflow(id).then(hydrate).catch(() => setError("Could not load the workflow."));
  }, [id]);

  const run = (p: Promise<ResolvedWorkflow>) => {
    setSaving(true);
    setSaved(false);
    p.then((w) => { hydrate(w); setSaved(true); })
      .catch((e) => setError(firstError(e) ?? "Something went wrong."))
      .finally(() => setSaving(false));
  };

  const save = () => run(saveWorkflow(id!, { statuses, transitions }));

  const updateStatus = (i: number, patch: Partial<WStatus>) =>
    setStatuses((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addStatus = () => {
    const key = uniqueKey("new_status", statuses);
    setStatuses((prev) => [...prev, { key, label: "New status", category: "not_started", order: prev.length, is_initial: false }]);
  };

  const removeStatus = (key: string) => {
    setStatuses((prev) => prev.filter((s) => s.key !== key));
    setTransitions((prev) => prev.filter((t) => t.from !== key && t.to !== key));
  };

  const setInitial = (key: string) =>
    setStatuses((prev) => prev.map((s) => ({ ...s, is_initial: s.key === key })));

  const targetsFor = (from: string) => transitions.filter((t) => t.from === from).map((t) => t.to);
  const setTargets = (from: string, tos: string[]) =>
    setTransitions((prev) => [...prev.filter((t) => t.from !== from), ...tos.map((to) => ({ from, to }))]);

  if (error && !wf) {
    return <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}><Back onClick={() => navigate(`/projects/${id}`)} /><Typography sx={{ color: tokens.attn, mt: 2 }}>{error}</Typography></Box>;
  }
  if (!wf) return <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={24} /></Stack>;

  const editable = wf.has_custom && canManage;

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      <Back onClick={() => navigate(`/projects/${id}`)} />

      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mt: 2, mb: 1 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 26 }}>Workflow</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 14 }}>
            {wf.has_custom
              ? "This project uses a custom workflow. Every status maps to a canonical category."
              : "This project uses the built-in default workflow."}
          </Typography>
        </Box>
        <Chip label={wf.has_custom ? "Custom" : "Default"} size="small"
          sx={{ bgcolor: wf.has_custom ? tokens.kriyaWash : "#EEF0F3", color: wf.has_custom ? tokens.kriyaInk : tokens.text2, fontWeight: 600 }} />
      </Stack>

      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ my: 2 }}>Workflow saved.</Alert>}

      {!wf.has_custom && (
        <Paper sx={{ p: 2.5, borderRadius: 3, my: 2 }}>
          <Typography sx={{ fontSize: 14, mb: 1.5 }}>
            Customize to define your own statuses and the transitions between them. The default is cloned as a starting point.
          </Typography>
          {canManage ? (
            <Button variant="contained" onClick={() => run(customizeWorkflow(id!))} disabled={saving}>
              Customize this workflow
            </Button>
          ) : (
            <Typography sx={{ fontSize: 13, color: tokens.text3 }}>You need the “manage workflows” capability to edit.</Typography>
          )}
        </Paper>
      )}

      {/* statuses */}
      <Typography variant="h3" sx={{ fontSize: 16, mt: 3, mb: 1.5 }}>Statuses</Typography>
      <Stack spacing={1}>
        {statuses.map((s, i) => (
          <Paper key={s.key} sx={{ p: 1.5, borderRadius: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Radio size="small" checked={s.is_initial} disabled={!editable} onChange={() => setInitial(s.key)} title="Initial status" />
            {editable ? (
              <TextField value={s.label} size="small" variant="standard" onChange={(e) => updateStatus(i, { label: e.target.value })} sx={{ flex: 1 }} />
            ) : (
              <Typography sx={{ flex: 1, fontSize: 14 }}>{s.label}</Typography>
            )}
            <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3, width: 120 }}>{s.key}</Typography>
            <Select value={s.category} size="small" disabled={!editable}
              onChange={(e) => updateStatus(i, { category: e.target.value as Category })}
              sx={{ width: 150, fontSize: 12.5 }} renderValue={(v) => (
                <Chip size="small" label={CATEGORY_LABEL[v as Category]} sx={{ height: 20, fontSize: 10.5, color: CATEGORY_COLOR[v as Category], bgcolor: `${CATEGORY_COLOR[v as Category]}1a` }} />
              )}>
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c} sx={{ fontSize: 13 }}>{CATEGORY_LABEL[c]}</MenuItem>
              ))}
            </Select>
            {editable && (
              <IconButton size="small" onClick={() => removeStatus(s.key)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
            )}
          </Paper>
        ))}
      </Stack>
      {editable && (
        <Button size="small" startIcon={<AddRoundedIcon />} onClick={addStatus} sx={{ mt: 1 }}>Add status</Button>
      )}

      {/* transitions */}
      {editable && (
        <>
          <Typography variant="h3" sx={{ fontSize: 16, mt: 3.5, mb: 1 }}>Allowed transitions</Typography>
          <Typography sx={{ fontSize: 12.5, color: tokens.text3, mb: 1.5 }}>
            For each status, choose which statuses a task may move to.
          </Typography>
          <Stack spacing={1}>
            {statuses.map((s) => (
              <Paper key={s.key} sx={{ p: 1.5, borderRadius: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
                <Chip size="small" label={s.label} sx={{ minWidth: 110, color: CATEGORY_COLOR[s.category], bgcolor: `${CATEGORY_COLOR[s.category]}1a`, fontWeight: 600 }} />
                <Typography sx={{ color: tokens.text3 }}>→</Typography>
                <Select multiple size="small" value={targetsFor(s.key)} onChange={(e) => setTargets(s.key, e.target.value as string[])}
                  sx={{ flex: 1, fontSize: 12.5 }} renderValue={(vals) => (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {(vals as string[]).map((v) => <Chip key={v} size="small" label={statuses.find((x) => x.key === v)?.label ?? v} sx={{ height: 20, fontSize: 10.5 }} />)}
                    </Stack>
                  )}>
                  {statuses.filter((x) => x.key !== s.key).map((x) => (
                    <MenuItem key={x.key} value={x.key} sx={{ fontSize: 13 }}>{x.label}</MenuItem>
                  ))}
                </Select>
              </Paper>
            ))}
          </Stack>
        </>
      )}

      {editable && (
        <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save workflow"}</Button>
          <Button color="inherit" onClick={() => run(revertWorkflow(id!))} disabled={saving}>Revert to default</Button>
        </Stack>
      )}
    </Box>
  );
}

function uniqueKey(base: string, statuses: WStatus[]): string {
  let key = slugify(base);
  let n = 1;
  const keys = new Set(statuses.map((s) => s.key));
  while (keys.has(key)) key = `${slugify(base)}_${n++}`;
  return key;
}

function firstError(e: any): string | null {
  const d = e?.response?.data;
  if (!d) return null;
  if (typeof d === "string") return d;
  if (d.detail) return d.detail;
  const first = Object.values(d)[0];
  return Array.isArray(first) ? String(first[0]) : String(first);
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} onClick={onClick}
      sx={{ cursor: "pointer", color: tokens.text2, width: "fit-content", "&:hover": { color: tokens.kriyaInk } }}>
      <ArrowBackRoundedIcon sx={{ fontSize: 17 }} />
      <Typography sx={{ fontSize: 13 }}>Back to project</Typography>
    </Stack>
  );
}
