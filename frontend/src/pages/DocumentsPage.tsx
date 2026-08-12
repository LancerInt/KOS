import { useEffect, useState, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAutoRefresh } from "../useAutoRefresh";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded";
import {
  Box, Button, Chip, Collapse, Divider, IconButton, MenuItem, Paper, Select,
  Stack, TextField, Typography,
} from "@mui/material";

import {
  createDocument, decideDocument, downloadVersion, listDocuments, rollbackDocument,
  submitDocument, uploadVersion,
  type DocCategory, type DocStatus, type KDocument,
} from "../features/documents/documentsApi";
import AiActionButton, { AiActionBar } from "../features/ai/AiActionButton";
import { improveGrammar, rewrite, summarize, translate } from "../features/ai/aiApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const CATEGORIES: { v: DocCategory; l: string }[] = [
  { v: "general", l: "General" },
  { v: "regulatory", l: "Regulatory / Compliance" },
  { v: "contract", l: "Contract / Agreement" },
  { v: "report", l: "Report" },
  { v: "specification", l: "Specification" },
  { v: "license", l: "Licence / Certificate" },
  { v: "other", l: "Other" },
];
const CATEGORY_LABEL: Record<DocCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.v, c.l]),
) as Record<DocCategory, string>;

const STATUS_COLOR: Record<DocStatus, string> = {
  draft: tokens.text3,
  pending_approval: "#E0A83D",
  approved: "#2FA36B",
  archived: tokens.text3,
};

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function DocumentsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const projectId = Number(id);
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const myId = useAppSelector((s) => s.auth.user?.id);
  const canWrite = ["create_tasks", "manage_project", "administer"].some((k) => k in caps);
  const canApprove = "approve" in caps || "administer" in caps;

  const [docs, setDocs] = useState<KDocument[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => {
    if (id) listDocuments(id).then(setDocs).catch(() => setDocs([]));
  };
  useEffect(load, [id]);
  useAutoRefresh(load);

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} onClick={() => navigate(`/projects/${id}`)}
        sx={{ cursor: "pointer", color: tokens.text2, width: "fit-content", "&:hover": { color: tokens.kriyaInk } }}>
        <ArrowBackRoundedIcon sx={{ fontSize: 17 }} /><Typography sx={{ fontSize: 13 }}>Back to project</Typography>
      </Stack>

      <Typography variant="h1" sx={{ fontSize: 27, mt: 2, mb: 0.5 }}>Documents</Typography>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 1.5 }}>
        Versioned files with approval status, expiry reminders and a download trail.
      </Typography>

      {/* Document AI tools. These work on text you paste — stored files are
          binaries the server does not extract text from. */}
      <Box sx={{ mb: 2.5 }}>
        <AiActionBar>
          <AiActionButton
            label="Summarize"
            title="Summarize text"
            fields={[{ name: "text", label: "Text", placeholder: "Paste the document text…", multiline: true, required: true }]}
            run={(v) => summarize(v.text, { audience: "the project team" })}
          />
          <AiActionButton
            label="Rewrite"
            title="Rewrite text"
            fields={[
              { name: "text", label: "Text", placeholder: "Paste the text to rewrite…", multiline: true, required: true },
              { name: "instruction", label: "How should it change? (optional)", placeholder: "e.g. make it more formal and shorter" },
            ]}
            run={(v) => rewrite(v.text, { instruction: v.instruction })}
          />
          <AiActionButton
            label="Improve grammar"
            title="Grammar and spelling"
            fields={[{ name: "text", label: "Text", placeholder: "Paste the text to correct…", multiline: true, required: true }]}
            run={(v) => improveGrammar(v.text)}
          />
          <AiActionButton
            label="Translate"
            title="Translate text"
            fields={[
              { name: "text", label: "Text", placeholder: "Paste the text to translate…", multiline: true, required: true },
              { name: "language", label: "Target language", placeholder: "e.g. Tamil, Hindi, German", required: true },
            ]}
            run={(v) => translate(v.text, v.language)}
          />
        </AiActionBar>
      </Box>

      {canWrite && <UploadForm projectId={projectId} onDone={load} />}

      <Stack spacing={1.25}>
        {docs.map((d) => (
          <DocumentCard
            key={d.id} doc={d} expanded={expanded === d.id}
            onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
            canWrite={canWrite} canApprove={canApprove} isOwner={d.owner === myId} reload={load}
          />
        ))}
        {docs.length === 0 && (
          <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No documents yet.</Typography>
        )}
      </Stack>
    </Box>
  );
}

function UploadForm({ projectId, onDone }: { projectId: number; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocCategory>("general");
  const [expiry, setExpiry] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("project", String(projectId));
    form.append("title", title || file.name);
    form.append("category", category);
    if (expiry) form.append("expiry_date", expiry);
    form.append("file", file);
    setBusy(true);
    try {
      await createDocument(form);
      setTitle(""); setExpiry(""); setFile(null); setCategory("general");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper sx={{ p: 1.75, borderRadius: 3, mb: 2.5 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <TextField size="small" placeholder="Document title (optional)" value={title}
            onChange={(e) => setTitle(e.target.value)} sx={{ flex: 1, minWidth: 200 }} />
          <Select size="small" value={category} onChange={(e) => setCategory(e.target.value as DocCategory)} sx={{ fontSize: 12.5, minWidth: 170 }}>
            {CATEGORIES.map((c) => <MenuItem key={c.v} value={c.v} sx={{ fontSize: 12.5 }}>{c.l}</MenuItem>)}
          </Select>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" type="date" label="Expiry" InputLabelProps={{ shrink: true }}
            value={expiry} onChange={(e) => setExpiry(e.target.value)} sx={{ width: 170 }} />
          <Button component="label" variant="outlined" size="small" startIcon={<UploadFileRoundedIcon />}>
            {file ? "Change file" : "Choose file"}
            <input hidden type="file" onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
          {file && <Typography sx={{ fontSize: 12.5, color: tokens.text2 }} noWrap>{file.name}</Typography>}
          <Button variant="contained" size="small" onClick={submit} disabled={!file || busy} sx={{ ml: "auto" }}>
            Upload document
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function DocumentCard({
  doc, expanded, onToggle, canWrite, canApprove, isOwner, reload,
}: {
  doc: KDocument; expanded: boolean; onToggle: () => void;
  canWrite: boolean; canApprove: boolean; isOwner: boolean; reload: () => void;
}) {
  const current = doc.versions.find((v) => v.is_current) ?? doc.versions[0];

  const decide = async (decision: "approve" | "reject" | "request_changes") => {
    let reason = "";
    if (decision !== "approve") {
      reason = window.prompt(decision === "reject" ? "Reason for rejection:" : "What changes are needed?") ?? "";
      if (!reason.trim()) return;
    }
    await decideDocument(doc.id, decision, reason);
    reload();
  };

  return (
    <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ p: 1.75, display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: 14.5, fontWeight: 600 }} noWrap>{doc.title}</Typography>
            <Chip label={doc.status_display} size="small"
              sx={{ height: 20, fontSize: 10.5, color: STATUS_COLOR[doc.status], bgcolor: `${STATUS_COLOR[doc.status]}1a` }} />
            <Box component="span" sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3 }}>v{doc.version_number}</Box>
            <ExpiryBadge doc={doc} />
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.35 }}>
            {CATEGORY_LABEL[doc.category]} · {doc.owner_name || "—"}
            {current ? ` · ${fmtBytes(current.size_bytes)}` : ""}
          </Typography>
        </Box>
        {current && (
          <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />}
            onClick={() => downloadVersion(current.id, current.original_filename)}>
            Download
          </Button>
        )}
        <IconButton size="small" onClick={onToggle}
          sx={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <ExpandMoreRoundedIcon />
        </IconButton>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Divider />
        <Box sx={{ p: 1.75, bgcolor: tokens.paper }}>
          {/* Approval controls */}
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
            {doc.status === "draft" && canWrite && (
              <Button size="small" variant="contained" onClick={() => submitDocument(doc.id).then(reload)}>
                Submit for approval
              </Button>
            )}
            {doc.status === "pending_approval" && canApprove && !isOwner && (
              <>
                <Button size="small" variant="contained" color="primary" onClick={() => decide("approve")}>Approve</Button>
                <Button size="small" variant="outlined" onClick={() => decide("request_changes")}>Request changes</Button>
                <Button size="small" variant="text" color="error" onClick={() => decide("reject")}>Reject</Button>
              </>
            )}
            {doc.status === "pending_approval" && isOwner && (
              <Typography sx={{ fontSize: 12.5, color: "#E0A83D" }}>Awaiting approval from another reviewer.</Typography>
            )}
            {doc.status === "approved" && (
              <Typography sx={{ fontSize: 12.5, color: "#2FA36B" }}>
                Approved{doc.approved_by_name ? ` by ${doc.approved_by_name}` : ""}.
              </Typography>
            )}
          </Stack>

          {/* Version history */}
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.75 }}>
            Version history
          </Typography>
          <Stack spacing={0.5}>
            {doc.versions.map((v) => (
              <Stack key={v.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
                <Box sx={{ fontFamily: monoFont, fontSize: 11.5, width: 34, color: v.is_current ? tokens.kriyaInk : tokens.text3, fontWeight: v.is_current ? 700 : 400 }}>
                  v{v.version_number}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5 }} noWrap>{v.original_filename || "file"}</Typography>
                  <Typography sx={{ fontSize: 11, color: tokens.text3 }}>
                    {v.uploaded_by_name || "—"} · {new Date(v.created_at).toLocaleDateString()}{v.notes ? ` · ${v.notes}` : ""}
                  </Typography>
                </Box>
                {v.is_current && <Chip label="current" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />}
                <IconButton size="small" title="Download" onClick={() => downloadVersion(v.id, v.original_filename)}>
                  <DownloadRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
                {!v.is_current && canWrite && (
                  <IconButton size="small" title="Roll back to this version" onClick={() => rollbackDocument(doc.id, v.id).then(reload)}>
                    <RestoreRoundedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                )}
              </Stack>
            ))}
          </Stack>

          {canWrite && <NewVersion docId={doc.id} reload={reload} />}
        </Box>
      </Collapse>
    </Paper>
  );
}

function NewVersion({ docId, reload }: { docId: number; reload: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const upload = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (notes) form.append("notes", notes);
    await uploadVersion(docId, form);
    setFile(null); setNotes("");
    reload();
  };
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, pt: 1.5, borderTop: `1px solid ${tokens.line}` }} flexWrap="wrap" useFlexGap>
      <Button component="label" size="small" variant="outlined" startIcon={<UploadFileRoundedIcon />}>
        {file ? "Change" : "New version"}
        <input hidden type="file" onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)} />
      </Button>
      {file && <Typography sx={{ fontSize: 12, color: tokens.text2 }} noWrap>{file.name}</Typography>}
      <TextField size="small" placeholder="What changed?" value={notes} onChange={(e) => setNotes(e.target.value)} sx={{ flex: 1, minWidth: 160 }} />
      <Button size="small" variant="contained" onClick={upload} disabled={!file}>Upload</Button>
    </Stack>
  );
}

function ExpiryBadge({ doc }: { doc: KDocument }) {
  if (!doc.expiry_date) return null;
  const days = doc.expires_in_days;
  if (doc.is_expired) {
    return <Chip label="Expired" size="small" sx={{ height: 20, fontSize: 10.5, color: tokens.attn, bgcolor: tokens.attnWash }} />;
  }
  const soon = days !== null && days <= doc.reminder_lead_days;
  return (
    <Chip
      label={soon ? `Expires in ${days}d` : `Expires ${doc.expiry_date}`}
      size="small"
      sx={{ height: 20, fontSize: 10.5, fontFamily: soon ? undefined : monoFont,
        color: soon ? "#B26A00" : tokens.text3, bgcolor: soon ? "#FBEFD6" : "#F1F3F5" }}
    />
  );
}
