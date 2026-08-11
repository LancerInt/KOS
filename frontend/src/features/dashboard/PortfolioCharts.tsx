/**
 * The portfolio visualisation for the Dashboard: **where** the work sits. Reads
 * the projects the page already loaded — no extra request, and nothing here can
 * show a project the viewer cannot see.
 *
 * One chart, not a wall of them. The metric tiles above already answer "how
 * many, in what state"; this answers the question they cannot — which workspace
 * is carrying the load, and the overdue.
 *
 * **Form: a unit chart, one square per project.** Not a bar. At this
 * portfolio's size — dozens of projects, not thousands — a square per project
 * is more informative than an abstraction of them: three overdue reads as three
 * things you could name, and every square is its own hover target carrying the
 * project's name and how long it has left. Squares are ordered most-urgent
 * first, so the left edge of every row lines up as a comparable overdue block.
 *
 * Past ``MATRIX_CAP`` open projects the squares stop being individually
 * hittable and the card falls back to the stacked bars below — switching form
 * rather than quietly redefining a square as "5 projects", which is how unit
 * charts usually start lying.
 *
 * **Colour.** Two meanings, fixed to the entity: brand teal = live work, the
 * reserved coral = overdue. The pair was checked with the dataviz validator
 * rather than by eye — separation is ΔE 11.7 under protanopia and 28.3 under
 * normal vision, well clear of the 8 / 15 floors, and both clear 3:1 on white.
 * (The teal sits a hair under the chroma floor at 0.09; matching the status
 * colours the rest of this page already uses is worth more than the 0.01, and
 * chroma exists to protect exactly the separation that passes here.)
 *
 * Deliberately still two colours, though the data carries a third state
 * (``ending_soon``). Every amber dark enough to clear 3:1 on white collapses
 * into the coral for a red-green reader — ΔE 1.4 under deuteranopia, and 11.5
 * even under normal vision. If that state is wanted it has to arrive as a
 * hollow square (hue × fill), never as a third hue.
 *
 * The chart carries a table twin — the toggle in its corner — because colour
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

/** Most workspaces to plot before the tail folds into one row. Past this the
 *  rows get too thin to label and the chart stops being readable. */
const MAX_ROWS = 7;

/** Above this many open projects a square per project stops being a hittable
 *  target, and the card switches to the stacked bars instead. */
const MATRIX_CAP = 150;

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

/** One project, as it appears in the matrix. */
interface Cell { id: number; name: string; ws: string; late: boolean; note: string }
interface Row { key: string; label: string; total: number; late: number; cells: Cell[] }

/** Group open projects by workspace, urgent first, folding the tail.
 *  Shared by the matrix, the bars and the table so all three agree. */
function useRows(projects: WorkspaceProject[]): Row[] {
  return useMemo(() => {
    const map = new Map<string, Row>();
    // Open work only. A finished project is not load, and counting it under
    // "on track" would be a plain untruth — the tile above still carries the
    // completed total, so nothing is hidden by leaving it out here.
    for (const p of projects.filter((p) => p.duration.status !== "completed")) {
      const label = getWorkspace(p.workspace)?.label ?? p.workspace;
      const row = map.get(p.workspace)
        ?? { key: p.workspace, label, total: 0, late: 0, cells: [] };
      const late = p.duration.status === "due";
      row.total += 1;
      if (late) row.late += 1;
      row.cells.push({
        id: p.id,
        name: p.name,
        ws: label,
        late,
        note: late ? "overdue" : p.duration.left_label ?? "no duration set",
      });
      map.set(p.workspace, row);
    }

    // Within a row: overdue first, then whatever runs out soonest. The eye
    // reads left to right, so the left edge is the part that needs attention —
    // and because every row is sorted the same way, the coral blocks line up
    // into a column you can compare down.
    const daysLeft = new Map(projects.map((p) => [p.id, p.duration.days_left ?? Number.POSITIVE_INFINITY]));
    for (const row of map.values()) {
      row.cells.sort((a, b) =>
        Number(b.late) - Number(a.late)
        || (daysLeft.get(a.id) ?? Infinity) - (daysLeft.get(b.id) ?? Infinity)
        || a.name.localeCompare(b.name));
    }

    const all = [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    if (all.length <= MAX_ROWS) return all;
    // The tail folds into one row rather than being dropped — a chart that
    // silently omits projects would misreport the portfolio.
    const tail = all.slice(MAX_ROWS - 1);
    return [
      ...all.slice(0, MAX_ROWS - 1),
      { key: "__other", label: `${tail.length} more workspaces`,
        total: tail.reduce((n, r) => n + r.total, 0),
        late: tail.reduce((n, r) => n + r.late, 0),
        cells: tail.flatMap((r) => r.cells) },
    ];
  }, [projects]);
}

/** The table twin — the WCAG-clean equivalent every chart here carries. */
function RowTable({ rows }: { rows: Row[] }) {
  return (
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
}

/** The headline when the viewer can only see one workspace — a single row of
 *  anything is a stat tile wearing chrome. Say the number. */
function SoleWorkspace({ row }: { row: Row }) {
  return (
    <Stack justifyContent="center" sx={{ flex: 1, minHeight: 140, px: 0.5 }}>
      <Typography sx={{ fontSize: 12.5, color: tokens.text2 }}>{row.label}</Typography>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 34, fontWeight: 700, lineHeight: 1.1, color: tokens.ink }}>
        {row.total}
      </Typography>
      <Typography sx={{ fontSize: 12, color: row.late ? tokens.attn : tokens.text3, mt: 0.25 }}>
        {row.total === 1 ? "open project" : "open projects"}
        {row.late > 0 && ` · ${row.late} overdue`}
      </Typography>
    </Stack>
  );
}

// --------------------------------------------------------------------------- //
// A · Where the work sits — one square per project
// --------------------------------------------------------------------------- //

const GUTTER = 116;   // room for the workspace name
const TIP = 44;       // room for the row total, kept clear of the squares

function WorkspaceMatrix({ rows, width }: { rows: Row[]; width: number }) {
  const CELL = 15;                    // small mark; the fill is the whole datum
  const GAP = 6;
  const STEP = CELL + GAP;
  const LINE_H = 23;                  // with STEP this makes a 21×23 hit target
  const GROUP_GAP = 9;

  const plotW = Math.max(STEP, width - GUTTER - TIP);
  const perLine = Math.max(1, Math.floor(plotW / STEP));

  // Lay the groups out first so the SVG knows its own height — a wrapped row
  // is taller than a bar, and a fixed height would clip the tail.
  let cursor = 0;
  const laid = rows.map((r) => {
    const lines = Math.max(1, Math.ceil(r.total / perLine));
    const top = cursor;
    cursor += lines * LINE_H + GROUP_GAP;
    return { row: r, top, lines };
  });
  const height = Math.max(0, cursor - GROUP_GAP);

  return (
    <svg width={width} height={height} role="img"
      aria-label={`Open projects per workspace, one square per project. ${rows.map((r) => `${r.label}: ${r.total} open, ${r.late} overdue`).join(". ")}`}>
      {laid.map(({ row, top }) => {
        const firstLineMid = top + LINE_H / 2;
        // In the folded row the label reads "4 more workspaces", so a square
        // there has to name its own workspace or the tooltip is orphaned.
        const folded = row.key === "__other";
        return (
          <g key={row.key}>
            <text x={GUTTER - 10} y={firstLineMid} textAnchor="end" dominantBaseline="central"
              style={{ fontSize: 11.5, fill: tokens.text2 }}>
              {row.label.length > 17 ? `${row.label.slice(0, 16)}…` : row.label}
            </text>

            {row.cells.map((cell, k) => {
              const col = k % perLine;
              const line = Math.floor(k / perLine);
              const x = GUTTER + col * STEP;
              const y = top + line * LINE_H + (LINE_H - CELL) / 2;
              return (
                // Every square is its own target and carries its own project.
                // The transparent rect underneath claims the gap either side so
                // the pointer isn't asked to land on a 15px mark.
                <Tooltip key={cell.id} followCursor
                  title={folded ? `${cell.ws} · ${cell.name} · ${cell.note}` : `${cell.name} · ${cell.note}`}>
                  <g tabIndex={0} style={{ outline: "none" }}>
                    <rect x={x - GAP / 2} y={top + line * LINE_H} width={STEP} height={LINE_H} fill="transparent" />
                    <rect x={x} y={y} width={CELL} height={CELL} rx={3.5}
                      fill={cell.late ? LATE : LIVE} />
                  </g>
                </Tooltip>
              );
            })}

            {/* The row total sits past the widest a line can reach, so it can
                never collide with a square however the row wraps. */}
            <text x={GUTTER + plotW + 8} y={firstLineMid} dominantBaseline="central"
              style={{ fontSize: 11.5, fontFamily: monoFont, fill: tokens.text2 }}>{row.total}</text>
          </g>
        );
      })}
    </svg>
  );
}

// --------------------------------------------------------------------------- //
// A′ · The dense fallback — stacked bars, once squares stop being hittable
// --------------------------------------------------------------------------- //

function WorkspaceBars({ rows, width }: { rows: Row[]; width: number }) {
  const ROW_H = 30;
  const BAR_H = 16;            // thin marks; well under the 24px cap
  const max = Math.max(1, ...rows.map((r) => r.total));
  const plotW = Math.max(40, width - GUTTER - TIP);
  const height = rows.length * ROW_H;

  return (
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
              {r.label.length > 17 ? `${r.label.slice(0, 16)}…` : r.label}
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
  );
}

// --------------------------------------------------------------------------- //

function WorkspaceLoad({ projects }: { projects: WorkspaceProject[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = useRows(projects);
  const open = rows.reduce((n, r) => n + r.total, 0);
  const dense = open > MATRIX_CAP;

  return (
    <ChartCard
      title="Where the work sits"
      note={dense
        ? "Open projects per workspace, and how many are overdue."
        : "One square per open project, most urgent first. Hover a square for the project."}
      table={<RowTable rows={rows} />}>
      <Box ref={ref} sx={{ flex: 1, minWidth: 0 }}>
        {rows.length === 0 ? (
          <Empty>Nothing open — every project you can see is completed.</Empty>
        ) : rows.length === 1 && rows[0].total > MATRIX_CAP ? (
          <SoleWorkspace row={rows[0]} />
        ) : width > 0 && (
          dense ? <WorkspaceBars rows={rows} width={width} />
                : <WorkspaceMatrix rows={rows} width={width} />
        )}
      </Box>
      <Legend items={[{ color: LIVE, label: "On track" }, { color: LATE, label: "Overdue" }]} />
    </ChartCard>
  );
}

/** Renders nothing at all until there is something to plot — an empty chart
 *  frame is worse than no chart. */
export default function PortfolioCharts({ projects }: { projects: WorkspaceProject[] }) {
  if (!projects.length) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <WorkspaceLoad projects={projects} />
    </Box>
  );
}
