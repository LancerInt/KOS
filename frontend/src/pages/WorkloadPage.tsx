import { useEffect, useMemo, useState } from "react";
import { Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

import { formatMinutes, getWorkload, type Workload } from "../features/tasks/timeApi";
import { tokens, monoFont } from "../theme";

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function WorkloadPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [data, setData] = useState<Workload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const start = iso(weekStart);
    const end = iso(new Date(weekStart.getTime() + 6 * 86400000));
    getWorkload(start, end).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [weekStart]);

  const shift = (weeks: number) => setWeekStart((w) => new Date(w.getTime() + weeks * 7 * 86400000));
  const maxLogged = useMemo(() => Math.max(1, ...(data?.rows ?? []).map((r) => r.logged_minutes)), [data]);

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 28 }}>Workload</Typography>
          <Typography sx={{ mt: 0.4, fontSize: 13.5, color: tokens.text2 }}>Time logged and open work per person.</Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Button size="small" startIcon={<ChevronLeftRoundedIcon />} onClick={() => shift(-1)}>Prev</Button>
          <Typography sx={{ fontSize: 13, fontFamily: monoFont, minWidth: 150, textAlign: "center" }}>
            {data ? `${fmtDate(data.start)} – ${fmtDate(data.end)}` : "…"}
          </Typography>
          <Button size="small" endIcon={<ChevronRightRoundedIcon />} onClick={() => shift(1)}>Next</Button>
          <Button size="small" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</Button>
        </Stack>
      </Stack>

      {loading && <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>}

      {!loading && data && (
        <Paper sx={{ borderRadius: "10px", overflow: "hidden" }}>
          <Stack direction="row" sx={{ px: 2, py: 1, borderBottom: `1px solid ${tokens.line}`, bgcolor: tokens.paper }}>
            <Typography sx={{ flex: 1, fontSize: 11, fontWeight: 700, color: tokens.text3, textTransform: "uppercase", letterSpacing: ".05em" }}>Person</Typography>
            <Typography sx={{ width: 280, fontSize: 11, fontWeight: 700, color: tokens.text3, textTransform: "uppercase", letterSpacing: ".05em" }}>Logged this week</Typography>
            <Typography sx={{ width: 80, fontSize: 11, fontWeight: 700, color: tokens.text3, textAlign: "right", textTransform: "uppercase", letterSpacing: ".05em" }}>Open</Typography>
            <Typography sx={{ width: 110, fontSize: 11, fontWeight: 700, color: tokens.text3, textAlign: "right", textTransform: "uppercase", letterSpacing: ".05em" }}>Est. open</Typography>
          </Stack>
          {data.rows.map((r, i) => (
            <Stack key={r.user_id} direction="row" alignItems="center" sx={{ px: 2, py: 1.1, borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
              <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{r.user_name}</Typography>
              <Box sx={{ width: 280, pr: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: "#EEF0F3", overflow: "hidden" }}>
                    <Box sx={{ width: `${Math.round((r.logged_minutes * 100) / maxLogged)}%`, height: "100%", bgcolor: tokens.kriya }} />
                  </Box>
                  <Typography sx={{ fontSize: 12.5, fontFamily: monoFont, minWidth: 56, textAlign: "right" }}>{formatMinutes(r.logged_minutes)}</Typography>
                </Stack>
              </Box>
              <Typography sx={{ width: 80, fontSize: 13, textAlign: "right", fontFamily: monoFont }}>{r.open_tasks}</Typography>
              <Typography sx={{ width: 110, fontSize: 13, textAlign: "right", fontFamily: monoFont, color: tokens.text2 }}>
                {r.open_estimate_minutes ? formatMinutes(r.open_estimate_minutes) : "—"}
              </Typography>
            </Stack>
          ))}
          {data.rows.length === 0 && (
            <Typography sx={{ p: 2.5, fontSize: 13.5, color: tokens.text3 }}>No time logged and no open assigned tasks this week.</Typography>
          )}
        </Paper>
      )}
    </Box>
  );
}
