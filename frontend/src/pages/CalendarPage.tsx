import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Stack,
  Tooltip, Typography,
} from "@mui/material";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";

import { getCalendar, type CalendarItem } from "../features/calendar/calendarApi";
import { getWorkspace } from "../features/workspaces/workspaces";
import { tokens, monoFont } from "../theme";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Solid accent (bars / dots) and a soft tint (chips) per status.
const SOLID: Record<CalendarItem["status"], string> = {
  active: tokens.kriya, overdue: tokens.attn, blocked: "#C7891B",
  completed: "#2FA36B", pending: "#6C7A89", filed: "#2FA36B",
};
const TINT: Record<CalendarItem["status"], string> = {
  active: tokens.kriyaWash, overdue: tokens.attnWash, blocked: "#FBF2DF",
  completed: "#E7F4EC", pending: "#EEF0F3", filed: "#E7F4EC",
};
const STATUS_LABEL: Record<CalendarItem["status"], string> = {
  active: "On track", overdue: "Overdue", blocked: "Blocked",
  completed: "Completed", pending: "Due", filed: "Filed",
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYMD = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const clamp = (d: Date, lo: Date, hi: Date) => (d < lo ? lo : d > hi ? hi : d);

function ItemIcon({ kind, size = 13 }: { kind: CalendarItem["kind"]; size?: number }) {
  return kind === "filing"
    ? <GavelRoundedIcon sx={{ fontSize: size }} />
    : <Inventory2RoundedIcon sx={{ fontSize: size }} />;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState<"month" | "timeline">("month");
  const [kinds, setKinds] = useState<Set<CalendarItem["kind"]>>(new Set(["project", "filing"]));
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const todayStr = ymd(new Date());
  // Six-week grid, Sunday-first, covering the whole month plus spill days.
  const gridStart = useMemo(() => addDays(startOfMonth(month), -startOfMonth(month).getDay()), [month]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  useEffect(() => {
    setItems(null);
    getCalendar(ymd(gridStart), ymd(addDays(gridStart, 41)))
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [gridStart]);

  const shown = useMemo(() => (items ?? []).filter((it) => kinds.has(it.kind)), [items, kinds]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of shown) (m.get(it.date) ?? m.set(it.date, []).get(it.date)!).push(it);
    return m;
  }, [shown]);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const daysInMonth = monthEnd.getDate();
  const monthLabel = month.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const toggleKind = (k: CalendarItem["kind"]) =>
    setKinds((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      if (next.size === 0) next.add(k);   // never show nothing
      return next;
    });

  // Items overlapping the visible month, oldest first — for the timeline.
  const timelineItems = useMemo(
    () => shown
      .filter((it) => parseYMD(it.end) >= monthStart && parseYMD(it.start) <= monthEnd)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)),
    [shown, monthStart, monthEnd],
  );

  const dayItems = selectedDay ? byDate.get(selectedDay) ?? [] : [];

  const goto = (item: CalendarItem) => { setSelectedDay(null); navigate(item.url); };

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      {/* header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 28 }}>Calendar</Typography>
          <Typography sx={{ mt: 0.3, fontSize: 13.5, color: tokens.text2 }}>
            Project deadlines and statutory filings across your workspaces.
          </Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Seg value={view} onChange={(v) => setView(v as "month" | "timeline")}
            options={[{ key: "month", label: "Month" }, { key: "timeline", label: "Timeline" }]} />
          <Stack direction="row" alignItems="center" spacing={0.5}
            sx={{ border: `1px solid ${tokens.line}`, borderRadius: 2, px: 0.5, py: 0.25, bgcolor: tokens.surface }}>
            <IconButton size="small" onClick={() => setMonth(addDays(monthStart, -1))} aria-label="Previous month">
              <ChevronLeftRoundedIcon fontSize="small" />
            </IconButton>
            <Typography sx={{ minWidth: 128, textAlign: "center", fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 14 }}>
              {monthLabel}
            </Typography>
            <IconButton size="small" onClick={() => setMonth(startOfMonth(addDays(monthEnd, 1)))} aria-label="Next month">
              <ChevronRightRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Button size="small" variant="outlined" onClick={() => setMonth(startOfMonth(new Date()))}
            sx={{ color: tokens.text2, borderColor: tokens.line }}>Today</Button>
        </Stack>
      </Stack>

      {/* filters + legend */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={0.75}>
          {(["project", "filing"] as const).map((k) => (
            <Box key={k} onClick={() => toggleKind(k)}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, cursor: "pointer", userSelect: "none",
                px: 1.1, py: 0.5, borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: `1px solid ${kinds.has(k) ? tokens.kriya : tokens.line}`,
                bgcolor: kinds.has(k) ? tokens.kriyaWash : tokens.surface,
                color: kinds.has(k) ? tokens.kriyaInk : tokens.text3 }}>
              <ItemIcon kind={k} size={14} />{k === "project" ? "Projects" : "Filings"}
            </Box>
          ))}
        </Stack>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {(["overdue", "active", "blocked", "pending", "completed"] as const).map((s) => (
            <Stack key={s} direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 9, height: 9, borderRadius: "3px", bgcolor: SOLID[s] }} />
              <Typography sx={{ fontSize: 11, color: tokens.text3 }}>{STATUS_LABEL[s]}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>

      {items === null ? (
        <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={26} /></Stack>
      ) : view === "month" ? (
        <MonthGrid cells={cells} byDate={byDate} month={month} todayStr={todayStr} onDay={setSelectedDay} />
      ) : (
        <Timeline items={timelineItems} monthStart={monthStart} monthEnd={monthEnd} daysInMonth={daysInMonth}
          todayStr={todayStr} onOpen={goto} />
      )}

      {/* day detail */}
      <Dialog open={selectedDay !== null} onClose={() => setSelectedDay(null)} fullWidth maxWidth="xs"
        PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17, pb: 0.5 }}>
          {selectedDay && parseYMD(selectedDay).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          <IconButton size="small" onClick={() => setSelectedDay(null)} sx={{ position: "absolute", right: 10, top: 12 }}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pb: 2.5 }}>
          {dayItems.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: tokens.text3, py: 1 }}>Nothing scheduled.</Typography>
          ) : (
            <Stack spacing={1}>
              {dayItems.map((it) => (
                <Stack key={`${it.kind}-${it.id}`} direction="row" alignItems="center" spacing={1.25}
                  onClick={() => goto(it)}
                  sx={{ p: 1, borderRadius: "10px", cursor: "pointer", border: `1px solid ${tokens.line}`,
                    borderLeft: `4px solid ${SOLID[it.status]}`, "&:hover": { bgcolor: tokens.paper } }}>
                  <Box sx={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: "8px",
                    bgcolor: TINT[it.status], color: SOLID[it.status], flexShrink: 0 }}>
                    <ItemIcon kind={it.kind} size={16} />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600 }}>{it.title}</Typography>
                    <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>
                      {getWorkspace(it.workspace)?.label ?? it.workspace} · {STATUS_LABEL[it.status]}
                    </Typography>
                  </Box>
                  <LaunchRoundedIcon sx={{ fontSize: 16, color: tokens.text3, flexShrink: 0 }} />
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

function MonthGrid({ cells, byDate, month, todayStr, onDay }: {
  cells: Date[]; byDate: Map<string, CalendarItem[]>; month: Date; todayStr: string;
  onDay: (key: string) => void;
}) {
  return (
    <Box sx={{ border: `1px solid ${tokens.line}`, borderRadius: "12px", overflow: "hidden", bgcolor: tokens.surface }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WEEKDAYS.map((w) => (
          <Box key={w} sx={{ py: 0.75, textAlign: "center", fontFamily: monoFont, fontSize: 10.5,
            color: tokens.text3, borderBottom: `1px solid ${tokens.line}`, textTransform: "uppercase" }}>{w}</Box>
        ))}
        {cells.map((day) => {
          const key = ymd(day);
          const list = byDate.get(key) ?? [];
          const inMonth = day.getMonth() === month.getMonth();
          const isToday = key === todayStr;
          return (
            <Box key={key} onClick={() => onDay(key)}
              sx={{ minHeight: { xs: 78, sm: 104 }, p: 0.6, cursor: "pointer", borderRight: `1px solid ${"#EEF0F3"}`,
                borderBottom: `1px solid ${"#EEF0F3"}`, bgcolor: inMonth ? "transparent" : "#FCFBF8",
                "&:hover": { bgcolor: tokens.paper } }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.4 }}>
                <Box sx={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: "50%",
                  fontFamily: monoFont, fontSize: 11.5, fontWeight: isToday ? 700 : 500,
                  bgcolor: isToday ? tokens.kriya : "transparent", color: isToday ? "#fff" : inMonth ? tokens.text : tokens.text3 }}>
                  {day.getDate()}
                </Box>
              </Stack>
              <Stack spacing={0.35}>
                {list.slice(0, 3).map((it) => (
                  <Stack key={`${it.kind}-${it.id}`} direction="row" alignItems="center" spacing={0.4}
                    sx={{ px: 0.5, py: 0.15, borderRadius: "5px", bgcolor: TINT[it.status], color: SOLID[it.status], minWidth: 0 }}>
                    <ItemIcon kind={it.kind} size={11} />
                    <Typography noWrap sx={{ fontSize: 10.5, fontWeight: 600, color: tokens.ink, minWidth: 0 }}>{it.title}</Typography>
                  </Stack>
                ))}
                {list.length > 3 && (
                  <Typography sx={{ fontSize: 10, color: tokens.text3, pl: 0.5 }}>+{list.length - 3} more</Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Timeline({ items, monthStart, monthEnd, daysInMonth, todayStr, onOpen }: {
  items: CalendarItem[]; monthStart: Date; monthEnd: Date; daysInMonth: number; todayStr: string;
  onOpen: (it: CalendarItem) => void;
}) {
  const todayInMonth = parseYMD(todayStr) >= monthStart && parseYMD(todayStr) <= monthEnd
    ? (parseYMD(todayStr).getDate() - 0.5) / daysInMonth * 100 : null;

  if (items.length === 0) {
    return (
      <Box sx={{ border: `1px dashed ${tokens.line}`, borderRadius: "12px", p: 6, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>Nothing scheduled this month.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ border: `1px solid ${tokens.line}`, borderRadius: "12px", overflow: "hidden", bgcolor: tokens.surface }}>
      {/* day axis */}
      <Box sx={{ display: "flex", pl: "160px", borderBottom: `1px solid ${tokens.line}` }}>
        <Box sx={{ position: "relative", flex: 1, height: 24 }}>
          {[1, 8, 15, 22, daysInMonth].map((d) => (
            <Typography key={d} sx={{ position: "absolute", top: 4, left: `${(d - 1) / daysInMonth * 100}%`,
              fontFamily: monoFont, fontSize: 10, color: tokens.text3, transform: "translateX(2px)" }}>{d}</Typography>
          ))}
        </Box>
      </Box>
      <Stack>
        {items.map((it) => {
          const s = clamp(parseYMD(it.start), monthStart, monthEnd);
          const e = clamp(parseYMD(it.end), monthStart, monthEnd);
          const left = (s.getDate() - 1) / daysInMonth * 100;
          const width = Math.max((e.getDate() - s.getDate() + 1) / daysInMonth * 100, 100 / daysInMonth);
          const single = it.start === it.end;
          return (
            <Stack key={`${it.kind}-${it.id}`} direction="row" alignItems="center"
              onClick={() => onOpen(it)}
              sx={{ cursor: "pointer", borderTop: `1px solid ${"#EEF0F3"}`, "&:hover": { bgcolor: tokens.paper } }}>
              <Stack direction="row" alignItems="center" spacing={0.6}
                sx={{ width: 160, flexShrink: 0, px: 1, py: 0.9, minWidth: 0, color: SOLID[it.status] }}>
                <ItemIcon kind={it.kind} size={13} />
                <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, color: tokens.ink, minWidth: 0 }}>{it.title}</Typography>
              </Stack>
              <Box sx={{ position: "relative", flex: 1, height: 36, mr: 1 }}>
                {todayInMonth !== null && (
                  <Box sx={{ position: "absolute", top: 0, bottom: 0, left: `${todayInMonth}%`, width: "1px", bgcolor: tokens.attn, opacity: 0.5 }} />
                )}
                <Tooltip title={STATUS_LABEL[it.status]} placement="top">
                  <Box sx={{ position: "absolute", top: 8, height: 20, left: `${left}%`, width: `${width}%`,
                    minWidth: single ? 20 : undefined, borderRadius: single ? "50%" : "6px",
                    bgcolor: SOLID[it.status], display: "flex", alignItems: "center", px: single ? 0 : 0.75 }}>
                    {!single && width > 18 && (
                      <Typography noWrap sx={{ fontSize: 10.5, fontWeight: 600, color: "#fff", minWidth: 0 }}>{it.title}</Typography>
                    )}
                  </Box>
                </Tooltip>
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

function Seg({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { key: string; label: string }[];
}) {
  return (
    <Stack direction="row" sx={{ p: 0.35, borderRadius: 2, bgcolor: "#EEF0F3", border: `1px solid ${tokens.line}` }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Box key={o.key} onClick={() => onChange(o.key)}
            sx={{ px: 1.4, py: 0.4, borderRadius: 1.5, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
              color: on ? tokens.kriyaInk : tokens.text2, bgcolor: on ? "#fff" : "transparent",
              boxShadow: on ? "0 1px 2px rgba(20,22,29,.12)" : "none" }}>
            {o.label}
          </Box>
        );
      })}
    </Stack>
  );
}
