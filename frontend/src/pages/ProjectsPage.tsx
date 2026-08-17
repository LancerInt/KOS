import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAutoRefresh } from "../useAutoRefresh";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";

import { listProjects } from "../features/projects/projectsApi";
import type { ProjectSummary } from "../features/projects/types";
import { HealthChip, PRIORITY_COLOR, ProgressBar, TYPE_LABEL } from "../features/projects/display";
import NewProjectDialog from "../components/NewProjectDialog";
import { tokens, monoFont } from "../theme";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Anyone signed in can start their own project; the backend makes them its owner.
  const canCreate = true;

  const load = () => {
    listProjects().then(setProjects).catch(() => setError("Could not load projects."));
  };

  useEffect(load, []);
  useAutoRefresh(load);

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: 28 }}>Projects</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Projects you're a member of. {projects ? `${projects.length} visible.` : ""}
          </Typography>
        </Box>
        {canCreate && (
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setDialogOpen(true)}>
            New project
          </Button>
        )}
      </Stack>

      {error && <Typography sx={{ color: tokens.attn }}>{error}</Typography>}
      {!projects && !error && (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      )}

      {projects && projects.length === 0 && (
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: 3 }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No projects yet</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>
            {canCreate ? "Create your first project from a template to get started." : "Ask a manager to add you to a project."}
          </Typography>
        </Paper>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
        {projects?.map((p) => (
          <Paper
            key={p.id}
            onClick={() => navigate(`/projects/${p.id}`)}
            sx={{
              p: 2.25, borderRadius: 3, cursor: "pointer",
              transition: "box-shadow .16s, transform .16s, border-color .16s",
              "&:hover": { boxShadow: "0 2px 4px rgba(20,22,29,.06), 0 12px 32px rgba(20,22,29,.1)", transform: "translateY(-1px)", borderColor: "#DADEE4" },
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: PRIORITY_COLOR[p.priority] }} />
              <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3 }}>{p.code}</Typography>
              <Box sx={{ flex: 1 }} />
              <HealthChip health={p.health} />
            </Stack>
            <Typography sx={{ fontSize: 15.5, fontWeight: 600, mb: 0.5 }}>{p.name}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ mb: 1.5 }}>
              <Chip label={TYPE_LABEL[p.project_type]} size="small" sx={{ height: 20, fontSize: 10.5, bgcolor: "#F1F3F5", color: tokens.text2 }} />
              {p.my_role && <Chip label={p.my_role} size="small" sx={{ height: 20, fontSize: 10.5, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk, textTransform: "capitalize" }} />}
              <Chip label={`${p.member_count} member${p.member_count === 1 ? "" : "s"}`} size="small" sx={{ height: 20, fontSize: 10.5, bgcolor: "#F1F3F5", color: tokens.text2 }} />
            </Stack>
            <ProgressBar value={p.progress} />
          </Paper>
        ))}
      </Box>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(project) => {
          setDialogOpen(false);
          navigate(`/projects/${project.id}`);
        }}
      />
    </Box>
  );
}
