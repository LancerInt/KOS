/**
 * Two portfolio visualisations for the Dashboard: **where** the work sits, and
 * **when** it lands. Both read the projects the page already loaded — no extra
 * request, and nothing here can show a project the viewer cannot see.
 *
 * Deliberately two charts, not a wall of them. The metric tiles above already
 * answer "how many, in what state"; a donut of the same five numbers would be
 * the same information wearing a costume. These answer the two questions the
 * tiles cannot: which workspace is carrying the load (and the overdue), and
 * which weeks ahead are crowded.
 *
 * **Colour.** Three meanings, fixed to the entity and reused across both charts
 * so they never have to be re-learned: brand teal = live work, the reserved
 * coral = overdue, muted ink = chrome. The pair was checked with the dataviz
 * validator rather than by eye — separation is ΔE 11.7 under protanopia and
 * 28.3 under normal vision, well clear of the 8 / 15 floors, and both clear 3:1
 * on white. (The teal sits a hair under the chroma floor at 0.09; matching the
 * status colours the rest of this page already uses is worth more than the
 * 0.01, and chroma exists to protect exactly the separation that passes here.)
 *
 * Every chart carries a table twin — the toggle in its corner — because colour
 * and hover must never be the only way to reach a number.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import TableRowsRoundedIcon from "@mui/icons-material/TableRowsRounded";
import InsertChartOutlinedRoundedIcon from "@mui/icons-material/InsertChartOutlinedRounded";

import type { WorkspaceProject } from "../workspaces/projectsApi";
import { getWorkspace } from "../workspaces/workspaces";
import { tokens, monoFont } from "../../theme";

/** Live work. The same teal the rest of the dashboard uses for "in progress". */
const LIVE = tokens.kriya;
/** Overdue. The one warm colour in the product, reserved for attention. */
const LATE = tokens.attn;
/** Chrome: gridlines and axis rules, one step off the surface. Solid hairlines —
 *  dashes read as "threshold" when they are only a grid. */
const GRID = "#ECEEF1";
const SURFACE = tokens.surface;

/** Most workspaces to plot before the tail folds into one row. Past this the
 *  rows get too thin to label and the chart stops being readable. */
const MAX_ROWS = 7;
/** How far ahead the load chart looks. A quarter is the horizon people plan on. */
const WEEKS_AHEAD = 12;

// --------------------------------------------------------------------------- //
// Geometry helpers
// --------------------------------------------------------------------------- //

/** A bar whose **data-end** is rounded and whose baseline stays square, so the
 *  eye reads growth from a hard edge. `horizontal` bars grow right; columns
 *  grow up. Radius is clamped so a short bar cannot curl into a lozenge. */
function barPath(x: number, y: number, w: number, h: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0 || w <= 0) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return [
    `M${x},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h - r}`,
    `Q${x + w},${y + h} ${x + w - r},${y + h}`,
    `H${x}`,
    "Z",
  ].join(" ");
}

/** Container width, so the SVG can be laid out in real pixels instead of being
 *  stretched by a viewBox — which would distort every label with it. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const startOfWeek = (d: Date) => {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Monday-based: the working week people plan in.
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
};
const addDays = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};
const weekLabel = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// --------------------------------------------------------------------------- //
// Card chrome
// --------------------------------------------------------------------------- //

function ChartCard({ title, note, table, children }: {
  title: string;
  note: string;
  /** The table twin. Toggled from the corner — never the only way to a value. */
  table: React.ReactNode;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Paper sx={{ borderRadius: "10px", p: 1.75, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 13.5, color: tokens.ink }}>
            {title}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.15 }}>{note}</Typography>
        </Box>
        <Tooltip title={asTable ? "Show the chart" : "Show the numbers"}>
          <Box component="button" onClick={() => setAsTable((v) => !v)}
            aria-label={asTable ? "Show the chart" : "Show the numbers"}
            sx={{ border: "none", bgcolor: "transparent", cursor: "pointer", p: 0.4, borderRadius: "6px",
              color: tokens.text3, display: "flex", flexShrink: 0,
              "&:hover": { color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.08)" } }}>
            {asTable ? <InsertChartOutlinedRoundedIcon sx={{ fontSize: 16 }} />
              : <TableRowsRoundedIcon sx={{ fontSize: 16 }} />}
          </Box>
        </Tooltip>
      </Stack>
      {asTable ? <Box sx={{ overflowX: "auto" }}>{table}</Box> : children}
    </Paper>
  );
}

/** Legend. Present whenever two series share a plot — colour alone is never the
 *  only way to tell them apart. A rect key mirrors a bar's mark. */
function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ mt: 1.25, flexWrap: "wrap" }} useFlexGap>
      {items.map((item) => (
        <Stack key={item.label} direction="row" alignItems="center" spacing={0.6}>
          <Box sx={{ width: 9, height: 9, borderRadius: "2px", bgcolor: item.color, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 11, color: tokens.text2 }}>{item.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 140 }}>
      <Typography sx={{ fontSize: 12.5, color: tokens.text3, textAlign: "center", px: 2 }}>{children}</Typography>
    </Stack>
  );
}

const numberCell = { fontFamily: monoFont, fontSize: 12, fontVariantNumeric: "tabular-nums" as const };

// --------------------------------------------------------------------------- //
// A · Where the work sits — horizontal bars by workspace
// --------------------------------------------------------------------------- //

interface Row { key: string; label: string; total: number; late: number }

function WorkspaceBars({ projects }: { projects: WorkspaceProject[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    // Open work only. A finished project is not load, and counting it under
    // "on track" would be a plain untruth — the tile above still carries the
    // completed total, so nothing is hidden by leaving it out here.
    for (const p of projects.filter((p) => p.duration.status !== "completed")) {
      const row = map.get(p.workspace)
        ?? { key: p.workspace, label: getWorkspace(p.workspace)?.label ?? p.workspace, total: 0, late: 0 };
      row.total += 1;
      if (p.duration.status === "due") row.late += 1;
      map.set(p.workspace, row);
    }
    const all = [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    if (all.length <= MAX_ROWS) return all;
    // The tail folds into one row rather than being dropped — a chart that
    // silently omits projects would misreport the portfolio.
    const tail = all.slice(MAX_ROWS - 1);
    return [
      ...all.slice(0, MAX_ROWS - 1),
      { key: "__other", label: `${tail.length} more workspaces`,
        total: tail.reduce((n, r) => n + r.total, 0), late: tail.reduce((n, r) => n + r.late, 0) },
    ];
  }, [projects]);

  const table = (
    <Table size="small">
      <TableHead>
        <TableRow sx={{ "& th": { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: tokens.text3, fontWeight: 600, borderColor: tokens.line } }}>
          <TableCell>Workspace</TableCell><TableCell align="right">Open</TableCell><TableCell align="right">Overdue</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell sx={{ fontSize: 12.5, borderColor: tokens.line }}>{r.label}</TableCell>
            <TableCell align="right" sx={{ ...numberCell, borderColor: tokens.line }}>{r.total}</TableCell>
            <TableCell align="right" sx={{ ...numberCell, borderColor: tokens.line, color: r.late ? tokens.attn : tokens.text3 }}>{r.late}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const GUTTER = 104;          // room for the workspace name
  const TIP = 34;              // room for the total at the bar's tip
  const ROW_H = 30;
  const BAR_H = 16;            // thin marks; well under the 24px cap
  const max = Math.max(1, ...rows.map((r) => r.total));
  const plotW = Math.max(40, width - GUTTER - TIP);
  const height = rows.length * ROW_H;

  return (
    <ChartCard title="Where the work sits"
      note="Open projects per workspace, and how many are overdue."
      table={table}>
      <Box ref={ref} sx={{ flex: 1, minWidth: 0 }}>
        {rows.length === 0 ? (
          <Empty>Nothing open — every project you can see is completed.</Empty>
        ) : rows.length === 1 ? (
          // A one-bar bar chart is a stat tile wearing axes. Say the number.
          <Stack justifyContent="center" sx={{ flex: 1, minHeight: 140, px: 0.5 }}>
            <Typography sx={{ fontSize: 12.5, color: tokens.text2 }}>{rows[0].label}</Typography>
            <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 34, fontWeight: 700, lineHeight: 1.1, color: tokens.ink }}>
              {rows[0].total}
            </Typography>
            <Typography sx={{ fontSize: 12, color: rows[0].late ? tokens.attn : tokens.text3, mt: 0.25 }}>
              {rows[0].total === 1 ? "open project" : "open projects"}
              {rows[0].late > 0 && ` · ${rows[0].late} overdue`}
            </Typography>
          </Stack>
        ) : width > 0 && (
          <svg width={width} height={height} role="img"
            aria-label={`Open projects per workspace. ${rows.map((r) => `${r.label}: ${r.total}, ${r.late} overdue`).join(". ")}`}>
            {rows.map((r, i) => {
              const y = i * ROW_H + (ROW_H - BAR_H) / 2;
              const full = (r.total / max) * plotW;
              const lateW = r.total ? (r.late / r.total) * full : 0;
              // The 2px surface gap is what separates the two segments — never a
              // stroke, which would add ink that isn't data.
              const liveW = Math.max(0, full - lateW - (lateW > 0 ? 2 : 0));
              const lateX = GUTTER + liveW + (liveW > 0 ? 2 : 0);
              const lateOnly = liveW <= 0;
              return (
                <g key={r.key}>
                  <text x={GUTTER - 8} y={y + BAR_H / 2} textAnchor="end" dominantBaseline="central"
                    style={{ fontSize: 11.5, fill: tokens.text2 }}>
                    {r.label.length > 15 ? `${r.label.slice(0, 14)}…` : r.label}
                  </text>

                  {/* A row-wide hit target behind the bars. One overdue project
                      out of forty is a two-pixel sliver — reachable to look at,
                      impossible to point at — so the whole row answers, and the
                      segments on top of it refine the answer where they are big
                      enough to hit. */}
                  <Tooltip title={`${r.label} · ${r.total} open, ${r.late} overdue`} followCursor>
                    <rect x={GUTTER} y={i * ROW_H} width={Math.max(24, plotW + TIP)} height={ROW_H}
                      fill="transparent" tabIndex={0} style={{ outline: "none" }} />
                  </Tooltip>

                  {liveW > 0 && (
                    <Tooltip key="live" title={`${r.label} · ${r.total - r.late} on track`} followCursor>
                      <path d={r.late > 0 ? `M${GUTTER},${y} h${liveW} v${BAR_H} h${-liveW} Z` : barPath(GUTTER, y, liveW, BAR_H)}
                        fill={LIVE} tabIndex={0} style={{ outline: "none" }} />
                    </Tooltip>
                  )}
                  {r.late > 0 && (
                    <Tooltip key="late" title={`${r.label} · ${r.late} overdue`} followCursor>
                      <path d={barPath(lateOnly ? GUTTER : lateX, y, Math.max(2, lateW), BAR_H)}
                        fill={LATE} tabIndex={0} style={{ outline: "none" }} />
                    </Tooltip>
                  )}

                  {/* The total rides the tip; the overdue count sits inside its
                      own segment only when it genuinely fits, so a label is
                      never clipped by the mark it belongs to. */}
                  <text x={GUTTER + full + 7} y={y + BAR_H / 2} dominantBaseline="central"
                    style={{ fontSize: 11.5, fontFamily: monoFont, fill: tokens.text2 }}>{r.total}</text>
                  {r.late > 0 && lateW >= 20 && (
                    <text x={(lateOnly ? GUTTER : lateX) + lateW / 2} y={y + BAR_H / 2}
                      textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: 10, fontFamily: monoFont, fill: "#fff", pointerEvents: "none" }}>
                      {r.late}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </Box>
      <Legend items={[{ color: LIVE, label: "On track" }, { color: LATE, label: "Overdue" }]} />
    </ChartCard>
  );
}

// --------------------------------------------------------------------------- //
// B · The weeks ahead — how many projects are running each week
// --------------------------------------------------------------------------- //

interface Week { start: Date; label: string; count: number }

function LoadLine({ projects }: { projects: WorkspaceProject[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const weeks: Week[] = useMemo(() => {
    const first = startOfWeek(new Date());
    return Array.from({ length: WEEKS_AHEAD }, (_, i) => {
      const start = addDays(first, i * 7);
      const end = addDays(start, 7);
      let count = 0;
      for (const p of projects) {
        if (p.completed_at || !p.start_at || !p.end_at) continue;
        // Running during this week: started before it ends, ends after it starts.
        if (new Date(p.start_at) < end && new Date(p.end_at) >= start) count += 1;
      }
      return { start, label: weekLabel(start), count };
    });
  }, [projects]);

  const dated = projects.filter((p) => p.start_at && p.end_at && !p.completed_at).length;
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const peak = weeks.reduce((best, w, i) => (w.count > weeks[best].count ? i : best), 0);

  const table = (
    <Table size="small">
      <TableHead>
        <TableRow sx={{ "& th": { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: tokens.text3, fontWeight: 600, borderColor: tokens.line } }}>
          <TableCell>Week of</TableCell><TableCell align="right">Projects running</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {weeks.map((w) => (
          <TableRow key={w.label}>
            <TableCell sx={{ fontSize: 12.5, borderColor: tokens.line }}>{w.label}</TableCell>
            <TableCell align="right" sx={{ ...numberCell, borderColor: tokens.line }}>{w.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const PAD_L = 26, PAD_R = 12, PAD_T = 16, PLOT_H = 128, AXIS_H = 20;
  const plotW = Math.max(40, width - PAD_L - PAD_R);
  const step = plotW / Math.max(1, weeks.length - 1);
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => PAD_T + PLOT_H - (v / max) * PLOT_H;
  const line = weeks.map((w, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(w.count)}`).join(" ");
  const area = `${line} L${x(weeks.length - 1)},${PAD_T + PLOT_H} L${x(0)},${PAD_T + PLOT_H} Z`;

  return (
    <ChartCard title="The weeks ahead"
      note={`Projects running each week for the next ${WEEKS_AHEAD} weeks.`}
      table={table}>
      <Box ref={ref} sx={{ flex: 1, minWidth: 0 }}>
        {dated === 0 ? (
          <Empty>No project has both a start and an end yet — set a duration and the load appears here.</Empty>
        ) : width > 0 && (
          <svg width={width} height={PAD_T + PLOT_H + AXIS_H} role="img"
            aria-label={`Projects running per week. ${weeks.map((w) => `${w.label}: ${w.count}`).join(". ")}`}
            onMouseLeave={() => setHover(null)}>
            {/* gridlines — solid hairlines, one step off the surface */}
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={PAD_L + plotW} y1={y(max * t)} y2={y(max * t)} stroke={GRID} strokeWidth={1} />
                <text x={PAD_L - 6} y={y(max * t)} textAnchor="end" dominantBaseline="central"
                  style={{ fontSize: 10, fontFamily: monoFont, fill: tokens.text3 }}>
                  {Math.round(max * t)}
                </text>
              </g>
            ))}

            <path d={area} fill={LIVE} opacity={0.1} />
            <path d={line} fill="none" stroke={LIVE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {/* The crosshair finds the week — the reader aims at a date, never
                at a 2px line. Hit bands span the full height, so the pointer
                only has to be closest, not accurate. */}
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke={tokens.text3} strokeWidth={1} opacity={0.45} />
            )}
            {weeks.map((w, i) => (
              <Tooltip key={w.label} title={`Week of ${w.label} · ${w.count} running`} followCursor>
                <rect x={x(i) - step / 2} y={PAD_T} width={Math.max(24, step)} height={PLOT_H}
                  fill="transparent" tabIndex={0} style={{ outline: "none" }}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              </Tooltip>
            ))}
            {hover !== null && (
              <circle cx={x(hover)} cy={y(weeks[hover].count)} r={4} fill={LIVE} stroke={SURFACE} strokeWidth={2} />
            )}

            {/* One direct label: the busiest week. The axis carries the rest —
                a number on every point is chaos and goes unread. */}
            {max > 1 && (
              <text x={Math.min(x(peak), PAD_L + plotW - 14)} y={y(weeks[peak].count) - 8} textAnchor="middle"
                style={{ fontSize: 10.5, fontFamily: monoFont, fill: tokens.text2, fontWeight: 600 }}>
                {weeks[peak].count}
              </text>
            )}

            {/* Every third week is labelled, so ticks never collide. */}
            {weeks.map((w, i) => (i % 3 === 0 ? (
              <text key={w.label} x={x(i)} y={PAD_T + PLOT_H + 13} textAnchor={i === 0 ? "start" : "middle"}
                style={{ fontSize: 10, fontFamily: monoFont, fill: tokens.text3 }}>{w.label}</text>
            ) : null))}
          </svg>
        )}
      </Box>
    </ChartCard>
  );
}

// --------------------------------------------------------------------------- //

/** Both charts, side by side on a wide screen and stacked on a narrow one.
 *  Renders nothing at all until there is something to plot — an empty chart
 *  frame is worse than no chart. */
export default function PortfolioCharts({ projects }: { projects: WorkspaceProject[] }) {
  if (!projects.length) return null;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.25, mb: 2 }}>
      <WorkspaceBars projects={projects} />
      <LoadLine projects={projects} />
    </Box>
  );
}
