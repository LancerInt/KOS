import { useEffect, useMemo, useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Select, Stack, TextField, Typography,
} from "@mui/material";

import {
  createSOP, getSOP, listSOPs, transitionSOP, updateSOP,
  type SOP, type SOPStage,
} from "../features/sops/sopsApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const PIPELINE: SOPStage[] = ["research", "draft", "review", "approved", "published"];
const STAGE_LABEL: Record<SOPStage, string> = {
  research: "Research", draft: "Draft", review: "Review",
  approved: "Approved", published: "Published", retired: "Retired",
};
const STAGE_COLOR: Record<SOPStage, string> = {
  research: "#9AA3B2", draft: "#2E7DE0", review: "#7C5CD6",
  approved: tokens.kriya, published: "#2FA36B", retired: "#A65A6E",
};

function transitionLabel(from: SOPStage, to: SOPStage): string {
  if (to === "review") return from === "published" ? "Start periodic review" : "Submit for review";
  if (to === "draft") return from === "review" ? "Send back to draft" : "Move to draft";
  if (to === "approved") return "Approve";
  if (to === "published") return "Publish";
  if (to === "retired") return "Retire";
  return to;
}

export default function SOPsPage() {
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canAuthor = ["create_tasks", "manage_project", "administer"].some((k) => k in caps);

  const [sops, setSops] = useState<SOP[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<SOP | null>(null);
  const [filter, setFilter] = useState<SOPStage | "all">("all");
  const [newOpen, setNewOpen] = useState(false);

  const loadList = () => listSOPs().then(setSops).catch(() => setSops([]));
  useEffect(() => { loadList(); }, []);
  useEffect(() => {
    if (selectedId) getSOP(selectedId).then(setSelected).catch(() => setSelected(null));
    else setSelected(null);
  }, [selectedId]);

  const refresh = () => { loadList(); if (selectedId) getSOP(selectedId).then(setSelected); };

  const shown = useMemo(
    () => (filter === "all" ? sops : sops.filter((s) => s.stage === filter)),
    [sops, filter],
  );

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>SOPs</Typography>
        {canAuthor && (
          <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={() => setNewOpen(true)}>
            New SOP
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2.5 }}>
        Standard Operating Procedures — Research to Published, versioned, with periodic review.
      </Typography>

      <Stack direction="row" spacing={0.75} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        {(["all", ...PIPELINE, "retired"] as const).map((f) => (
          <Chip key={f} label={f === "all" ? "All" : STAGE_LABEL[f]} size="small"
            onClick={() => setFilter(f as SOPStage | "all")}
            sx={{ height: 24, fontSize: 12, cursor: "pointer",
              bgcolor: filter === f ? tokens.ink : "#F1F3F5",
              color: filter === f ? "#fff" : tokens.text2 }} />
        ))}
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "340px 1fr" }, gap: 2, alignItems: "start" }}>
        {/* list */}
        <Stack spacing={1}>
          {shown.map((s) => (
            <Paper key={s.id} onClick={() => setSelectedId(s.id)}
              sx={{ p: 1.5, borderRadius: 3, cursor: "pointer",
                borderColor: selectedId === s.id ? tokens.kriya : undefined,
                "&:hover": { borderColor: "#DADEE4" } }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3 }}>{s.code}</Typography>
                {s.review_overdue && <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: tokens.attn }} title="Review overdue" />}
                <Box sx={{ flex: 1 }} />
                <Chip label={STAGE_LABEL[s.stage]} size="small"
                  sx={{ height: 19, fontSize: 10, color: STAGE_COLOR[s.stage], bgcolor: `${STAGE_COLOR[s.stage]}1a` }} />
              </Stack>
              <Typography sx={{ fontSize: 13.5, fontWeight: 550, mt: 0.4 }}>{s.title}</Typography>
            </Paper>
          ))}
          {shown.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No SOPs here.</Typography>}
        </Stack>

        {/* detail */}
        {selected ? (
          <SOPDetail sop={selected} canAuthor={canAuthor} refresh={refresh} />
        ) : (
          <Paper sx={{ p: 4, borderRadius: 3, textAlign: "center" }}>
            <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>Select an SOP to view its detail.</Typography>
          </Paper>
        )}
      </Box>

      <NewSOPDialog open={newOpen} onClose={() => setNewOpen(false)}
        onCreated={(s) => { setNewOpen(false); loadList(); setSelectedId(s.id); }} />
    </Box>
  );
}

function SOPPipeline({ stage }: { stage: SOPStage }) {
  const retired = stage === "retired";
  const idx = PIPELINE.indexOf(stage);
  return (
    <Stack direction="row" spacing={0.5} sx={{ my: 1.5 }}>
      {PIPELINE.map((s, i) => {
        const done = !retired && i <= idx;
        const isCurrent = s === stage;
        return (
          <Box key={s} sx={{ flex: 1 }}>
            <Box sx={{ height: 5, borderRadius: 3, bgcolor: done ? STAGE_COLOR[s] : tokens.line }} />
            <Typography sx={{ fontSize: 10, mt: 0.5, textAlign: "center",
              color: isCurrent ? STAGE_COLOR[s] : tokens.text3, fontWeight: isCurrent ? 700 : 400 }}>
              {STAGE_LABEL[s]}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

function SOPDetail({ sop, canAuthor, refresh }: { sop: SOP; canAuthor: boolean; refresh: () => void }) {
  const myId = useAppSelector((s) => s.auth.user?.id);
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canManage = "manage_project" in caps || "administer" in caps;
  const canEdit = canAuthor && (sop.owner === myId || canManage);
  const [editing, setEditing] = useState(false);

  const runTransition = async (to: SOPStage) => {
    let reason: string | undefined;
    if (to === "published") {
      reason = window.prompt("Change summary for this version (optional):") ?? "";
    } else if (to === "draft" && sop.stage === "review") {
      const r = window.prompt("Reason for sending back:") ?? "";
      if (!r.trim()) return;
      reason = r;
    }
    try {
      await transitionSOP(sop.id, to, reason ? { reason } : {});
      refresh();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string; to?: string } } })?.response?.data;
      alert(detail?.detail || detail?.to || "That transition was not permitted.");
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Box>
          <Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text3 }}>
            {sop.code} · v{sop.version_number}
          </Typography>
          <Typography variant="h3" sx={{ fontSize: 20, mt: 0.25 }}>{sop.title}</Typography>
        </Box>
        {canEdit && sop.stage !== "published" && (
          <Button size="small" variant="text" startIcon={<EditRoundedIcon sx={{ fontSize: 16 }} />} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      </Stack>

      <SOPPipeline stage={sop.stage} />

      <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
        <Meta label="Owner" value={sop.owner_name || "—"} />
        {sop.department_name && <Meta label="Department" value={sop.department_name} />}
        {sop.effective_date && <Meta label="Effective" value={sop.effective_date} mono />}
        {sop.next_review_date && (
          <Meta label="Next review" value={sop.next_review_date} mono attn={sop.review_overdue} />
        )}
      </Stack>

      {editing ? (
        <SOPEditForm sop={sop} onSaved={() => { setEditing(false); refresh(); }} />
      ) : (
        <>
          {sop.purpose && <Section label="Purpose" body={sop.purpose} />}
          {sop.scope && <Section label="Scope" body={sop.scope} />}
          {sop.content && <Section label="Procedure" body={sop.content} mono />}
        </>
      )}

      {/* transitions */}
      {sop.next_stages.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, pt: 2, borderTop: `1px solid ${tokens.line}` }} flexWrap="wrap" useFlexGap>
          {sop.next_stages.map((to) => {
            const primary = to === "approved" || to === "published";
            const hideApproveOwn = to === "approved" && sop.owner === myId;
            if (hideApproveOwn) return null;
            return (
              <Button key={to} size="small" variant={primary ? "contained" : "outlined"}
                color={to === "retired" ? "error" : "primary"} onClick={() => runTransition(to)}>
                {transitionLabel(sop.stage, to)}
              </Button>
            );
          })}
        </Stack>
      )}

      {/* version history */}
      {sop.versions.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.75 }}>
            Published versions
          </Typography>
          <Stack spacing={0.5}>
            {sop.versions.map((v) => (
              <Stack key={v.id} direction="row" spacing={1} sx={{ py: 0.4 }}>
                <Box sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3, width: 34 }}>v{v.version_number}</Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 12 }}>{v.change_summary || "Published"}</Typography>
                  <Typography sx={{ fontSize: 11, color: tokens.text3 }}>
                    {v.published_by_name || "—"} · {new Date(v.created_at).toLocaleDateString()}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}

function SOPEditForm({ sop, onSaved }: { sop: SOP; onSaved: () => void }) {
  const [purpose, setPurpose] = useState(sop.purpose);
  const [scope, setScope] = useState(sop.scope);
  const [content, setContent] = useState(sop.content);
  const [reviewInterval, setReviewInterval] = useState(String(sop.review_interval_months));
  const save = async () => {
    await updateSOP(sop.id, { purpose, scope, content, review_interval_months: Number(reviewInterval) || 12 });
    onSaved();
  };
  return (
    <Stack spacing={1.25} sx={{ mt: 1 }}>
      <TextField size="small" label="Purpose" multiline minRows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <TextField size="small" label="Scope" multiline minRows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
      <TextField size="small" label="Procedure" multiline minRows={5} value={content} onChange={(e) => setContent(e.target.value)} />
      <TextField size="small" label="Review interval (months)" type="number" value={reviewInterval} onChange={(e) => setReviewInterval(e.target.value)} sx={{ width: 200 }} />
      <Button variant="contained" size="small" onClick={save} sx={{ alignSelf: "flex-start" }}>Save changes</Button>
    </Stack>
  );
}

function NewSOPDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: SOP) => void }) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [content, setContent] = useState("");
  const [reviewInterval, setReviewInterval] = useState("12");
  const [err, setErr] = useState("");

  const create = async () => {
    if (!code.trim() || !title.trim()) { setErr("Code and title are required."); return; }
    try {
      const s = await createSOP({ code, title, purpose, content, review_interval_months: Number(reviewInterval) || 12 });
      setCode(""); setTitle(""); setPurpose(""); setContent(""); setErr("");
      onCreated(s);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { code?: string[]; detail?: string } } })?.response?.data;
      setErr(detail?.code?.[0] || detail?.detail || "Could not create SOP.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New SOP</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Code" placeholder="SOP-QA-001" value={code} onChange={(e) => setCode(e.target.value)} sx={{ width: 200 }} />
            <Select size="small" value={reviewInterval} onChange={(e) => setReviewInterval(e.target.value)} sx={{ fontSize: 13 }}>
              {["6", "12", "24", "36"].map((m) => <MenuItem key={m} value={m} sx={{ fontSize: 13 }}>Review every {m} mo</MenuItem>)}
            </Select>
          </Stack>
          <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <TextField size="small" label="Purpose" multiline minRows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} fullWidth />
          <TextField size="small" label="Procedure (Markdown)" multiline minRows={4} value={content} onChange={(e) => setContent(e.target.value)} fullWidth />
          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create}>Create SOP</Button>
      </DialogActions>
    </Dialog>
  );
}

function Meta({ label, value, mono, attn }: { label: string; value: string; mono?: boolean; attn?: boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontFamily: mono ? monoFont : undefined, color: attn ? tokens.attn : tokens.text }}>{value}</Typography>
    </Box>
  );
}

function Section({ label, body, mono }: { label: string; body: string; mono?: boolean }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.5 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13.5, whiteSpace: "pre-wrap", fontFamily: mono ? monoFont : undefined, lineHeight: 1.6 }}>{body}</Typography>
    </Box>
  );
}
