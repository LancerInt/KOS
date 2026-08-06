import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Select, Stack, Switch, TextField, Typography,
} from "@mui/material";

import {
  createRule, deleteRule, getVocabulary, listLogs, listRules, updateRule,
  type AutomationActionSpec, type AutomationLog, type AutomationRule, type Condition, type Vocabulary,
} from "../features/automation/automationApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const CATEGORY_OPTIONS = [
  { value: "not_started", label: "Not started" }, { value: "active", label: "Active" },
  { value: "waiting", label: "Waiting" }, { value: "in_review", label: "In review" },
  { value: "done", label: "Done" }, { value: "cancelled", label: "Cancelled" },
];
const FIELD_LABEL: Record<string, string> = {
  status: "status", category: "category", priority: "priority", task_type: "task type",
  is_overdue: "is overdue", has_open_blocker: "has open blocker",
};
const ACTION_PARAM: Record<string, "message" | "status" | "priority" | "tag" | "comment" | "none"> = {
  notify_owners: "message", notify_primary_owner: "message", notify_manager: "message",
  set_priority: "priority", set_status: "status", add_tag: "tag", add_comment: "comment",
  flag_project_at_risk: "none",
};

export default function AutomationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const projectId = Number(id);
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canManage = "manage_workflows" in caps || "administer" in caps;

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);

  const load = () => {
    listRules().then((all) => setRules(all.filter((r) => r.project === projectId || r.project === null)));
    if (id) listLogs(id).then(setLogs).catch(() => setLogs([]));
  };
  useEffect(() => { getVocabulary().then(setVocab); load(); /* eslint-disable-next-line */ }, [id]);

  const toggle = (r: AutomationRule) => updateRule(r.id, { is_active: !r.is_active }).then(load);
  const remove = (r: AutomationRule) => { if (window.confirm(`Delete "${r.name}"?`)) deleteRule(r.id).then(load); };

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} onClick={() => navigate(`/projects/${id}`)}
        sx={{ cursor: "pointer", color: tokens.text2, width: "fit-content", "&:hover": { color: tokens.kriyaInk } }}>
        <ArrowBackRoundedIcon sx={{ fontSize: 17 }} /><Typography sx={{ fontSize: 13 }}>Back to project</Typography>
      </Stack>

      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mt: 2, mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>Automation</Typography>
        {canManage && vocab && (
          <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={() => setEditing("new")}>
            New rule
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2.5 }}>
        When something happens, check conditions, then act — no code required.
      </Typography>

      <Stack spacing={1.25}>
        {rules.map((r) => (
          <RuleCard key={r.id} rule={r} vocab={vocab} canManage={canManage}
            onToggle={() => toggle(r)} onEdit={() => setEditing(r)} onDelete={() => remove(r)} />
        ))}
        {rules.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No automation rules yet.</Typography>}
      </Stack>

      {logs.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h3" sx={{ fontSize: 16, mb: 1.25 }}>Recent runs</Typography>
          <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
            {logs.slice(0, 20).map((l, i) => (
              <Box key={l.id} sx={{ px: 1.75, py: 1, display: "flex", alignItems: "center", gap: 1.25,
                borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
                <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: l.ok ? "#2FA36B" : tokens.attn }} />
                <Typography sx={{ fontSize: 13, fontWeight: 500, flex: 1 }} noWrap>{l.rule_name}</Typography>
                <Typography sx={{ fontSize: 11.5, color: tokens.text3 }} noWrap>
                  {l.ok ? (l.actions_run.join(", ") || "no actions") : l.message}
                </Typography>
                <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3, whiteSpace: "nowrap" }}>
                  {new Date(l.created_at).toLocaleString()}
                </Typography>
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {editing && vocab && (
        <RuleDialog
          rule={editing === "new" ? null : editing} vocab={vocab} projectId={projectId}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </Box>
  );
}

function RuleCard({ rule, vocab, canManage, onToggle, onEdit, onDelete }: {
  rule: AutomationRule; vocab: Vocabulary | null; canManage: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const opLabel = (op: string) => vocab?.condition_ops.find((o) => o.value === op)?.label ?? op;
  const actLabel = (t: string) => vocab?.actions.find((a) => a.value === t)?.label ?? t;
  return (
    <Paper sx={{ p: 1.75, borderRadius: 3, opacity: rule.is_active ? 1 : 0.6 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{rule.name}</Typography>
        {rule.project === null && <Chip label="global" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: tokens.ink, color: "#fff" }} />}
        <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>ran {rule.run_count}×</Typography>
        {canManage && <>
          <Switch size="small" checked={rule.is_active} onChange={onToggle} />
          <IconButton size="small" onClick={onEdit}><EditRoundedIcon sx={{ fontSize: 17 }} /></IconButton>
          <IconButton size="small" onClick={onDelete}><DeleteOutlineRoundedIcon sx={{ fontSize: 17 }} /></IconButton>
        </>}
      </Stack>

      <Stack spacing={0.6}>
        <Clause tag="WHEN" color={tokens.kriya}>{rule.trigger_display}</Clause>
        {rule.conditions.length > 0 && (
          <Clause tag="IF" color="#7C5CD6">
            {rule.conditions.map((c, i) => (
              <Box component="span" key={i}>
                {i > 0 && <Box component="span" sx={{ color: tokens.text3, mx: 0.5 }}>and</Box>}
                <Box component="span" sx={{ fontWeight: 500 }}>{FIELD_LABEL[c.field] ?? c.field}</Box>{" "}
                <Box component="span" sx={{ color: tokens.text3 }}>{opLabel(c.op)}</Box>{" "}
                <Box component="span" sx={{ fontWeight: 500 }}>{Array.isArray(c.value) ? c.value.join(", ") : c.value}</Box>
              </Box>
            ))}
          </Clause>
        )}
        <Clause tag="THEN" color="#E0A83D">
          {rule.actions.map((a, i) => (
            <Box component="span" key={i}>
              {i > 0 && <Box component="span" sx={{ color: tokens.text3, mx: 0.5 }}>·</Box>}
              <Box component="span" sx={{ fontWeight: 500 }}>{actLabel(a.type)}</Box>
              {(a.value || a.message || a.text) && (
                <Box component="span" sx={{ color: tokens.text3 }}> ({a.value || a.message || a.text})</Box>
              )}
            </Box>
          ))}
        </Clause>
      </Stack>
    </Paper>
  );
}

function Clause({ tag, color, children }: { tag: string; color: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Box sx={{ fontFamily: monoFont, fontSize: 10, fontWeight: 700, letterSpacing: ".05em", color, width: 42, flexShrink: 0 }}>{tag}</Box>
      <Typography component="div" sx={{ fontSize: 13, lineHeight: 1.5 }}>{children}</Typography>
    </Stack>
  );
}

function RuleDialog({ rule, vocab, projectId, onClose, onSaved }: {
  rule: AutomationRule | null; vocab: Vocabulary; projectId: number;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? vocab.triggers[0]?.value ?? "");
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationActionSpec[]>(rule?.actions ?? [{ type: "notify_owners" }]);
  const [err, setErr] = useState("");

  const valueOptions = (field: string) => {
    if (field === "status") return vocab.statuses;
    if (field === "priority") return vocab.priorities;
    if (field === "category") return CATEGORY_OPTIONS;
    return null;
  };

  const setCond = (i: number, patch: Partial<Condition>) =>
    setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setAct = (i: number, patch: Partial<AutomationActionSpec>) =>
    setActions((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const save = async () => {
    if (!name.trim()) { setErr("Give the rule a name."); return; }
    if (actions.length === 0) { setErr("Add at least one action."); return; }
    const cleanConds = conditions
      .filter((c) => c.field)
      .map((c) => (c.op === "in" && typeof c.value === "string"
        ? { ...c, value: c.value.split(",").map((v) => v.trim()).filter(Boolean) }
        : c));
    const cleanActions = actions.map((a) => {
      const kind = ACTION_PARAM[a.type];
      if (kind === "none") return { type: a.type };
      if (kind === "comment") return { type: a.type, text: a.text ?? a.message ?? "" };
      if (kind === "message") return { type: a.type, message: a.message ?? "" };
      return { type: a.type, value: a.value ?? "" };
    });
    const payload = { name, project: projectId, trigger, conditions: cleanConds, actions: cleanActions, is_active: isActive };
    try {
      if (rule) await updateRule(rule.id, payload);
      else await createRule(payload);
      onSaved();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data;
      setErr(d?.detail || "Could not save the rule.");
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>{rule ? "Edit rule" : "New rule"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Rule name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />

          <Box>
            <FieldLabel>When</FieldLabel>
            <Select size="small" fullWidth value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {vocab.triggers.map((t) => <MenuItem key={t.value} value={t.value} sx={{ fontSize: 13 }}>{t.label}</MenuItem>)}
            </Select>
          </Box>

          <Box>
            <FieldLabel>If (all must hold — optional)</FieldLabel>
            <Stack spacing={1}>
              {conditions.map((c, i) => {
                const opts = valueOptions(c.field);
                const noValue = c.op === "is_true" || c.op === "is_false";
                return (
                  <Stack key={i} direction="row" spacing={0.75} alignItems="center">
                    <Select size="small" value={c.field} displayEmpty onChange={(e) => setCond(i, { field: e.target.value })} sx={{ fontSize: 12.5, minWidth: 120 }}>
                      {vocab.condition_fields.map((f) => <MenuItem key={f} value={f} sx={{ fontSize: 12.5 }}>{FIELD_LABEL[f] ?? f}</MenuItem>)}
                    </Select>
                    <Select size="small" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} sx={{ fontSize: 12.5, minWidth: 90 }}>
                      {vocab.condition_ops.map((o) => <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12.5 }}>{o.label}</MenuItem>)}
                    </Select>
                    {!noValue && (opts ? (
                      <Select size="small" value={(c.value as string) ?? ""} onChange={(e) => setCond(i, { value: e.target.value })} sx={{ fontSize: 12.5, flex: 1 }}>
                        {opts.map((o) => <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12.5 }}>{o.label}</MenuItem>)}
                      </Select>
                    ) : (
                      <TextField size="small" placeholder={c.op === "in" ? "a, b, c" : "value"} value={(c.value as string) ?? ""} onChange={(e) => setCond(i, { value: e.target.value })} sx={{ flex: 1 }} />
                    ))}
                    <IconButton size="small" onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))}><CloseRoundedIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Stack>
                );
              })}
              <Button size="small" variant="text" startIcon={<AddRoundedIcon />} sx={{ alignSelf: "flex-start" }}
                onClick={() => setConditions((cs) => [...cs, { field: vocab.condition_fields[0], op: "eq", value: "" }])}>
                Add condition
              </Button>
            </Stack>
          </Box>

          <Box>
            <FieldLabel>Then</FieldLabel>
            <Stack spacing={1}>
              {actions.map((a, i) => (
                <Stack key={i} direction="row" spacing={0.75} alignItems="center">
                  <Select size="small" value={a.type} onChange={(e) => setAct(i, { type: e.target.value })} sx={{ fontSize: 12.5, minWidth: 180 }}>
                    {vocab.actions.map((o) => <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12.5 }}>{o.label}</MenuItem>)}
                  </Select>
                  <ActionParam action={a} vocab={vocab} onChange={(patch) => setAct(i, patch)} />
                  <IconButton size="small" onClick={() => setActions((as) => as.filter((_, j) => j !== i))}><CloseRoundedIcon sx={{ fontSize: 16 }} /></IconButton>
                </Stack>
              ))}
              <Button size="small" variant="text" startIcon={<AddRoundedIcon />} sx={{ alignSelf: "flex-start" }}
                onClick={() => setActions((as) => [...as, { type: "notify_owners" }])}>
                Add action
              </Button>
            </Stack>
          </Box>

          <Stack direction="row" alignItems="center" spacing={1}>
            <Switch size="small" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <Typography sx={{ fontSize: 13 }}>Active</Typography>
          </Stack>
          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>{rule ? "Save" : "Create rule"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ActionParam({ action, vocab, onChange }: {
  action: AutomationActionSpec; vocab: Vocabulary; onChange: (patch: Partial<AutomationActionSpec>) => void;
}) {
  const kind = ACTION_PARAM[action.type];
  if (kind === "none") return <Box sx={{ flex: 1 }} />;
  if (kind === "message")
    return <TextField size="small" placeholder="Message (optional)" value={action.message ?? ""} onChange={(e) => onChange({ message: e.target.value })} sx={{ flex: 1 }} />;
  if (kind === "comment")
    return <TextField size="small" placeholder="Comment text" value={action.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} sx={{ flex: 1 }} />;
  if (kind === "tag")
    return <TextField size="small" placeholder="Tag" value={action.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} sx={{ flex: 1 }} />;
  const opts = kind === "status" ? vocab.statuses : vocab.priorities;
  return (
    <Select size="small" displayEmpty value={action.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} sx={{ fontSize: 12.5, flex: 1 }}>
      <MenuItem value="" sx={{ fontSize: 12.5, color: tokens.text3 }}>Choose…</MenuItem>
      {opts.map((o) => <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12.5 }}>{o.label}</MenuItem>)}
    </Select>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.5 }}>{children}</Typography>;
}
