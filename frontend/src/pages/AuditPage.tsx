import { useEffect, useState } from "react";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import {
  Box, Button, Chip, Collapse, MenuItem, Paper, Select, Stack, Switch, TextField, Typography,
} from "@mui/material";

import {
  exportAudit, listAudit, listAuditActions, listRetention, previewPurge, runPurge, updateRetention,
  type AuditEntry, type AuditFilters, type PurgePreview, type RetentionPolicy,
} from "../features/audit/auditApi";
import { tokens, monoFont } from "../theme";

const ACTION_COLOR = (a: string): string => {
  if (a === "create" || a === "approve") return "#2FA36B";
  if (a === "delete" || a === "reject") return tokens.attn;
  if (a === "login") return tokens.text3;
  if (a === "export") return "#7C5CD6";
  return tokens.kriya;
};

export default function AuditPage() {
  const [tab, setTab] = useState<"activity" | "retention">("activity");
  const [forbidden, setForbidden] = useState(false);

  if (forbidden) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        <Typography variant="h1" sx={{ fontSize: 27, mb: 1 }}>Audit</Typography>
        <Typography sx={{ color: tokens.attn, fontSize: 14 }}>The audit trail is restricted to administrators.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 27, mb: 0.5 }}>Audit &amp; compliance</Typography>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2 }}>
        Every meaningful change, recorded and immutable — who did what, when, and why.
      </Typography>

      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {(["activity", "retention"] as const).map((t) => (
          <Box key={t} onClick={() => setTab(t)}
            sx={{ cursor: "pointer", px: 1.5, py: 1.1, fontSize: 13.5, fontWeight: 500, textTransform: "capitalize",
              color: tab === t ? tokens.kriyaInk : tokens.text2,
              borderBottom: `2px solid ${tab === t ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
            {t === "activity" ? "Activity" : "Retention"}
          </Box>
        ))}
      </Stack>

      {tab === "activity" ? <ActivityTab onForbidden={() => setForbidden(true)} /> : <RetentionTab />}
    </Box>
  );
}

function ActivityTab({ onForbidden }: { onForbidden: () => void }) {
  const [actions, setActions] = useState<{ value: string; label: string }[]>([]);
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [count, setCount] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);

  const filters = (): AuditFilters => ({
    action: action || undefined, search: search || undefined,
    after: after || undefined, before: before || undefined,
  });

  useEffect(() => { listAuditActions().then(setActions).catch(() => {}); }, []);

  const fetchPage = (page: number, append: boolean) => {
    listAudit({ ...filters(), page }).then((data) => {
      setEntries((prev) => (append ? [...prev, ...data.results] : data.results));
      setCount(data.count);
      setNextPage(data.next ? page + 1 : null);
    }).catch((e) => { if (e?.response?.status === 403) onForbidden(); });
  };

  useEffect(() => {
    const h = window.setTimeout(() => fetchPage(1, false), 250);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, search, after, before]);

  return (
    <>
      <Paper sx={{ p: 1.5, borderRadius: "6px", mb: 2, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        <Select size="small" displayEmpty value={action} onChange={(e) => setAction(e.target.value)} sx={{ fontSize: 12.5, minWidth: 150 }}>
          <MenuItem value="" sx={{ fontSize: 12.5 }}>All actions</MenuItem>
          {actions.map((a) => <MenuItem key={a.value} value={a.value} sx={{ fontSize: 12.5 }}>{a.label}</MenuItem>)}
        </Select>
        <TextField size="small" placeholder="Search object or reason" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={after} onChange={(e) => setAfter(e.target.value)} sx={{ width: 150 }} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={before} onChange={(e) => setBefore(e.target.value)} sx={{ width: 150 }} />
        <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => exportAudit(filters())}>Export</Button>
      </Paper>

      <Typography sx={{ fontSize: 11.5, color: tokens.text3, mb: 1 }}>{count} record{count === 1 ? "" : "s"}</Typography>

      <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
        {entries.map((e, i) => <LedgerRow key={e.id} entry={e} first={i === 0} />)}
        {entries.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3, p: 2 }}>No matching audit records.</Typography>}
      </Paper>

      {nextPage && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Button size="small" variant="text" onClick={() => fetchPage(nextPage, true)}>Load more</Button>
        </Stack>
      )}
    </>
  );
}

function LedgerRow({ entry, first }: { entry: AuditEntry; first: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.old_value != null || entry.new_value != null || !!entry.reason;
  const color = ACTION_COLOR(entry.action);
  return (
    <Box sx={{ borderTop: first ? "none" : `1px solid ${tokens.line}` }}>
      <Box onClick={() => hasDetail && setOpen((v) => !v)}
        sx={{ px: 1.75, py: 1.1, display: "flex", alignItems: "center", gap: 1.25, cursor: hasDetail ? "pointer" : "default" }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3, width: 132, flexShrink: 0 }} noWrap>
          {new Date(entry.created_at).toLocaleString()}
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 500, width: 130, flexShrink: 0 }} noWrap>{entry.actor_name}</Typography>
        <Chip label={entry.action_display} size="small" sx={{ height: 19, fontSize: 10, color, bgcolor: `${color}1a`, flexShrink: 0 }} />
        <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text2, flex: 1 }} noWrap>
          {entry.object_type}{entry.object_id ? `#${entry.object_id}` : ""}
        </Typography>
        {hasDetail && <ExpandMoreRoundedIcon sx={{ fontSize: 18, color: tokens.text3, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 4.25, pb: 1.5, bgcolor: tokens.paper }}>
          {entry.reason && <Typography sx={{ fontSize: 12.5, mb: 0.75 }}><b>Reason:</b> {entry.reason}</Typography>}
          {entry.old_value != null && <ValueLine sign="−" color={tokens.attn} value={entry.old_value} />}
          {entry.new_value != null && <ValueLine sign="+" color="#2FA36B" value={entry.new_value} />}
          {entry.source_ip && <Typography sx={{ fontSize: 11, color: tokens.text3, mt: 0.5 }}>from {entry.source_ip}</Typography>}
        </Box>
      </Collapse>
    </Box>
  );
}

function ValueLine({ sign, color, value }: { sign: string; color: string; value: unknown }) {
  return (
    <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {sign} {typeof value === "string" ? value : JSON.stringify(value)}
    </Typography>
  );
}

function RetentionTab() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [preview, setPreview] = useState<PurgePreview[]>([]);

  const load = () => {
    listRetention().then(setPolicies).catch(() => setPolicies([]));
    previewPurge().then(setPreview).catch(() => setPreview([]));
  };
  useEffect(load, []);

  const eligible = (rt: string) => preview.find((p) => p.record_type === rt)?.eligible ?? 0;
  const totalEligible = preview.reduce((s, p) => s + p.eligible, 0);

  const purge = async () => {
    if (!window.confirm(`Permanently delete ${totalEligible} expired record(s)? Audit & regulatory records are never affected.`)) return;
    await runPurge();
    load();
  };

  return (
    <>
      <Stack spacing={1.25}>
        {policies.map((p) => (
          <PolicyRow key={p.id} policy={p} eligible={eligible(p.record_type)} onSaved={load} />
        ))}
        {policies.length === 0 && (
          <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>
            No retention policies yet — run <code>python manage.py seed_retention</code>.
          </Typography>
        )}
      </Stack>

      {policies.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 2.5 }}>
          <Button variant="contained" color="error" onClick={purge} disabled={totalEligible === 0}>
            Run purge{totalEligible > 0 ? ` (${totalEligible})` : ""}
          </Button>
          <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>
            Only purge-safe types are ever deleted; audit &amp; regulatory records are exempt.
          </Typography>
        </Stack>
      )}
    </>
  );
}

function PolicyRow({ policy, eligible, onSaved }: { policy: RetentionPolicy; eligible: number; onSaved: () => void }) {
  const [days, setDays] = useState(policy.retention_days?.toString() ?? "");
  const saveDays = () => {
    const value = days.trim() === "" ? null : Number(days);
    if (value !== policy.retention_days) updateRetention(policy.id, { retention_days: value }).then(onSaved);
  };
  const toggleExempt = () => updateRetention(policy.id, { is_exempt: !policy.is_exempt }).then(onSaved);

  return (
    <Paper sx={{ p: 1.75, borderRadius: "6px", display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box sx={{ flex: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{policy.label}</Typography>
          {policy.is_exempt && <Chip label="exempt" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />}
          {!policy.is_exempt && eligible > 0 && <Chip label={`${eligible} to purge`} size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: tokens.attnWash, color: tokens.attn }} />}
        </Stack>
        <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.25 }}>{policy.description}</Typography>
      </Box>
      {!policy.is_exempt && (
        <TextField size="small" type="number" label="Keep days" InputLabelProps={{ shrink: true }}
          placeholder="∞" value={days} onChange={(e) => setDays(e.target.value)} onBlur={saveDays} sx={{ width: 110 }} />
      )}
      <Stack alignItems="center" spacing={0} sx={{ width: 64 }}>
        <Switch size="small" checked={policy.is_exempt} onChange={toggleExempt} />
        <Typography sx={{ fontSize: 9.5, color: tokens.text3 }}>exempt</Typography>
      </Stack>
    </Paper>
  );
}
