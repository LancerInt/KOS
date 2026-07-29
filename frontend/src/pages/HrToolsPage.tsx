import { useEffect, useMemo, useState } from "react";
import { Box, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";

import AiActionButton, { AiActionBar } from "../features/ai/AiActionButton";
import { useAiPageContext } from "../features/ai/AiContext";
import { hr } from "../features/ai/aiApi";
import { listUsers, type AdminUser } from "../features/admin/adminApi";
import { useAppSelector } from "../hooks";
import { tokens } from "../theme";

/**
 * HR writing tools.
 *
 * KOS has no HR module, so these two AI features stand on their own rather than
 * hanging off records that do not exist. The performance summary is the
 * interesting one: it is grounded in the person's *actual* delivery record from
 * the task engine, not in free-form opinion — the server assembles that context
 * and refuses to summarise someone else unless the caller holds `view_reports`.
 */
export default function HrToolsPage() {
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const me = useAppSelector((s) => s.auth.user);
  const canReviewOthers = "view_reports" in caps || "administer" in caps;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [subjectId, setSubjectId] = useState<number | "">("");

  useEffect(() => {
    if (!canReviewOthers) return;
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [canReviewOthers]);

  // Without the reports capability you may still review yourself.
  const effectiveSubject = canReviewOthers ? subjectId : (me?.id ?? "");

  useAiPageContext(
    useMemo(
      () => ({
        label: "HR tools",
        text: "The user is on the HR tools screen, which drafts job descriptions and performance summaries.",
      }),
      [],
    ),
  );

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 26 }}>
        HR tools
      </Typography>
      <Typography sx={{ fontSize: 13.5, color: tokens.text2, mt: 0.5, mb: 3 }}>
        Draft job descriptions, and build performance summaries from a person's real delivery record.
      </Typography>

      <Stack spacing={2}>
        <Paper sx={{ p: 2.5, borderRadius: "6px" }}>
          <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 15, mb: 0.5 }}>
            Job description
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: tokens.text2, mb: 1.75 }}>
            Describe the role and the AI drafts the full description — responsibilities, qualifications
            and skills.
          </Typography>
          <AiActionBar>
            <AiActionButton
              label="Generate job description"
              title="Job description"
              variant="contained"
              fields={[
                { name: "role_title", label: "Role title", placeholder: "e.g. Process Engineer", required: true },
                { name: "department", label: "Department (optional)", placeholder: "e.g. Operations" },
                { name: "seniority", label: "Seniority (optional)", placeholder: "e.g. 3–5 years" },
                {
                  name: "requirements",
                  label: "Anything specific to include (optional)",
                  placeholder: "Must-have skills, certifications, shift pattern…",
                  multiline: true,
                },
              ]}
              run={(v) =>
                hr.jobDescription({
                  role_title: v.role_title,
                  department: v.department,
                  seniority: v.seniority,
                  requirements: v.requirements,
                })
              }
            />
          </AiActionBar>
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: "6px" }}>
          <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 15, mb: 0.5 }}>
            Performance summary
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: tokens.text2, mb: 1.75 }}>
            Built from the person's open, completed, overdue and blocked work in KOS. Treat it as a
            starting draft for a conversation, never as a rating on its own.
          </Typography>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            {canReviewOthers ? (
              <TextField
                select
                size="small"
                label="Person"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value === "" ? "" : Number(e.target.value))}
                sx={{ minWidth: 260 }}
              >
                <MenuItem value="">Select a person…</MenuItem>
                {users
                  .filter((u) => u.is_active)
                  .map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      {user.full_name || user.username}
                    </MenuItem>
                  ))}
              </TextField>
            ) : (
              <Typography sx={{ fontSize: 13, color: tokens.text2 }}>
                You can generate a summary of your own work.
              </Typography>
            )}

            <AiActionButton
              label="Generate summary"
              title="Performance summary"
              variant="contained"
              disabled={effectiveSubject === ""}
              disabledReason="Choose a person first."
              fields={[
                { name: "period_label", label: "Review period (optional)", placeholder: "e.g. Q2 2026" },
                {
                  name: "notes",
                  label: "Manager's notes (optional)",
                  placeholder: "Context the system cannot see — behaviour, feedback, goals…",
                  multiline: true,
                },
              ]}
              run={(v) =>
                hr.performanceSummary({
                  user_id: Number(effectiveSubject),
                  period_label: v.period_label,
                  notes: v.notes,
                })
              }
            />
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}
