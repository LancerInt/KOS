import { Box, Chip } from "@mui/material";

import { tokens } from "../../theme";
import type { Health, Priority, ProjectType } from "./types";

export const TYPE_LABEL: Record<ProjectType, string> = {
  hybrid: "Hybrid",
  agile: "Agile",
  milestone: "Milestone",
  recurring: "Recurring",
};

export const HEALTH: Record<Health, { label: string; color: string; bg: string }> = {
  on_track: { label: "On track", color: "#1F7A4D", bg: "#E7F5EE" },
  at_risk: { label: "At risk", color: "#B47C1E", bg: "#FBF2E0" },
  off_track: { label: "Off track", color: tokens.attn, bg: tokens.attnWash },
  on_hold: { label: "On hold", color: tokens.text2, bg: "#EEF0F3" },
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  critical: tokens.attn,
  high: "#F08A24",
  medium: "#2E7DE0",
  low: tokens.text3,
};

export const MILESTONE_COLOR: Record<string, string> = {
  pending: tokens.text3,
  in_progress: "#2E7DE0",
  reached: "#2FA36B",
  missed: tokens.attn,
};

export function HealthChip({ health }: { health: Health }) {
  const h = HEALTH[health];
  return (
    <Chip
      label={h.label}
      size="small"
      sx={{ bgcolor: h.bg, color: h.color, fontWeight: 600, height: 22, fontSize: 11.5 }}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: "#EEF0F3", overflow: "hidden" }}>
        <Box
          sx={{
            width: `${Math.min(100, Math.max(0, value))}%`,
            height: "100%",
            borderRadius: 3,
            background: `linear-gradient(90deg, ${tokens.kriya}, ${tokens.kriyaGlow})`,
          }}
        />
      </Box>
      <Box sx={{ fontSize: 11, color: tokens.text2, fontFamily: '"IBM Plex Mono", monospace', minWidth: 30, textAlign: "right" }}>
        {value}%
      </Box>
    </Box>
  );
}
