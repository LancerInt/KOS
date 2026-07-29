import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import WarningRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import InboxRoundedIcon from "@mui/icons-material/InboxRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import ReportProblemRoundedIcon from "@mui/icons-material/ReportProblemRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";

import { getDashboard, type Dashboard, type Management } from "../features/reports/reportsApi";
import AiActionButton, { AiActionBar } from "../features/ai/AiActionButton";
import { useAiPageContext } from "../features/ai/AiContext";
import { dashboard as dashboardAi, generateReport } from "../features/ai/aiApi";
import { tokens, monoFont, categoryColors } from "../theme";

const CAT_SEGMENTS = [
  { key: "not_started", color: categoryColors.notStarted, label: "Not started" },
  { key: "active", color: categoryColors.active, label: "Active" },
  { key: "waiting", color: categoryColors.waiting, label: "Waiting" },
  { key: "in_review", color: categoryColors.inReview, label: "In review" },
  { key: "done", color: categoryColors.done, label: "Done" },
  { key: "cancelled", color: categoryColors.cancelled, label: "Cancelled" },
] as const;

const HEALTH = [
  { key: "on_track", color: "#2FA36B", label: "On track" },
  { key: "at_risk", color: "#E0A83D", label: "At risk" },
  { key: "off_track", color: tokens.attn, label: "Off track" },
  { key: "on_hold", color: tokens.text3, label: "On hold" },
] as const;

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => { getDashboard().then(setData).catch(() => setData(null)); }, []);

  useAiPageContext(
    useMemo(
      () =>
        data
          ? {
              label: "Dashboard",
              text:
                `The user is viewing their dashboard. Assigned to them: ${data.me.assigned_total}, ` +
                `overdue: ${data.me.overdue}, due within 7 days: ${data.me.due_soon}.` +
                (data.management
                  ? ` Organisation-wide: ${data.management.projects_total} projects, ` +
                    `${data.management.tasks_open} open tasks, ${data.management.tasks_overdue} overdue, ` +
                    `${data.management.open_blockers} open blockers.`
                  : ""),
            }
          : null,
      [data],
    ),
  );

  if (!data) return <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={26} /></Stack>;

  const me = data.me;
  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 27, mb: 0.5 }}>Overview</Typography>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 1.5 }}>
        Where things stand across your work{data.management ? " and the organisation" : ""}.
      </Typography>

      <Box sx={{ mb: 2.5 }}>
        <AiActionBar>
          <AiActionButton label="AI insights" title="Dashboard insights" run={() => dashboardAi.insights()} />
          <AiActionButton label="Explain these numbers" title="What the figures mean" run={() => dashboardAi.explain()} />
          <AiActionButton label="Today's recommendations" title="What to focus on today" run={() => dashboardAi.recommendations()} />
          <AiActionButton label="Weekly report" title="Weekly report" run={() => generateReport("weekly")} />
        </AiActionBar>
      </Box>

      {/* personal */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" }, gap: 1.25, mb: 1.5 }}>
        <MetricTile icon={<InboxRoundedIcon sx={{ fontSize: 20 }} />} label="Assigned to me" value={me.assigned_total} />
        <MetricTile icon={<WarningRoundedIcon sx={{ fontSize: 20 }} />} label="Overdue" value={me.overdue} attn />
        <MetricTile icon={<EventRoundedIcon sx={{ fontSize: 20 }} />} label="Due within 7 days" value={me.due_soon} />
      </Box>
      <Paper sx={{ p: 2, borderRadius: "6px", mb: 3 }}>
        <SectionLabel>My work by stage</SectionLabel>
        <DistBar counts={me.by_category as unknown as Record<string, number>} segments={CAT_SEGMENTS} />
      </Paper>

      {data.management && <ManagementView m={data.management} />}
    </Box>
  );
}

function ManagementView({ m }: { m: Management }) {
  const navigate = useNavigate();
  return (
    <>
      <Typography variant="h3" sx={{ fontSize: 18, mb: 1.5 }}>Management</Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(4,1fr)" }, gap: 1.25, mb: 2 }}>
        <MetricTile icon={<FolderRoundedIcon sx={{ fontSize: 20 }} />} label="Projects" value={m.projects_total} />
        <MetricTile icon={<TaskAltRoundedIcon sx={{ fontSize: 20 }} />} label="Open tasks" value={m.tasks_open} />
        <MetricTile icon={<WarningRoundedIcon sx={{ fontSize: 20 }} />} label="Overdue tasks" value={m.tasks_overdue} attn />
        <MetricTile icon={<BlockRoundedIcon sx={{ fontSize: 20 }} />} label="Open blockers" value={m.open_blockers} attn />
        <MetricTile icon={<ReportProblemRoundedIcon sx={{ fontSize: 20 }} />} label="High risks" value={m.high_risks} attn />
        <MetricTile icon={<FactCheckRoundedIcon sx={{ fontSize: 20 }} />} label="Pending approvals" value={m.pending_approvals} />
        <MetricTile icon={<DescriptionRoundedIcon sx={{ fontSize: 20 }} />} label="Docs expiring" value={m.documents_expiring} />
        <MetricTile icon={<MenuBookRoundedIcon sx={{ fontSize: 20 }} />} label="SOP reviews due" value={m.sops_review_due} />
      </Box>

      <Paper sx={{ p: 2, borderRadius: "6px", mb: 2 }}>
        <SectionLabel>Portfolio health</SectionLabel>
        <DistBar counts={m.by_health} segments={HEALTH} />
      </Paper>

      {/* Escalation ledger — the §22.4 signature */}
      <Paper sx={{ p: 0, borderRadius: "6px", mb: 2, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1, borderBottom: `1px solid ${tokens.line}` }}>
          <WarningRoundedIcon sx={{ fontSize: 18, color: tokens.attn }} />
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Unacknowledged escalations</Typography>
          <Box component="span" sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>{m.escalations.length}</Box>
        </Box>
        {m.escalations.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: tokens.text3, px: 2, py: 1.75 }}>
            Nothing outstanding — every 48-hour acknowledgement is answered.
          </Typography>
        ) : (
          m.escalations.map((e) => (
            <Box key={e.id} sx={{ px: 2, py: 1.25, borderLeft: `3px solid ${tokens.attn}`, borderBottom: `1px solid ${tokens.line}`,
              display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 500 }} noWrap>{e.title}</Typography>
                <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
                  {e.recipient}{e.project ? ` · ${e.project}` : ""}
                </Typography>
              </Box>
              <Box sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.attn, whiteSpace: "nowrap" }}>
                {e.hours_open}h open
              </Box>
            </Box>
          ))
        )}
      </Paper>

      {/* At-risk projects */}
      <Typography variant="h3" sx={{ fontSize: 16, mb: 1 }}>Projects needing attention</Typography>
      {m.at_risk_projects.length === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No projects are flagged at risk.</Typography>
      ) : (
        <Stack spacing={1}>
          {m.at_risk_projects.map((p) => (
            <Paper key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
              sx={{ p: 1.5, borderRadius: "6px", cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5,
                "&:hover": { borderColor: "#DADEE4" } }}>
              <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3, width: 90 }} noWrap>{p.code}</Typography>
              <Typography sx={{ fontSize: 13.5, fontWeight: 550, flex: 1 }} noWrap>{p.name}</Typography>
              <HealthDot health={p.health} />
              {p.overdue_tasks > 0 && <Metric label="overdue" value={p.overdue_tasks} attn />}
              {p.open_risks > 0 && <Metric label="risks" value={p.open_risks} />}
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}

function MetricTile({ icon, label, value, attn }: { icon: ReactNode; label: string; value: number; attn?: boolean }) {
  // A tile is only "hot" (coral) when it's an attention metric AND it actually has a
  // count — an empty dashboard should read calm, not shout. Zeros are dimmed so they
  // don't land as heavy blobs; real numbers get full ink weight.
  const active = value > 0;
  const hot = Boolean(attn) && active;
  return (
    <Paper sx={{ p: 1.5, borderRadius: "6px", display: "flex", alignItems: "center", gap: 1.25,
      transition: "border-color .16s, box-shadow .16s",
      "&:hover": { borderColor: "#DADEE4", boxShadow: "0 1px 2px rgba(20,22,29,.05), 0 8px 22px rgba(20,22,29,.06)" } }}>
      <Box sx={{ width: 36, height: 36, flexShrink: 0, borderRadius: "6px", display: "grid", placeItems: "center",
        bgcolor: hot ? tokens.attnWash : "#F1F3F6", color: hot ? tokens.attn : tokens.text2 }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 23, fontWeight: 600, lineHeight: 1,
          color: hot ? tokens.attn : active ? tokens.ink : tokens.text3 }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: tokens.text2, mt: 0.4 }} noWrap>{label}</Typography>
      </Box>
    </Paper>
  );
}

function DistBar({ counts, segments }: { counts: Record<string, number>; segments: readonly { key: string; color: string; label: string }[] }) {
  const total = segments.reduce((s, seg) => s + (counts[seg.key] || 0), 0);
  return (
    <>
      <Box sx={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", bgcolor: tokens.line, mt: 1 }}>
        {total > 0 && segments.map((seg) => {
          const n = counts[seg.key] || 0;
          if (n === 0) return null;
          return <Box key={seg.key} sx={{ width: `${(n / total) * 100}%`, bgcolor: seg.color }} title={`${seg.label}: ${n}`} />;
        })}
      </Box>
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
        {segments.map((seg) => (
          <Stack key={seg.key} direction="row" alignItems="center" spacing={0.5}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: seg.color }} />
            <Typography sx={{ fontSize: 11.5, color: tokens.text2 }}>{seg.label}</Typography>
            <Typography sx={{ fontSize: 11.5, fontFamily: monoFont, color: tokens.text3 }}>{counts[seg.key] || 0}</Typography>
          </Stack>
        ))}
      </Stack>
    </>
  );
}

function HealthDot({ health }: { health: string }) {
  const h = HEALTH.find((x) => x.key === health);
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: h?.color ?? tokens.text3 }} />
      <Typography sx={{ fontSize: 11.5, color: tokens.text2 }}>{h?.label ?? health}</Typography>
    </Stack>
  );
}

function Metric({ label, value, attn }: { label: string; value: number; attn?: boolean }) {
  return (
    <Typography sx={{ fontSize: 11.5, fontFamily: monoFont, color: attn ? tokens.attn : tokens.text3, whiteSpace: "nowrap" }}>
      {value} {label}
    </Typography>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600 }}>
      {children}
    </Typography>
  );
}
