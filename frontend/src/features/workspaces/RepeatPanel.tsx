import { useMemo, useState } from "react";
import { Alert, Box, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";

import {
  addMonths, repeatLabel, REPEAT_OPTIONS,
  type RepeatFrequency, type WorkspaceProject,
} from "./projectsApi";
import { tokens } from "../../theme";

/**
 * Whether a project comes round again, and when the next turn starts.
 *
 * A repeating project is a chain, not a project that reopens: approving this
 * one creates the next with the same name tagged by its period, the same
 * length and the same roster. Changing the frequency here affects the *next*
 * hand-over — turns already created are their own projects and keep their own
 * dates, which is what makes last quarter's filing still readable.
 */
export default function RepeatPanel({ project, canEdit, onChange }: {
  project: WorkspaceProject;
  canEdit: boolean;
  onChange: (frequency: RepeatFrequency) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const months = REPEAT_OPTIONS.find((o) => o.value === project.repeat_frequency)?.months ?? 0;
  const nextStart = useMemo(() => {
    if (!months || !project.start_at) return "";
    return addMonths(project.start_at, months)
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }, [months, project.start_at]);

  const pick = (frequency: RepeatFrequency) => {
    setSaving(true);
    setError("");
    Promise.resolve(onChange(frequency))
      .catch((e) => {
        const data = (e as { response?: { data?: Record<string, string[] | string> } }).response?.data;
        const first = data?.start_at ?? data?.detail;
        setError(Array.isArray(first) ? first[0] : first ?? "Could not change the schedule.");
      })
      .finally(() => setSaving(false));
  };

  return (
    <Paper sx={{ p: 1.75, borderRadius: "10px" }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: project.repeat_frequency || error ? 1.25 : 0 }}>
        <Box sx={{ width: 30, height: 30, borderRadius: "8px", flexShrink: 0, display: "grid", placeItems: "center",
          bgcolor: project.repeat_frequency ? tokens.kriyaWash : "#F1F3F6",
          color: project.repeat_frequency ? tokens.kriyaInk : tokens.text3 }}>
          <AutorenewRoundedIcon sx={{ fontSize: 17 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 13.5, color: tokens.ink }}>
            Repeats
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
            {project.repeat_frequency
              ? `${repeatLabel(project.repeat_frequency)} — the next one starts when this is approved.`
              : "A one-off. Set a frequency to have the next one created automatically."}
          </Typography>
        </Box>
        {canEdit ? (
          <TextField select size="small" value={project.repeat_frequency} disabled={saving}
            onChange={(e) => pick(e.target.value as RepeatFrequency)}
            sx={{ minWidth: 150, flexShrink: 0 }}>
            {REPEAT_OPTIONS.map((o) => (
              <MenuItem key={o.value || "once"} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>
        ) : (
          <Typography sx={{ fontSize: 12.5, color: tokens.text2, flexShrink: 0 }}>
            {repeatLabel(project.repeat_frequency)}
          </Typography>
        )}
      </Stack>

      {project.repeat_frequency && !error && (
        <Box sx={{ px: 1.25, py: 0.9, borderRadius: "8px", bgcolor: tokens.kriyaWash }}>
          <Typography sx={{ fontSize: 12, color: tokens.kriyaInk }}>
            {project.next_occurrence
              ? <>The next one has already been created — this turn is closed.</>
              : nextStart
                ? <>Next run starts <b>{nextStart}</b>, once this one is approved.</>
                : <>Set a start date and the next run will be scheduled from it.</>}
          </Typography>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ fontSize: 12.5, py: 0.25 }}>{error}</Alert>}
    </Paper>
  );
}
