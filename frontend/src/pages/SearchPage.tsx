import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { Box, Chip, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";

import { globalSearch, type SearchResponse } from "../features/reports/reportsApi";
import { getWorkspace, useWorkspaces } from "../features/workspaces/workspaces";
import { tokens, monoFont } from "../theme";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useWorkspaces();                          // load dynamic workspaces so we can show their labels
  const initial = params.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    setParams(term ? { q: term } : {}, { replace: true });
    if (term.length < 2) { setResp(null); return; }
    setLoading(true);
    const handle = window.setTimeout(() => {
      globalSearch(term).then(setResp).catch(() => setResp(null)).finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const r = resp?.results ?? {};
  const empty = useMemo(() => resp && resp.total === 0, [resp]);
  const wsLabel = (key: string) => getWorkspace(key)?.label ?? key;

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      <Typography variant="h1" sx={{ fontSize: 27, mb: 2 }}>Search</Typography>

      <TextField
        autoFocus fullWidth placeholder="Search workspaces, projects, sections and records…"
        value={q} onChange={(e) => setQ(e.target.value)}
        InputProps={{ startAdornment: (
          <InputAdornment position="start"><SearchRoundedIcon sx={{ color: tokens.text3 }} /></InputAdornment>
        ) }}
        sx={{ mb: 3 }}
      />

      {q.trim().length < 2 && <Hint text="Type at least two characters to search." />}
      {loading && q.trim().length >= 2 && <Hint text="Searching…" />}
      {empty && <Hint text={`Nothing matched "${resp?.query}".`} />}

      {r.workspaces && r.workspaces.length > 0 && (
        <Group label="Workspaces">
          {r.workspaces.map((w) => (
            <Row key={`w${w.key}`} title={w.label} meta={w.blurb || undefined}
              onClick={() => navigate(`/workspaces/${w.key}`)} />
          ))}
        </Group>
      )}

      {r.workspace_projects && r.workspace_projects.length > 0 && (
        <Group label="Projects">
          {r.workspace_projects.map((p) => (
            <Row key={`p${p.id}`} title={p.name} meta={wsLabel(p.workspace)}
              onClick={() => navigate(`/workspaces/${p.workspace}/projects/${p.id}`)} />
          ))}
        </Group>
      )}

      {r.workspace_sections && r.workspace_sections.length > 0 && (
        <Group label="Sections">
          {r.workspace_sections.map((s) => (
            <Row key={`s${s.id}`} title={s.name} chip="section" meta={wsLabel(s.workspace)}
              onClick={() => s.project && navigate(`/workspaces/${s.workspace}/projects/${s.project}`)} />
          ))}
        </Group>
      )}

      {r.records && r.records.length > 0 && (
        <Group label="Records">
          {r.records.map((rec) => (
            <Row key={`r${rec.id}`} title={rec.headline} meta={`${wsLabel(rec.workspace)} · ${rec.category}`}
              onClick={() => rec.project && navigate(`/workspaces/${rec.workspace}/projects/${rec.project}`)} />
          ))}
        </Group>
      )}
    </Box>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.75 }}>
        {label}
      </Typography>
      <Stack spacing={0.75}>{children}</Stack>
    </Box>
  );
}

function Row({ title, meta, mono, chip, onClick }: {
  title: string; meta?: string; mono?: string; chip?: string; onClick?: () => void;
}) {
  return (
    <Paper onClick={onClick}
      sx={{ p: 1.25, borderRadius: 2.5, display: "flex", alignItems: "center", gap: 1.25, cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { borderColor: "#DADEE4" } : undefined }}>
      {mono && <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3, width: 88 }} noWrap>{mono}</Typography>}
      {chip && <Chip label={chip} size="small" sx={{ height: 18, fontSize: 9.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }} />}
      <Typography sx={{ fontSize: 13.5, fontWeight: 500, flex: 1 }} noWrap>{title}</Typography>
      {meta && <Typography sx={{ fontSize: 11.5, color: tokens.text3, whiteSpace: "nowrap" }} noWrap>{meta}</Typography>}
    </Paper>
  );
}

function Hint({ text }: { text: string }) {
  return <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>{text}</Typography>;
}
