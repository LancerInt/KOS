import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import {
  Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from "@mui/material";

import {
  exportProjectsCsv, exportTasksCsv, getProjectReport,
  type CatCounts, type ProjectReportRow,
} from "../features/reports/reportsApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont, categoryColors } from "../theme";

const HEALTH_COLOR: Record<string, string> = {
  on_track: "#2FA36B", at_risk: "#E0A83D", off_track: tokens.attn, on_hold: tokens.text3,
};
const CAT_ORDER: { key: keyof CatCounts; color: string }[] = [
  { key: "not_started", color: categoryColors.notStarted },
  { key: "active", color: categoryColors.active },
  { key: "waiting", color: categoryColors.waiting },
  { key: "in_review", color: categoryColors.inReview },
  { key: "done", color: categoryColors.done },
  { key: "cancelled", color: categoryColors.cancelled },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canExport = "export_data" in caps || "administer" in caps;

  const [rows, setRows] = useState<ProjectReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjectReport()
      .then(setRows)
      .catch((e) => setError(e?.response?.status === 403 ? "You don't have permission to view reports." : "Could not load the report."));
  }, []);

  if (error) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        <Typography variant="h1" sx={{ fontSize: 27, mb: 1 }}>Reports</Typography>
        <Typography sx={{ color: tokens.attn, fontSize: 14 }}>{error}</Typography>
      </Box>
    );
  }
  if (!rows) return <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={26} /></Stack>;

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>Reports</Typography>
        {canExport && (
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => exportProjectsCsv()}>Projects CSV</Button>
            <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => exportTasksCsv()}>Tasks CSV</Button>
          </Stack>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2.5 }}>
        Project rollup across everything you can see — progress, workload by stage and open exposures.
      </Typography>

      <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ "& th": { fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: tokens.text3, fontWeight: 600, borderColor: tokens.line } }}>
              <TableCell>Project</TableCell>
              <TableCell>Health</TableCell>
              <TableCell align="right">Progress</TableCell>
              <TableCell sx={{ width: 160 }}>Tasks by stage</TableCell>
              <TableCell align="right">Overdue</TableCell>
              <TableCell align="right">Risks</TableCell>
              <TableCell align="right">Issues</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} hover onClick={() => navigate(`/projects/${r.id}`)}
                sx={{ cursor: "pointer", "& td": { borderColor: tokens.line } }}>
                <TableCell>
                  <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>{r.code}</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 550 }}>{r.name}</Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: HEALTH_COLOR[r.health] ?? tokens.text3 }} />
                    <Typography sx={{ fontSize: 12, textTransform: "capitalize" }}>{r.health.replace("_", " ")}</Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Typography sx={{ fontFamily: monoFont, fontSize: 12.5 }}>{r.progress}%</Typography>
                </TableCell>
                <TableCell>
                  <MiniBar counts={r.by_category} total={r.tasks_total} />
                  <Typography sx={{ fontSize: 10.5, color: tokens.text3, mt: 0.35 }}>{r.tasks_total} total · {r.tasks_open} open</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: r.tasks_overdue > 0 ? tokens.attn : tokens.text3 }}>{r.tasks_overdue}</Typography>
                </TableCell>
                <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.text2 }}>{r.open_risks}</Typography></TableCell>
                <TableCell align="right"><Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.text2 }}>{r.open_issues}</Typography></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7}><Typography sx={{ fontSize: 13.5, color: tokens.text3, py: 1 }}>No projects to report on.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

function MiniBar({ counts, total }: { counts: CatCounts; total: number }) {
  if (total === 0) return <Box sx={{ height: 8, borderRadius: 4, bgcolor: tokens.line }} />;
  return (
    <Box sx={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", bgcolor: tokens.line }}>
      {CAT_ORDER.map((seg) => {
        const n = counts[seg.key] || 0;
        if (n === 0) return null;
        return <Box key={seg.key} sx={{ width: `${(n / total) * 100}%`, bgcolor: seg.color }} title={`${seg.key}: ${n}`} />;
      })}
    </Box>
  );
}
