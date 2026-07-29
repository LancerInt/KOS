import { Box, Chip } from "@mui/material";

import { tokens } from "../../theme";
import type { Category } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  not_started: "Not started",
  active: "Active",
  waiting: "Waiting",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

export const CATEGORY_COLOR: Record<Category, string> = {
  not_started: "#9AA3B2",
  active: "#2E7DE0",
  waiting: "#E0A83D",
  in_review: "#7C5CD6",
  done: "#2FA36B",
  cancelled: "#A65A6E",
};

/** The default workflow (mirrors backend statuses.py) for the status control. */
export const STATUSES: { key: string; label: string; category: Category }[] = [
  { key: "backlog", label: "Backlog", category: "not_started" },
  { key: "ready", label: "Ready", category: "not_started" },
  { key: "in_progress", label: "In Progress", category: "active" },
  { key: "blocked", label: "Blocked", category: "waiting" },
  { key: "waiting_dependency", label: "Waiting Dependency", category: "waiting" },
  { key: "on_hold", label: "On Hold", category: "waiting" },
  { key: "review", label: "Review", category: "in_review" },
  { key: "qa", label: "QA", category: "in_review" },
  { key: "rework", label: "Rework", category: "active" },
  { key: "approved", label: "Approved", category: "in_review" },
  { key: "completed", label: "Completed", category: "done" },
  { key: "archived", label: "Archived", category: "done" },
  { key: "cancelled", label: "Cancelled", category: "cancelled" },
  { key: "reopened", label: "Reopened", category: "active" },
];

const RAIL: Category[] = ["not_started", "active", "waiting", "in_review", "done"];

/** The signature element — a 6-segment lifecycle bar over the canonical
 * categories (PRD §12.1). Highlights the task's current category. */
export function FlowRail({ category, showCaps = false }: { category: Category; showCaps?: boolean }) {
  const idx = RAIL.indexOf(category);
  const cancelled = category === "cancelled";

  return (
    <Box>
      <Box sx={{ display: "flex", gap: "3px", alignItems: "center" }}>
        {RAIL.map((c, i) => {
          const on = !cancelled && i === idx;
          const past = !cancelled && i < idx;
          const color = CATEGORY_COLOR[c];
          return (
            <Box
              key={c}
              sx={{
                height: 6,
                borderRadius: 3,
                flex: 1,
                background: on ? `linear-gradient(90deg, ${color}, ${color}cc)` : past ? "#CDD3DB" : "#EEF0F3",
                boxShadow: on ? `0 2px 8px ${color}66` : "none",
              }}
            />
          );
        })}
        <Box
          sx={{
            height: 6,
            borderRadius: 3,
            width: 18,
            flex: "none",
            background: cancelled ? CATEGORY_COLOR.cancelled : "#EEF0F3",
            opacity: cancelled ? 1 : 0.5,
          }}
        />
      </Box>
      {showCaps && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.6 }}>
          {RAIL.map((c) => (
            <Box
              key={c}
              sx={{
                fontSize: 9.5,
                color: c === category ? CATEGORY_COLOR[c] : tokens.text3,
                fontWeight: c === category ? 600 : 400,
              }}
            >
              {CATEGORY_LABEL[c]}
            </Box>
          ))}
          <Box sx={{ width: 18 }} />
        </Box>
      )}
    </Box>
  );
}

export function StatusChip({ label, category }: { label: string; category: Category }) {
  const color = CATEGORY_COLOR[category];
  return (
    <Chip
      label={label}
      size="small"
      sx={{ height: 21, fontSize: 10.5, fontWeight: 600, color, bgcolor: `${color}1a` }}
    />
  );
}
