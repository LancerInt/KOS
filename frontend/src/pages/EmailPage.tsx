import { useEffect, useMemo, useState, type HTMLAttributes, type Key } from "react";
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle,
  Paper, Snackbar, Stack, TextField, Typography,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";

import {
  listPeople, listSentEmails, resendEmail, sendEmail,
  type Person, type SentEmail,
} from "../features/email/emailsApi";
import { generateEmail, aiErrorMessage } from "../features/ai/aiApi";
import { tokens, monoFont } from "../theme";

type TabKey = "compose" | "sent";

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  sent: { fg: "#1E7A50", bg: "#E7F4EC" },
  queued: { fg: "#9A6A16", bg: "#FBF2DF" },
  failed: { fg: tokens.attn, bg: tokens.attnWash },
};

/** Module-level so it isn't remounted on every keystroke (which would drop focus). */
function RecipientField({
  label, value, onChange, options, nameByEmail,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
  nameByEmail: Map<string, string>;
}) {
  return (
    <Autocomplete
      multiple freeSolo size="small" options={options} value={value}
      onChange={(_, v) => onChange(v as string[])}
      renderOption={(props, opt) => {
        const { key, ...rest } = props as { key?: Key } & HTMLAttributes<HTMLLIElement>;
        const name = nameByEmail.get(opt as string);
        return (
          <Box component="li" key={key ?? (opt as string)} {...rest}>
            <Stack sx={{ minWidth: 0 }}>
              {name && <Typography sx={{ fontSize: 13.5 }} noWrap>{name}</Typography>}
              <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>{String(opt)}</Typography>
            </Stack>
          </Box>
        );
      }}
      renderTags={(vals, getTagProps) =>
        vals.map((v, i) => {
          const { key, ...tagProps } = getTagProps({ index: i });
          return <Chip key={key} size="small" label={nameByEmail.get(v) ?? v} {...tagProps} />;
        })
      }
      renderInput={(p) => <TextField {...p} label={label} placeholder="name or email…" />}
    />
  );
}

export default function EmailPage() {
  const [tab, setTab] = useState<TabKey>("compose");

  // compose
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // sent
  const [sent, setSent] = useState<SentEmail[] | null>(null);
  const [viewing, setViewing] = useState<SentEmail | null>(null);
  const [resending, setResending] = useState<number | null>(null);

  useEffect(() => { listPeople().then(setPeople).catch(() => setPeople([])); }, []);

  const loadSent = () => { setSent(null); listSentEmails().then(setSent).catch(() => setSent([])); };
  useEffect(() => { if (tab === "sent") loadSent(); }, [tab]);

  const options = useMemo(() => people.map((p) => p.email), [people]);
  const nameByEmail = useMemo(() => new Map(people.map((p) => [p.email, p.name])), [people]);

  const draftAi = async () => {
    const p = aiPrompt.trim();
    if (!p) return;
    setAiBusy(true); setErr("");
    try {
      const outcome = await generateEmail({ purpose: p });
      const d = outcome.data as { subject?: string; body?: string };
      if (d.subject) setSubject(d.subject);
      if (d.body) setBody(d.body);
    } catch (e) {
      setErr(aiErrorMessage(e));
    } finally {
      setAiBusy(false);
    }
  };

  const canSend = to.length > 0 && subject.trim() !== "" && body.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setSending(true); setErr("");
    try {
      await sendEmail({ to, cc, bcc, subject: subject.trim(), body });
      setToast("Email sent.");
      setTo([]); setCc([]); setBcc([]); setSubject(""); setBody(""); setAiPrompt(""); setShowCc(false);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErr(detail ?? aiErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const doResend = async (m: SentEmail) => {
    setResending(m.id);
    try { await resendEmail(m.id); loadSent(); } finally { setResending(null); }
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 0.5 }}>Email</Typography>
      <Typography color="text.secondary" sx={{ mb: 2.5, fontSize: 13.5 }}>
        Write and send emails from KOS. Messages go out from the shared KOS account.
      </Typography>

      {/* tabs */}
      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {(["compose", "sent"] as TabKey[]).map((k) => {
          const active = k === tab;
          return (
            <Box key={k} onClick={() => setTab(k)}
              sx={{ cursor: "pointer", px: 1.75, py: 1.1, fontSize: 13.5, fontWeight: 600, textTransform: "capitalize",
                color: active ? tokens.kriyaInk : tokens.text2,
                borderBottom: `2px solid ${active ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
              {k}
            </Box>
          );
        })}
      </Stack>

      {tab === "compose" ? (
        <Stack spacing={2}>
          {/* AI draft */}
          <Box sx={{ p: 1.5, borderRadius: "10px", border: `1px solid ${tokens.kriya}33`, bgcolor: tokens.kriyaWash }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField size="small" fullWidth multiline maxRows={3}
                placeholder="Describe it and let AI draft the subject & body — e.g. 'ask the vendor for the updated COA'"
                value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                sx={{ "& .MuiOutlinedInput-root": { bgcolor: "#fff" } }} />
              <Button onClick={draftAi} disabled={aiBusy || !aiPrompt.trim()} variant="contained"
                startIcon={aiBusy ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />}
                sx={{ flexShrink: 0 }}>
                {aiBusy ? "…" : "Draft"}
              </Button>
            </Stack>
          </Box>

          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Box sx={{ flex: 1 }}>
              <RecipientField label="To" value={to} onChange={setTo} options={options} nameByEmail={nameByEmail} />
            </Box>
            {!showCc && (
              <Button size="small" color="inherit" onClick={() => setShowCc(true)} sx={{ mt: 0.25, flexShrink: 0 }}>
                Cc / Bcc
              </Button>
            )}
          </Stack>

          {showCc && (
            <>
              <RecipientField label="Cc" value={cc} onChange={setCc} options={options} nameByEmail={nameByEmail} />
              <RecipientField label="Bcc" value={bcc} onChange={setBcc} options={options} nameByEmail={nameByEmail} />
            </>
          )}

          <TextField size="small" label="Subject" fullWidth value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextField label="Message" fullWidth multiline minRows={9} value={body} onChange={(e) => setBody(e.target.value)} />

          {err && <Alert severity="error" sx={{ fontSize: 13 }}>{err}</Alert>}

          <Stack direction="row" alignItems="center" spacing={1}>
            <Button variant="contained" onClick={send} disabled={!canSend || sending}
              startIcon={sending ? <CircularProgress size={15} color="inherit" /> : <SendRoundedIcon sx={{ fontSize: 17 }} />}>
              {sending ? "Sending…" : "Send"}
            </Button>
            <Typography sx={{ fontSize: 12, color: tokens.text3 }}>Sent from the KOS account · review before sending.</Typography>
          </Stack>
        </Stack>
      ) : (
        <>
          <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, flex: 1 }}>
              Sent{sent ? ` · ${sent.length}` : ""}
            </Typography>
            <Button size="small" color="inherit" startIcon={<RefreshRoundedIcon sx={{ fontSize: 16 }} />} onClick={loadSent}>
              Refresh
            </Button>
          </Stack>

          {!sent ? (
            <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={24} /></Stack>
          ) : sent.length === 0 ? (
            <Paper sx={{ p: 5, textAlign: "center", borderRadius: "8px" }}>
              <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No emails sent yet</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>Emails you send will be listed here.</Typography>
            </Paper>
          ) : (
            <Paper sx={{ borderRadius: "10px", overflow: "hidden" }}>
              {sent.map((m, i) => {
                const tone = STATUS_TONE[m.status] ?? STATUS_TONE.queued;
                return (
                  <Stack key={m.id} direction="row" alignItems="center" spacing={1.25}
                    onClick={() => setViewing(m)}
                    sx={{ px: 1.75, py: 1.1, cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${tokens.line}`,
                      "&:hover": { bgcolor: "#F6F5F1" } }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 500 }} noWrap>{m.subject || "(no subject)"}</Typography>
                      <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>
                        To {m.to.join(", ") || "—"}{m.recipient_count > m.to.length ? ` +${m.recipient_count - m.to.length}` : ""}
                      </Typography>
                    </Box>
                    <Chip size="small" label={m.status} sx={{ height: 20, fontSize: 10.5, fontWeight: 600, textTransform: "capitalize", bgcolor: tone.bg, color: tone.fg }} />
                    <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3, flexShrink: 0 }}>
                      {new Date(m.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </Typography>
                    {m.status === "failed" && (
                      <Button size="small" color="inherit" disabled={resending === m.id}
                        onClick={(e) => { e.stopPropagation(); void doResend(m); }}
                        startIcon={<ReplayRoundedIcon sx={{ fontSize: 15 }} />}>
                        {resending === m.id ? "…" : "Resend"}
                      </Button>
                    )}
                  </Stack>
                );
              })}
            </Paper>
          )}
        </>
      )}

      {/* view a sent email */}
      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 17, fontWeight: 600 }}>
          {viewing?.subject || "(no subject)"}
        </DialogTitle>
        <DialogContent dividers>
          {viewing && (
            <Stack spacing={1.25}>
              <Box sx={{ fontSize: 12.5, color: tokens.text2 }}>
                <div><b>To:</b> {viewing.to.join(", ") || "—"}</div>
                {viewing.cc.length > 0 && <div><b>Cc:</b> {viewing.cc.join(", ")}</div>}
                {viewing.bcc.length > 0 && <div><b>Bcc:</b> {viewing.bcc.join(", ")}</div>}
                <div><b>From:</b> {viewing.sender_name} · {new Date(viewing.created_at).toLocaleString("en-GB")}</div>
                {viewing.status === "failed" && viewing.error && (
                  <div style={{ color: tokens.attn }}><b>Error:</b> {viewing.error}</div>
                )}
              </Box>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap", pt: 1, borderTop: `1px solid ${tokens.line}` }}>
                {viewing.body}
              </Typography>
            </Stack>
          )}
        </DialogContent>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast("")} message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />
    </Box>
  );
}
