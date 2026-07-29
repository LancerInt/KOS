import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { Box, Chip, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";

import { globalSearch, type SearchResponse } from "../features/reports/reportsApi";
import { tokens, monoFont, categoryColors } from "../theme";

const CATEGORY_DOT: Record<string, string> = {
  not_started: categoryColors.notStarted, active: categoryColors.active, waiting: categoryColors.waiting,
  in_review: categoryColors.inReview, done: categoryColors.done, cancelled: categoryColors.cancelled,
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
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

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 27, mb: 2 }}>Search</Typography>

      <TextField
        autoFocus fullWidth placeholder="Search projects, tasks, documents, SOPs, registers…"
        value={q} onChange={(e) => setQ(e.target.value)}
        InputProps={{ startAdornment: (
          <InputAdornment position="start"><SearchRoundedIcon sx={{ color: tokens.text3 }} /></InputAdornment>
        ) }}
        sx={{ mb: 3 }}
      />

      {q.trim().length < 2 && <Hint text="Type at least two characters to search." />}
      {loading && q.trim().length >= 2 && <Hint text="Searching…" />}
      {empty && <Hint text={`Nothing matched "${resp?.query}".`} />}

      {r.projects && r.projects.length > 0 && (
        <Group label="Projects">
          {r.projects.map((p) => (
            <Row key={`p${p.id}`} mono={p.code} title={p.name}
              meta={`${p.project_type} · ${p.status.replace("_", " ")}`}
              onClick={() => navigate(`/projects/${p.id}`)} />
          ))}
        </Group>
      )}

      {r.tasks && r.tasks.length > 0 && (
        <Group label="Tasks">
          {r.tasks.map((t) => (
            <Row key={`t${t.id}`} title={t.title} dot={CATEGORY_DOT[t.category]}
              meta={`${t.project_code}${t.due_date ? ` · due ${t.due_date}` : ""}`}
              attn={t.is_overdue}
              onClick={() => navigate(`/projects/${t.project}`)} />
          ))}
        </Group>
      )}

      {r.documents && r.documents.length > 0 && (
        <Group label="Documents">
          {r.documents.map((d) => (
            <Row key={`d${d.id}`} title={d.title} meta={`${d.category} · ${d.status.replace("_", " ")}`}
              onClick={() => d.project && navigate(`/projects/${d.project}/documents`)} />
          ))}
        </Group>
      )}

      {r.sops && r.sops.length > 0 && (
        <Group label="SOPs">
          {r.sops.map((s) => (
            <Row key={`s${s.id}`} mono={s.code} title={s.title} meta={s.stage}
              onClick={() => navigate("/sops")} />
          ))}
        </Group>
      )}

      {r.registers && r.registers.length > 0 && (
        <Group label="Risks, issues & decisions">
          {r.registers.map((x) => (
            <Row key={`${x.type}${x.id}`} title={x.label}
              chip={x.type} meta={x.status.replace("_", " ")}
              onClick={() => navigate(`/projects/${x.project}/registers`)} />
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

function Row({ title, meta, mono, dot, chip, attn, onClick }: {
  title: string; meta?: string; mono?: string; dot?: string; chip?: string; attn?: boolean; onClick?: () => void;
}) {
  return (
    <Paper onClick={onClick}
      sx={{ p: 1.25, borderRadius: 2.5, display: "flex", alignItems: "center", gap: 1.25, cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { borderColor: "#DADEE4" } : undefined }}>
      {dot && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: dot }} />}
      {mono && <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3, width: 88 }} noWrap>{mono}</Typography>}
      {chip && <Chip label={chip} size="small" sx={{ height: 18, fontSize: 9.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }} />}
      <Typography sx={{ fontSize: 13.5, fontWeight: 500, flex: 1 }} noWrap>{title}</Typography>
      {meta && <Typography sx={{ fontSize: 11.5, color: attn ? tokens.attn : tokens.text3, textTransform: "capitalize", whiteSpace: "nowrap" }}>{meta}</Typography>}
    </Paper>
  );
}

function Hint({ text }: { text: string }) {
  return <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>{text}</Typography>;
}
