import { useEffect, useState } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";

import { projectHistory, type HistoryEvent } from "./projectsApi";
import { tokens } from "../../theme";

const META: Record<HistoryEvent["kind"], { label: string; dot: string }> = {
  created:   { label: "Created",                dot: tokens.text3 },
  submitted: { label: "Submitted for approval", dot: "#C0417A" },
  rejected:  { label: "Sent back",              dot: "#C7891B" },
  approved:  { label: "Approved",               dot: "#1E7A50" },
  completed: { label: "Marked complete",        dot: "#1E7A50" },
  reopened:  { label: "Reopened",               dot: tokens.text3 },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The project's approval lifecycle as a vertical timeline — created → submitted
 * → sent back (with reason) → resubmitted → approved — read from the audit
 * trail. ``reloadKey`` should change whenever the project's state does, so the
 * timeline refreshes after a submit / approve / send-back without a full reload.
 */
export function ApprovalTimeline({ projectId, reloadKey }: { projectId: number; reloadKey?: string | number }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);

  useEffect(() => {
    let active = true;
    projectHistory(projectId)
      .then((e) => { if (active) setEvents(e); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [projectId, reloadKey]);

  // Nothing to show until the project has some history (a bare "Created" alone
  // isn't worth a panel).
  if (!events || events.filter((e) => e.kind !== "created").length === 0) return null;

  return (
    <Paper sx={{ p: 1.75, borderRadius: "6px" }}>
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 1.25 }}>
        Approval history
      </Typography>
      <Stack spacing={0}>
        {events.map((e, i) => {
          const m = META[e.kind];
          const last = i === events.length - 1;
          return (
            <Stack key={i} direction="row" spacing={1.25} alignItems="stretch">
              {/* dot + connector rail */}
              <Stack alignItems="center" sx={{ flexShrink: 0 }}>
                <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: m.dot, mt: "4px" }} />
                {!last && <Box sx={{ width: 2, flex: 1, bgcolor: tokens.line, my: 0.3 }} />}
              </Stack>
              <Box sx={{ pb: last ? 0 : 1.75, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: tokens.text, lineHeight: 1.3 }}>
                  {m.label}
                  <Box component="span" sx={{ fontWeight: 400, color: tokens.text2 }}> · {e.actor}</Box>
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>{fmt(e.at)}</Typography>
                {e.reason && (
                  <Typography sx={{ fontSize: 12, color: "#7a5a12", bgcolor: "#FBF2DF", px: 1, py: 0.5, borderRadius: "6px", mt: 0.5, display: "inline-block" }}>
                    “{e.reason}”
                  </Typography>
                )}
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}
