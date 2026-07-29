import { Box, Chip, Paper, Stack, Typography } from "@mui/material";

import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const CAPABILITY_LABELS: Record<string, string> = {
  view: "View",
  comment: "Comment",
  update_assigned: "Update assigned work",
  create_tasks: "Create tasks",
  assign_tasks: "Assign tasks",
  manage_backlog: "Manage backlog & sprint",
  approve: "Approve deliverables",
  manage_project: "Manage project",
  manage_workflows: "Manage workflows",
  view_reports: "View reports",
  export_data: "Export data",
  administer: "Administer system",
};

export default function HomePage() {
  const user = useAppSelector((s) => s.auth.user);
  const caps = user?.effective_capabilities ?? {};

  return (
    <Box sx={{ maxWidth: 980, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 28 }}>
        Welcome, {user?.first_name || user?.username}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Your work board and dashboards arrive with the next modules. For now, here's what your
        account can do — resolved live from the server (PRD §7.4).
      </Typography>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} alignItems="stretch">
        {/* identity */}
        <Paper sx={{ p: 2.5, flex: 1, borderRadius: 3 }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: tokens.text3, fontWeight: 600, mb: 1.5 }}>
            Identity
          </Typography>
          <Stack spacing={1.2}>
            <Field label="Name" value={user?.full_name || "—"} />
            <Field label="Username" value={user?.username ?? ""} mono />
            <Field label="Email" value={user?.email ?? ""} />
            <Box>
              <Typography sx={{ fontSize: 11, color: tokens.text3, mb: 0.5 }}>Roles</Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {user?.role_names?.length ? (
                  user.role_names.map((r) => (
                    <Chip key={r} label={r} size="small" sx={{ bgcolor: tokens.kriyaWash, color: tokens.kriyaInk, fontWeight: 600 }} />
                  ))
                ) : (
                  <Typography sx={{ fontSize: 13, color: tokens.text3 }}>No roles assigned</Typography>
                )}
              </Stack>
            </Box>
            {user?.is_privileged && (
              <Chip
                label={user.mfa_enabled ? "MFA enabled" : "MFA setup required"}
                size="small"
                sx={{
                  alignSelf: "flex-start",
                  bgcolor: user.mfa_enabled ? "#E7F5EE" : tokens.attnWash,
                  color: user.mfa_enabled ? "#1F7A4D" : tokens.attn,
                  fontWeight: 600,
                }}
              />
            )}
          </Stack>
        </Paper>

        {/* capabilities */}
        <Paper sx={{ p: 2.5, flex: 1.4, borderRadius: 3 }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: tokens.text3, fontWeight: 600, mb: 1.5 }}>
            Effective capabilities · Capability × Scope
          </Typography>
          {Object.keys(caps).length === 0 ? (
            <Typography sx={{ fontSize: 13, color: tokens.text3 }}>
              No capabilities yet. An administrator assigns you a role.
            </Typography>
          ) : (
            <Stack spacing={0.75}>
              {Object.entries(caps).map(([cap, scope]) => (
                <Stack key={cap} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.6, borderBottom: `1px solid ${tokens.line}` }}>
                  <Typography sx={{ fontSize: 13.5 }}>{CAPABILITY_LABELS[cap] ?? cap}</Typography>
                  <Chip label={scope} size="small" sx={{ fontFamily: monoFont, fontSize: 10.5, height: 20, bgcolor: "#EEF0F3", color: tokens.text2 }} />
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>
    </Box>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: tokens.text3 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13.5, fontFamily: mono ? monoFont : undefined }}>{value}</Typography>
    </Box>
  );
}
