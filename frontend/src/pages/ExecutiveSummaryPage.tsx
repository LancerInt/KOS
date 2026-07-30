/**
 * Executive Summary — the organisation-level briefing for managers and admins.
 *
 * The split this page is built around: **the figures are computed, the prose is
 * generated.** Health score, risk ranking and every metric come from ordinary
 * arithmetic over ERP rows, so the charts and tiles stay correct even when the
 * AI provider is down; the narrative and recommendations are the AI's
 * contribution. The page marks the difference rather than blurring it.
 *
 * Access is gated server-side on `view_reports` / `administer`; the route is
 * hidden client-side to match, but the API is the authority.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Snackbar, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Tooltip, Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";

import { useAppSelector } from "../hooks";
import { useAiPageContext } from "../features/ai/AiContext";
import {
  aiErrorMessage, downloadExecutiveSummaryCsv, emailExecutiveSummary, executiveSummaryToText,
  generateExecutiveSummary, getExecutiveSummary, listExecutiveSummaries,
  type ExecutivePeriod, type ExecutiveProjectRisk, type ExecutiveRiskEntry,
  type ExecutiveSummary, type ExecutiveSummaryListEntry,
} from "../features/ai/aiApi";
import { tokens, monoFont } from "../theme";

const POLL_INTERVAL_MS = 2500;
const POLL_LIMIT = 40; // ≈100s — an org-wide summary is the longest call we make

const PERIODS: { key: ExecutivePeriod; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

/** Health bands. Kept to the brand teal plus the single coral, like the rest of KOS. */
function healthTone(score: number): { fg: string; bg: string; label: string } {
  if (score >= 85) return { fg: "#1E7A50", bg: "#E7F4EC", label: "Healthy" };
  if (score >= 70) return { fg: tokens.kriyaInk, bg: tokens.kriyaWash, label: "Steady" };
  if (score >= 50) return { fg: "#9A6A16", bg: "#FBF2DF", label: "Needs attention" };
  return { fg: tokens.attn, bg: tokens.attnWash, label: "At risk" };
}

function titleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Big score dial. SVG rather than a chart library — one number, no dependency. */
function HealthDial({ score }: { score: number }) {
  const tone = healthTone(score);
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <Stack alignItems="center" spacing={1}>
      <Box sx={{ position: "relative", width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="70" cy="70" r={r} fill="none" stroke={tokens.line} strokeWidth="12" />
          <circle
            cx="70" cy="70" r={r} fill="none" stroke={tone.fg} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            style={{ transition: "stroke-dasharray .5s ease" }}
          />
        </svg>
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <Box sx={{ textAlign: "center" }}>
            <Typography
              sx={{ fontFamily: '"Manrope Variable"', fontSize: 34, fontWeight: 700, lineHeight: 1, color: tone.fg, fontVariantNumeric: "tabular-nums" }}
            >
              {score}
            </Typography>
            <Typography sx={{ fontSize: 10.5, color: tokens.text3, mt: 0.3 }}>out of 100</Typography>
          </Box>
        </Box>
      </Box>
      <Chip
        size="small" label={tone.label}
        sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: tone.bg, color: tone.fg }}
      />
    </Stack>
  );
}

function StatTile({ label, value, attn, suffix }: { label: string; value: number | string; attn?: boolean; suffix?: string }) {
  const hot = Boolean(attn) && Number(value) > 0;
  return (
    <Paper sx={{ p: 1.5, borderRadius: "8px" }}>
      <Typography
        sx={{ fontFamily: '"Manrope Variable"', fontSize: 22, fontWeight: 600, lineHeight: 1, color: hot ? tokens.attn : tokens.ink, fontVariantNumeric: "tabular-nums" }}
      >
        {value}{suffix}
      </Typography>
      <Typography sx={{ fontSize: 11.5, color: tokens.text2, mt: 0.5 }} noWrap>{label}</Typography>
    </Paper>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 2, borderRadius: "8px" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography
          sx={{ fontFamily: '"Manrope Variable"', fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".07em", color: tokens.text3, fontWeight: 600, flex: 1 }}
        >
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

/** Recommendation cards — the AI's actionable output, kept visually distinct. */
function RecommendationCards({ items, accent }: { items: string[]; accent?: boolean }) {
  const list = (items ?? []).filter((i) => typeof i === "string" && i.trim());
  if (!list.length) return <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Nothing recommended.</Typography>;

  return (
    <Stack spacing={1}>
      {list.map((item, index) => (
        <Box
          key={index}
          sx={{
            p: 1.35, borderRadius: "6px", bgcolor: tokens.paper,
            border: `1px solid ${tokens.line}`,
            borderLeft: `2px solid ${accent ? tokens.kriya : tokens.line}`,
          }}
        >
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.6 }}>{item}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

/** AI risk/team entries arrive as either objects or plain strings. */
function EntryList({ items }: { items: (ExecutiveRiskEntry | string)[] }) {
  const list = items ?? [];
  if (!list.length) return <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Nothing flagged.</Typography>;

  return (
    <Stack spacing={1}>
      {list.map((item, index) => {
        if (typeof item === "string") {
          return <Typography key={index} sx={{ fontSize: 13.5, lineHeight: 1.6 }}>• {item}</Typography>;
        }
        const head = item.name ?? item.team ?? "";
        return (
          <Box key={index} sx={{ p: 1.35, borderRadius: "6px", bgcolor: tokens.paper, border: `1px solid ${tokens.line}` }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.35 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{head}</Typography>
              {item.risk && (
                <Typography sx={{ fontFamily: monoFont, fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: tokens.text3 }}>
                  {item.risk}
                </Typography>
              )}
            </Stack>
            {item.reason && <Typography sx={{ fontSize: 12.5, color: tokens.text2 }}>{item.reason}</Typography>}
            {item.action && (
              <Typography sx={{ fontSize: 12.5, mt: 0.4 }}>
                <strong>Action:</strong> {item.action}
              </Typography>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

/** Computed risk table — figures, independent of whatever the AI wrote. */
function RiskTable({ rows }: { rows: ExecutiveProjectRisk[] }) {
  if (!rows.length) {
    return <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No projects are currently at risk.</Typography>;
  }
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ "& th": { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: tokens.text3, fontWeight: 600, borderColor: tokens.line, whiteSpace: "nowrap" } }}>
            <TableCell>Project</TableCell>
            <TableCell>Manager</TableCell>
            <TableCell align="right">Risk</TableCell>
            <TableCell align="right">Overdue</TableCell>
            <TableCell align="right">Open</TableCell>
            <TableCell align="right">Done</TableCell>
            <TableCell>Why</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const tone = healthTone(100 - row.risk_score);
            return (
              <TableRow key={row.id} sx={{ "& td": { borderColor: tokens.line } }}>
                <TableCell>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 550 }}>{row.name}</Typography>
                  <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont }}>{row.code}</Typography>
                </TableCell>
                <TableCell><Typography sx={{ fontSize: 12.5 }}>{row.manager || "—"}</Typography></TableCell>
                <TableCell align="right">
                  <Chip size="small" label={row.risk_score} sx={{ height: 20, fontSize: 11, fontFamily: monoFont, fontWeight: 600, bgcolor: tone.bg, color: tone.fg }} />
                </TableCell>
                <TableCell align="right">
                  <Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: row.overdue_tasks ? tokens.attn : tokens.text2 }}>
                    {row.overdue_tasks}
                  </Typography>
                </TableCell>
                <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.text2 }}>{row.open_tasks}</Typography></TableCell>
                <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.text2 }}>{row.completion_percent}%</Typography></TableCell>
                <TableCell><Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>{row.reasons.join("; ")}</Typography></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

/** Health-score trend across previous summaries of the same period. */
function TrendChart({ history }: { history: ExecutiveSummaryListEntry[] }) {
  const points = [...history].reverse().slice(-12);
  if (points.length < 2) {
    return <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Not enough history yet to show a trend.</Typography>;
  }

  const width = 100;
  const height = 40;
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(height - (p.health_score / 100) * height).toFixed(2)}`)
    .join(" ");
  const latest = points[points.length - 1];

  return (
    <Box>
      <Box
        component="svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        sx={{ width: "100%", height: 72, display: "block", overflow: "visible" }}
      >
        <path d={path} fill="none" stroke={tokens.kriya} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle
            key={p.id} cx={i * step} cy={height - (p.health_score / 100) * height} r="1.5"
            fill={tokens.kriya} vectorEffect="non-scaling-stroke"
          >
            <title>{`${p.period_end}: ${p.health_score}/100`}</title>
          </circle>
        ))}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75 }}>
        <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont }}>{points[0].period_end}</Typography>
        <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont }}>{latest.period_end}</Typography>
      </Stack>
    </Box>
  );
}

export default function ExecutiveSummaryPage() {
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const allowed = "view_reports" in caps || "administer" in caps;

  const [period, setPeriod] = useState<ExecutivePeriod>("daily");
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [history, setHistory] = useState<ExecutiveSummaryListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const [toast, setToast] = useState("");

  // Reset on mount as well as set on unmount: StrictMode mounts, unmounts and
  // remounts in development, and a flag left true would silence every update.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const load = useCallback(async (which: ExecutivePeriod) => {
    setLoading(true);
    try {
      const [response, past] = await Promise.all([
        getExecutiveSummary(which),
        listExecutiveSummaries(which).catch(() => []),
      ]);
      if (cancelled.current) return;
      setSummary(response.summary);
      setHistory(past);
      setDetail(response.summary ? "" : response.detail ?? "");
      setError("");
    } catch (err) {
      if (!cancelled.current) setError(aiErrorMessage(err));
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load(period);
    else setLoading(false);
  }, [allowed, period, load]);

  useAiPageContext(
    summary
      ? {
          label: "Executive Summary",
          text:
            `Organisation executive summary for ${summary.period_start} to ${summary.period_end}. ` +
            `Health score ${summary.health_score}/100, ${summary.risk_count} high-risk projects. ` +
            (summary.content.overall_health ?? ""),
        }
      : null,
  );

  const pollUntilReady = useCallback(async (which: ExecutivePeriod) => {
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelled.current) return true;
      const response = await getExecutiveSummary(which);
      if (response.summary) {
        setSummary(response.summary);
        setDetail("");
        setHistory(await listExecutiveSummaries(which).catch(() => []));
        return true;
      }
    }
    return false;
  }, []);

  const generate = async (force: boolean) => {
    setWorking(force ? "Regenerating…" : "Generating…");
    setError("");
    try {
      const response = await generateExecutiveSummary(period, force);
      if (cancelled.current) return;

      if (response.summary) {
        setSummary(response.summary);
        setDetail("");
        setHistory(await listExecutiveSummaries(period).catch(() => []));
      } else if (response.queued) {
        const ready = await pollUntilReady(period);
        if (!ready && !cancelled.current) {
          setError("The summary is still being generated. Try refreshing in a moment.");
        }
      } else {
        setDetail(response.detail ?? "");
      }
    } catch (err) {
      if (!cancelled.current) setError(aiErrorMessage(err));
    } finally {
      if (!cancelled.current) setWorking("");
    }
  };

  const sendEmail = async () => {
    if (!summary) return;
    setWorking("Emailing…");
    try {
      const result = await emailExecutiveSummary(summary.id);
      setToast(`Emailed to ${result.emailed} recipient${result.emailed === 1 ? "" : "s"}.`);
      void load(period);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setWorking("");
    }
  };

  const exportCsv = async () => {
    if (!summary) return;
    try {
      await downloadExecutiveSummaryCsv(summary.id, period);
    } catch (err) {
      setError(aiErrorMessage(err));
    }
  };

  /**
   * PDF via the browser's print dialog ("Save as PDF").
   *
   * A bundled PDF library would add ~300kB to render a document the browser
   * already knows how to produce, and the print stylesheet gives the user the
   * page size and margins they actually want.
   */
  const exportPdf = () => {
    if (!summary) return;
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) {
      setError("Your browser blocked the print window. Allow pop-ups for this site to export a PDF.");
      return;
    }
    const escape = (text: string) =>
      text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    win.document.write(
      `<!doctype html><html><head><title>${escape(summary.title)}</title>` +
        `<style>body{font:13px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#16181D;max-width:44em;margin:2.5em auto;padding:0 1.5em}` +
        `h1{font-size:20px;margin:0 0 .2em}.meta{color:#8A93A3;font-size:12px;margin-bottom:1.5em}` +
        `pre{white-space:pre-wrap;font:inherit;margin:0}@page{margin:18mm}</style></head><body>` +
        `<h1>${escape(summary.title)}</h1>` +
        `<div class="meta">${summary.period_start} to ${summary.period_end} · Health ${summary.health_score}/100</div>` +
        `<pre>${escape(executiveSummaryToText(summary))}</pre>` +
        `</body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };

  if (!allowed) {
    return (
      <Box sx={{ maxWidth: 700, mx: "auto", px: 3, py: 6 }}>
        <Alert severity="warning">
          The executive summary is available to users who hold the “View reports” or “Administer system”
          capability. Ask an administrator if you need access.
        </Alert>
      </Box>
    );
  }

  const metrics = summary?.metrics;
  const detailBlock = metrics?.detail;
  const busy = working !== "";

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", px: 3, py: 3.5 }}>
      {/* head */}
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={2} flexWrap="wrap" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 26 }}>Executive Summary</Typography>
          <Typography sx={{ mt: 0.4, color: tokens.text2, fontSize: 13.5 }}>
            {summary
              ? <>Organisation health for <b style={{ color: tokens.text }}>{summary.period_start}</b> to <b style={{ color: tokens.text }}>{summary.period_end}</b>.</>
              : "An AI-written brief on the health of the business, grounded in your ERP figures."}
          </Typography>
        </Box>
        {summary && (
          <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3 }}>
            {summary.trigger === "manual" ? "Generated manually" : "Generated on schedule"}
            {summary.generated_by_name && ` · ${summary.generated_by_name}`}
          </Typography>
        )}
      </Stack>

      {/* period switch */}
      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {PERIODS.map((p) => {
          const active = p.key === period;
          return (
            <Box
              key={p.key} onClick={() => setPeriod(p.key)}
              sx={{
                cursor: "pointer", px: 1.75, py: 1.1, fontSize: 13.5, fontWeight: 600,
                color: active ? tokens.kriyaInk : tokens.text2,
                borderBottom: `2px solid ${active ? tokens.kriya : "transparent"}`, mb: "-1px",
              }}
            >
              {p.label}
            </Box>
          );
        })}
      </Stack>

      {/* actions */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2.5 }}>
        <Button
          size="small" variant="contained" disabled={busy}
          startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={() => void generate(false)}
        >
          {working === "Generating…" ? working : "Generate Executive Summary"}
        </Button>
        <Button
          size="small" variant="outlined" disabled={busy || !summary}
          startIcon={<RefreshRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={() => void generate(true)}
        >
          {working === "Regenerating…" ? working : "Regenerate"}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Send to everyone who can read reports">
          <span>
            <Button size="small" color="inherit" disabled={busy || !summary} startIcon={<EmailRoundedIcon sx={{ fontSize: 16 }} />} onClick={() => void sendEmail()}>
              {working === "Emailing…" ? working : "Email report"}
            </Button>
          </span>
        </Tooltip>
        <Button size="small" color="inherit" disabled={!summary} startIcon={<DownloadRoundedIcon sx={{ fontSize: 16 }} />} onClick={() => void exportCsv()}>
          Export CSV
        </Button>
        <Button size="small" color="inherit" disabled={!summary} startIcon={<PictureAsPdfRoundedIcon sx={{ fontSize: 16 }} />} onClick={exportPdf}>
          Export PDF
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}>
          <CircularProgress size={26} />
          <Typography sx={{ fontSize: 13, color: tokens.text3 }}>Loading…</Typography>
        </Stack>
      ) : busy && !summary ? (
        <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}>
          <CircularProgress size={26} />
          <Typography sx={{ fontSize: 13, color: tokens.text3 }}>
            Analysing the organisation… this takes a few seconds.
          </Typography>
        </Stack>
      ) : !summary || !metrics ? (
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: "8px" }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No executive summary yet</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>
            {detail || "One is generated automatically each day, week and month — or press Generate above."}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2.5}>
          {!summary.ai_ok && (
            <Alert severity="info" sx={{ fontSize: 12.5 }}>
              The AI provider was unavailable when this ran, so the narrative was assembled from the figures
              directly. Every metric below is still accurate.
            </Alert>
          )}

          {/* health + narrative */}
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "220px 1fr" }, gap: 2.5, alignItems: "stretch" }}>
            <Paper sx={{ p: 2, borderRadius: "8px", display: "grid", placeItems: "center" }}>
              <HealthDial score={summary.health_score} />
            </Paper>
            <Paper sx={{ p: 2.5, borderRadius: "8px" }}>
              <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 16, fontWeight: 600, mb: 1 }}>
                {summary.content.title || "Overall health"}
              </Typography>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                {summary.content.overall_health || summary.content.narrative || "No narrative was produced."}
              </Typography>
              {summary.content.productivity_overview && (
                <Typography sx={{ fontSize: 13, lineHeight: 1.7, color: tokens.text2, mt: 1.5 }}>
                  {summary.content.productivity_overview}
                </Typography>
              )}
            </Paper>
          </Box>

          {/* headline figures */}
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(3,1fr)", lg: "repeat(6,1fr)" }, gap: 1.25 }}>
            <StatTile label="Active projects" value={metrics.projects.active ?? 0} />
            <StatTile label="High risk" value={metrics.projects.high_risk ?? 0} attn />
            <StatTile label="Overdue tasks" value={metrics.delivery.overdue_tasks ?? 0} attn />
            <StatTile label="Blocked tasks" value={metrics.delivery.blocked_tasks ?? 0} attn />
            <StatTile label="Completed" value={metrics.delivery.tasks_completed ?? 0} />
            <StatTile label="On time" value={metrics.productivity.on_time_percent ?? 0} suffix="%" />
          </Box>

          {/* risk + trend */}
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 300px" }, gap: 2.5, alignItems: "start" }}>
            <Stack spacing={2.5}>
              <Panel
                title="Projects at risk"
                action={
                  summary.risk_count > 0 ? (
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <WarningAmberRoundedIcon sx={{ fontSize: 15, color: tokens.attn }} />
                      <Typography sx={{ fontSize: 11.5, color: tokens.attn, fontWeight: 600 }}>{summary.risk_count}</Typography>
                    </Stack>
                  ) : undefined
                }
              >
                <RiskTable rows={detailBlock?.high_risk_projects ?? []} />
              </Panel>

              <Panel title="AI assessment — high-risk projects">
                <EntryList items={summary.content.high_risk_projects ?? []} />
              </Panel>

              <Panel title="Teams needing attention">
                <EntryList items={summary.content.teams_needing_attention ?? []} />
              </Panel>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5 }}>
                <Panel title="Recommended actions">
                  <RecommendationCards items={summary.content.recommended_actions ?? []} accent />
                </Panel>
                <Panel title="Executive recommendations">
                  <RecommendationCards items={summary.content.executive_recommendations ?? []} accent />
                </Panel>
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5 }}>
                <Panel title="Critical issues">
                  <RecommendationCards items={summary.content.critical_issues ?? []} />
                </Panel>
                <Panel title="Key achievements">
                  <RecommendationCards items={summary.content.key_achievements ?? []} />
                </Panel>
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5 }}>
                <Panel title="Upcoming deadlines">
                  <RecommendationCards items={summary.content.upcoming_deadlines ?? []} />
                </Panel>
                <Panel title="Strategic insights">
                  <RecommendationCards items={summary.content.strategic_insights ?? []} />
                </Panel>
              </Box>
            </Stack>

            {/* right rail */}
            <Stack spacing={2.5} sx={{ position: { lg: "sticky" }, top: 12 }}>
              <Panel title="Health trend">
                <TrendChart history={history} />
              </Panel>

              <Panel title="Delivery">
                <MetricRows block={metrics.delivery} />
              </Panel>

              <Panel title="Milestones">
                <MetricRows block={metrics.milestones} />
              </Panel>

              <Panel title="Governance & quality">
                <MetricRows block={{ ...metrics.governance, ...metrics.quality }} />
              </Panel>

              {metrics.commercial?.available && (
                <Panel title="Commercial">
                  <MetricRows block={metrics.commercial} skip={["available", "currency"]} />
                </Panel>
              )}
            </Stack>
          </Box>

          <Typography sx={{ fontSize: 11, color: tokens.text3, textAlign: "center", pb: 1 }}>
            Figures computed from your ERP records; narrative generated by AI. Review before acting on it.
          </Typography>
        </Stack>
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast("")} message={toast} />
    </Box>
  );
}

/** Label/value rows for a metrics block. */
function MetricRows({ block, skip = [] }: { block: Record<string, number | boolean | string>; skip?: string[] }) {
  const entries = Object.entries(block ?? {}).filter(([key]) => !skip.includes(key));
  if (!entries.length) return <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No data.</Typography>;

  return (
    <Stack spacing={0}>
      {entries.map(([key, value], index) => (
        <Stack
          key={key} direction="row" alignItems="center" spacing={1}
          sx={{ py: 0.6, borderTop: index === 0 ? "none" : `1px solid ${tokens.line}` }}
        >
          <Typography sx={{ fontSize: 12.5, color: tokens.text2, flex: 1 }}>{titleCase(key)}</Typography>
          <Typography sx={{ fontSize: 12.5, fontFamily: monoFont, color: tokens.text, fontVariantNumeric: "tabular-nums" }}>
            {typeof value === "number" ? value.toLocaleString() : String(value)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
