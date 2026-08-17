import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAutoRefresh } from "../useAutoRefresh";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { Box, Button, Chip, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material";

import {
  createDecision, createIssue, createRisk, listDecisions, listIssues, listRisks,
  updateDecision, updateIssue, updateRisk,
  type Decision, type Issue, type RegisterStatus, type Risk,
} from "../features/registers/registersApi";
import { PRIORITY_COLOR } from "../features/projects/display";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const STATUSES: RegisterStatus[] = ["open", "in_progress", "mitigated", "closed", "accepted"];
const STATUS_LABEL: Record<RegisterStatus, string> = {
  open: "Open", in_progress: "In progress", mitigated: "Mitigated / resolved", closed: "Closed", accepted: "Accepted",
};
const PROB: { v: string; l: string }[] = [
  { v: "very_high", l: "Very high" }, { v: "high", l: "High" }, { v: "medium", l: "Medium" },
  { v: "low", l: "Low" }, { v: "very_low", l: "Very low" },
];
const scoreColor = (s: number) => (s >= 15 ? tokens.attn : s >= 8 ? "#D98A2B" : tokens.text2);

export default function RegistersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canWrite = ["create_tasks", "manage_project", "administer"].some((k) => k in caps);

  const [tab, setTab] = useState<"risks" | "issues" | "decisions">("risks");
  const [risks, setRisks] = useState<Risk[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);

  const load = () => {
    if (!id) return;
    listRisks(id).then(setRisks);
    listIssues(id).then(setIssues);
    listDecisions(id).then(setDecisions);
  };
  useEffect(load, [id]);
  useAutoRefresh(load);

  const projectId = Number(id);

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" alignItems="center" spacing={0.5} onClick={() => navigate(`/projects/${id}`)}
        sx={{ cursor: "pointer", color: tokens.text2, width: "fit-content", "&:hover": { color: tokens.kriyaInk } }}>
        <ArrowBackRoundedIcon sx={{ fontSize: 17 }} /><Typography sx={{ fontSize: 13 }}>Back to project</Typography>
      </Stack>

      <Typography variant="h1" sx={{ fontSize: 27, mt: 2, mb: 2 }}>Registers</Typography>

      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {(["risks", "issues", "decisions"] as const).map((t) => (
          <Box key={t} onClick={() => setTab(t)}
            sx={{ cursor: "pointer", px: 1.5, py: 1.1, fontSize: 13.5, fontWeight: 500, textTransform: "capitalize",
              color: tab === t ? tokens.kriyaInk : tokens.text2, borderBottom: `2px solid ${tab === t ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
            {t} <Box component="span" sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3 }}>
              {t === "risks" ? risks.length : t === "issues" ? issues.length : decisions.length}
            </Box>
          </Box>
        ))}
      </Stack>

      {tab === "risks" && (
        <RiskTab risks={risks} canWrite={canWrite} projectId={projectId} reload={load} />
      )}
      {tab === "issues" && (
        <IssueTab issues={issues} canWrite={canWrite} projectId={projectId} reload={load} />
      )}
      {tab === "decisions" && (
        <DecisionTab decisions={decisions} canWrite={canWrite} projectId={projectId} reload={load} />
      )}
    </Box>
  );
}

function StatusSelect({ value, onChange }: { value: RegisterStatus; onChange: (v: RegisterStatus) => void }) {
  return (
    <Select size="small" value={value} onChange={(e) => onChange(e.target.value as RegisterStatus)} sx={{ fontSize: 12, height: 28 }}>
      {STATUSES.map((s) => <MenuItem key={s} value={s} sx={{ fontSize: 12.5 }}>{STATUS_LABEL[s]}</MenuItem>)}
    </Select>
  );
}

function RiskTab({ risks, canWrite, projectId, reload }: { risks: Risk[]; canWrite: boolean; projectId: number; reload: () => void }) {
  const [statement, setStatement] = useState("");
  const [prob, setProb] = useState("medium");
  const [impact, setImpact] = useState("medium");
  const add = () => {
    if (!statement.trim()) return;
    createRisk({ project: projectId, statement, probability: prob as any, impact: impact as any }).then(() => { setStatement(""); reload(); });
  };
  return (
    <>
      {canWrite && (
        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <TextField size="small" placeholder="Risk statement" value={statement} onChange={(e) => setStatement(e.target.value)} sx={{ flex: 1, minWidth: 200 }} />
          <Select size="small" value={prob} onChange={(e) => setProb(e.target.value)} sx={{ fontSize: 12.5 }}>{PROB.map((p) => <MenuItem key={p.v} value={p.v} sx={{ fontSize: 12.5 }}>P: {p.l}</MenuItem>)}</Select>
          <Select size="small" value={impact} onChange={(e) => setImpact(e.target.value)} sx={{ fontSize: 12.5 }}>{PROB.map((p) => <MenuItem key={p.v} value={p.v} sx={{ fontSize: 12.5 }}>I: {p.l}</MenuItem>)}</Select>
          <Button variant="outlined" onClick={add}>Add risk</Button>
        </Paper>
      )}
      <Stack spacing={1}>
        {risks.map((r) => (
          <Paper key={r.id} sx={{ p: 1.75, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ minWidth: 34, height: 34, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: `${scoreColor(r.score)}1a`, color: scoreColor(r.score), fontFamily: monoFont, fontWeight: 700, fontSize: 14 }}>{r.score}</Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{r.statement}</Typography>
              <Typography sx={{ fontSize: 11.5, color: tokens.text3, textTransform: "capitalize" }}>P: {r.probability.replace("_", " ")} · I: {r.impact.replace("_", " ")}</Typography>
            </Box>
            <StatusSelect value={r.status} onChange={(v) => updateRisk(r.id, { status: v }).then(reload)} />
          </Paper>
        ))}
        {risks.length === 0 && <Empty label="No risks logged." />}
      </Stack>
    </>
  );
}

function IssueTab({ issues, canWrite, projectId, reload }: { issues: Issue[]; canWrite: boolean; projectId: number; reload: () => void }) {
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const add = () => {
    if (!description.trim()) return;
    createIssue({ project: projectId, description, severity: severity as any }).then(() => { setDescription(""); reload(); });
  };
  return (
    <>
      {canWrite && (
        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <TextField size="small" placeholder="What happened?" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ flex: 1, minWidth: 200 }} />
          <Select size="small" value={severity} onChange={(e) => setSeverity(e.target.value)} sx={{ fontSize: 12.5 }}>{["critical", "high", "medium", "low"].map((s) => <MenuItem key={s} value={s} sx={{ fontSize: 12.5, textTransform: "capitalize" }}>{s}</MenuItem>)}</Select>
          <Button variant="outlined" onClick={add}>Add issue</Button>
        </Paper>
      )}
      <Stack spacing={1}>
        {issues.map((i) => (
          <Paper key={i.id} sx={{ p: 1.75, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Chip label={i.severity} size="small" sx={{ height: 20, fontSize: 10, textTransform: "capitalize", color: PRIORITY_COLOR[i.severity], bgcolor: `${PRIORITY_COLOR[i.severity]}1a` }} />
            <Typography sx={{ fontSize: 14, flex: 1 }}>{i.description}</Typography>
            <StatusSelect value={i.status} onChange={(v) => updateIssue(i.id, { status: v }).then(reload)} />
          </Paper>
        ))}
        {issues.length === 0 && <Empty label="No issues logged." />}
      </Stack>
    </>
  );
}

function DecisionTab({ decisions, canWrite, projectId, reload }: { decisions: Decision[]; canWrite: boolean; projectId: number; reload: () => void }) {
  const [required, setRequired] = useState("");
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const add = () => {
    if (!required.trim()) return;
    createDecision({ project: projectId, decision_required: required, decision, rationale }).then(() => { setRequired(""); setDecision(""); setRationale(""); reload(); });
  };
  return (
    <>
      {canWrite && (
        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
          <Stack spacing={1}>
            <TextField size="small" placeholder="Decision required" value={required} onChange={(e) => setRequired(e.target.value)} fullWidth />
            <TextField size="small" placeholder="Decision taken" value={decision} onChange={(e) => setDecision(e.target.value)} fullWidth />
            <TextField size="small" placeholder="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} fullWidth />
            <Button variant="outlined" onClick={add} sx={{ alignSelf: "flex-start" }}>Log decision</Button>
          </Stack>
        </Paper>
      )}
      <Stack spacing={1}>
        {decisions.map((d) => (
          <Paper key={d.id} sx={{ p: 1.75, borderRadius: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{d.decision_required}</Typography>
              <StatusSelect value={d.status} onChange={(v) => updateDecision(d.id, { status: v }).then(reload)} />
            </Stack>
            {d.decision && <Typography sx={{ fontSize: 13, mt: 0.5 }}>→ {d.decision}</Typography>}
            {d.rationale && <Typography sx={{ fontSize: 12.5, color: tokens.text3, mt: 0.25 }}>{d.rationale}</Typography>}
          </Paper>
        ))}
        {decisions.length === 0 && <Empty label="No decisions logged." />}
      </Stack>
    </>
  );
}

function Empty({ label }: { label: string }) {
  return <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>{label}</Typography>;
}
