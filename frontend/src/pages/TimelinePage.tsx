import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, CircularProgress, MenuItem, Select, Stack, Typography } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";

import {
  getProjectTimeline, getRoadmap, type ProjectTimeline, type RoadmapProject,
} from "../features/projects/timelineApi";
import { tokens, categoryColors, monoFont } from "../theme";

const DAY = 86400000;
const dnum = (s: string): number => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY);
const todayNum = (): number => Math.floor(Date.now() / DAY);

const LABEL_W = 240;
const HEADER_H = 34;
const ROW_H = 30;

const CAT_COLOR: Record<string, string> = {
  not_started: categoryColors.notStarted,
  active: categoryColors.active,
  waiting: categoryColors.waiting,
  in_review: categoryColors.inReview,
  done: categoryColors.done,
  cancelled: categoryColors.cancelled,
};
const HEALTH_COLOR: Record<string, string> = {
  on_track: tokens.kriya,
  at_risk: categoryColors.waiting,
  off_track: tokens.attn,
};

interface Bar {
  id: number;
  label: string;
  sub?: string;
  start: number;   // day number
  end: number;     // day number (>= start)
  color: string;
  milestone?: boolean;
  onClick?: () => void;
}

/** Month gridline positions across the domain. */
function monthTicks(minD: number, maxD: number): { dn: number; label: string }[] {
  const ticks: { dn: number; label: string }[] = [];
  const first = new Date(minD * DAY);
  let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  for (let guard = 0; guard < 120; guard += 1) {
    const dn = Math.round(d.getTime() / DAY);
    if (dn > maxD) break;
    if (dn >= minD) ticks.push({ dn, label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) });
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return ticks;
}

function Gantt({ bars, deps }: { bars: Bar[]; deps: { from: number; to: number }[] }) {
  const [pxPerDay, setPxPerDay] = useState(22);
  if (bars.length === 0) {
    return <Typography sx={{ fontSize: 13.5, color: tokens.text3, py: 4, textAlign: "center" }}>Nothing with dates to show here yet.</Typography>;
  }

  const minD = Math.min(...bars.map((b) => b.start)) - 3;
  const maxD = Math.max(...bars.map((b) => b.end)) + 7;
  const trackW = Math.max(480, (maxD - minD) * pxPerDay);
  const x = (d: number) => (d - minD) * pxPerDay;
  const ticks = monthTicks(minD, maxD);
  const today = todayNum();
  const rowIndex = new Map(bars.map((b, i) => [b.id, i]));
  const bodyH = bars.length * ROW_H;

  return (
    <Box>
      <Stack direction="row" spacing={0.5} justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button size="small" variant="outlined" onClick={() => setPxPerDay((p) => Math.max(6, p - 6))} sx={{ minWidth: 34, px: 0 }}><RemoveRoundedIcon sx={{ fontSize: 16 }} /></Button>
        <Button size="small" variant="outlined" onClick={() => setPxPerDay((p) => Math.min(64, p + 6))} sx={{ minWidth: 34, px: 0 }}><AddRoundedIcon sx={{ fontSize: 16 }} /></Button>
      </Stack>
      <Box sx={{ display: "flex", border: `1px solid ${tokens.line}`, borderRadius: "10px", overflow: "hidden", bgcolor: tokens.surface }}>
        {/* label column */}
        <Box sx={{ width: LABEL_W, flexShrink: 0, borderRight: `1px solid ${tokens.line}` }}>
          <Box sx={{ height: HEADER_H, borderBottom: `1px solid ${tokens.line}`, bgcolor: tokens.paper }} />
          {bars.map((b) => (
            <Box key={b.id} onClick={b.onClick}
              sx={{ height: ROW_H, px: 1.5, display: "flex", flexDirection: "column", justifyContent: "center",
                borderBottom: `1px solid ${tokens.line}`, cursor: b.onClick ? "pointer" : "default",
                "&:hover": b.onClick ? { bgcolor: tokens.paper } : undefined }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.2 }} noWrap>{b.label}</Typography>
              {b.sub && <Typography sx={{ fontSize: 10.5, color: tokens.text3, lineHeight: 1.2 }} noWrap>{b.sub}</Typography>}
            </Box>
          ))}
        </Box>

        {/* scrollable track */}
        <Box sx={{ flex: 1, overflowX: "auto" }}>
          <Box sx={{ position: "relative", width: trackW, height: HEADER_H + bodyH }}>
            {/* month header + gridlines */}
            {ticks.map((t) => (
              <Box key={t.dn}>
                <Box sx={{ position: "absolute", left: x(t.dn), top: 0, height: HEADER_H + bodyH, borderLeft: `1px solid ${tokens.line}` }} />
                <Typography sx={{ position: "absolute", left: x(t.dn) + 4, top: 8, fontSize: 11, fontFamily: monoFont, color: tokens.text3 }}>{t.label}</Typography>
              </Box>
            ))}
            {/* today marker */}
            {today >= minD && today <= maxD && (
              <Box sx={{ position: "absolute", left: x(today), top: 0, height: HEADER_H + bodyH, borderLeft: `2px solid ${tokens.attn}`, opacity: 0.7 }} />
            )}

            {/* dependency connectors */}
            {deps.length > 0 && (
              <svg width={trackW} height={HEADER_H + bodyH} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
                <defs>
                  <marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill={tokens.text3} />
                  </marker>
                </defs>
                {deps.map((d, i) => {
                  const pi = rowIndex.get(d.from); const si = rowIndex.get(d.to);
                  if (pi === undefined || si === undefined) return null;
                  const pb = bars[pi]; const sb = bars[si];
                  const x1 = x(pb.end); const y1 = HEADER_H + pi * ROW_H + ROW_H / 2;
                  const x2 = x(sb.start); const y2 = HEADER_H + si * ROW_H + ROW_H / 2;
                  const mx = Math.max(x1 + 8, x2 - 8);
                  return (
                    <path key={i} d={`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`} fill="none"
                      stroke={tokens.text3} strokeWidth={1.2} markerEnd="url(#arrow)" opacity={0.65} />
                  );
                })}
              </svg>
            )}

            {/* bars */}
            {bars.map((b, i) => {
              const top = HEADER_H + i * ROW_H;
              if (b.milestone) {
                const cx = x(b.start); const cy = top + ROW_H / 2;
                return (
                  <Box key={b.id} title={b.label}
                    sx={{ position: "absolute", left: cx - 7, top: cy - 7, width: 14, height: 14, bgcolor: b.color,
                      transform: "rotate(45deg)", borderRadius: "2px", border: "2px solid #fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
                );
              }
              const left = x(b.start);
              const width = Math.max(8, x(b.end) - x(b.start));
              return (
                <Box key={b.id} onClick={b.onClick} title={b.label}
                  sx={{ position: "absolute", left, top: top + 6, width, height: ROW_H - 12, bgcolor: b.color,
                    borderRadius: "5px", cursor: b.onClick ? "pointer" : "default", opacity: 0.92,
                    "&:hover": { opacity: 1 } }} />
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function TimelinePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<RoadmapProject[]>([]);
  const [selected, setSelected] = useState<number | "roadmap">("roadmap");
  const [roadmapReady, setRoadmapReady] = useState(false);
  const [detail, setDetail] = useState<ProjectTimeline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRoadmap().then((r) => setProjects(r.projects)).catch(() => setProjects([])).finally(() => setRoadmapReady(true));
  }, []);

  useEffect(() => {
    if (selected === "roadmap") { setDetail(null); setLoading(false); return; }
    setLoading(true);
    getProjectTimeline(selected).then(setDetail).catch(() => setDetail(null)).finally(() => setLoading(false));
  }, [selected]);

  const roadmapBars: Bar[] = useMemo(() => projects
    .filter((p) => p.start_date || p.end_date)
    .map((p) => {
      const s = dnum((p.start_date || p.end_date) as string);
      const e = Math.max(s, dnum((p.end_date || p.start_date) as string));
      return { id: p.id, label: p.name, sub: p.code, start: s, end: e,
        color: HEALTH_COLOR[p.health] ?? tokens.kriya, onClick: () => setSelected(p.id) };
    }), [projects]);

  const { detailBars, detailDeps } = useMemo(() => {
    if (!detail) return { detailBars: [] as Bar[], detailDeps: [] as { from: number; to: number }[] };
    const taskBars: Bar[] = detail.tasks.map((t) => {
      const s = dnum((t.start_date || t.due_date) as string);
      const e = Math.max(s, dnum((t.due_date || t.start_date) as string));
      return { id: t.id, label: t.title, sub: t.owner ?? undefined, start: s, end: e,
        color: CAT_COLOR[t.category] ?? categoryColors.notStarted };
    });
    const msBars: Bar[] = detail.milestones.map((m) => ({
      id: 1_000_000 + m.id, label: `◆ ${m.title}`, sub: "milestone",
      start: dnum(m.due_date), end: dnum(m.due_date), color: categoryColors.inReview, milestone: true,
    }));
    return {
      detailBars: [...taskBars, ...msBars],
      detailDeps: detail.dependencies.map((d) => ({ from: d.predecessor, to: d.successor })),
    };
  }, [detail]);

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 28 }}>Timeline</Typography>
          <Typography sx={{ mt: 0.4, fontSize: 13.5, color: tokens.text2 }}>
            Roadmap across projects, or a project's tasks, milestones and dependencies.
          </Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Select size="small" value={selected} onChange={(e) => setSelected(e.target.value as number | "roadmap")}
            sx={{ fontSize: 13, minWidth: 240, borderRadius: 2 }}>
            <MenuItem value="roadmap" sx={{ fontSize: 13 }}>Roadmap — all projects</MenuItem>
            {projects.map((p) => <MenuItem key={p.id} value={p.id} sx={{ fontSize: 13 }}>{p.name}</MenuItem>)}
          </Select>
          {selected !== "roadmap" && detail && (
            <Button size="small" variant="outlined" onClick={() => navigate(`/projects/${detail.project.id}`)}>Open project</Button>
          )}
        </Stack>
      </Stack>

      {(loading || !roadmapReady) && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>}

      {!loading && roadmapReady && selected === "roadmap" && (
        <Gantt bars={roadmapBars} deps={[]} />
      )}
      {!loading && selected !== "roadmap" && (
        <Gantt bars={detailBars} deps={detailDeps} />
      )}
    </Box>
  );
}
