import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";

import { tokens } from "../../theme";
import { aiErrorMessage, sendEmail, type SentEmail } from "./aiApi";

/**
 * Compose and send an email out of KOS.
 *
 * Opens pre-filled from an AI draft, but everything stays editable — the draft
 * is a starting point, never the thing that gets sent unread. Nothing leaves
 * until the user presses Send, which is the whole reason drafting and sending
 * are separate API calls.
 *
 * Cc and Bcc start collapsed. Most messages have neither, and two empty fields
 * at the top of a compose form make the common case look like work.
 */

export interface SendEmailDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled subject, usually `data.subject` from a generated draft. */
  subject?: string;
  /** Pre-filled body, usually `data.body` from a generated draft. */
  body?: string;
  /** Pre-filled recipient, when the screen already knows who this is about. */
  to?: string;
  /** The generated draft's `log_id`, tying the sent mail back to its draft. */
  draftLogId?: number | null;
  projectId?: number;
  taskId?: number;
  onSent?: (email: SentEmail) => void;
}

/** Split what the user typed into addresses, so the chip preview matches the send. */
function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A loose check for the preview only — the server is the authority on validity. */
function looksLikeAddress(value: string): boolean {
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value.replace(/^.*<|>.*$/g, "").trim());
}

export default function SendEmailDialog({
  open,
  onClose,
  subject: initialSubject = "",
  body: initialBody = "",
  to: initialTo = "",
  draftLogId,
  projectId,
  taskId,
  onSent,
}: SendEmailDialogProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [showCopies, setShowCopies] = useState(false);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<SentEmail | null>(null);

  // Re-seed each time the dialog opens: the draft behind it may have been
  // regenerated since last time, and showing the previous one would be a lie.
  useEffect(() => {
    if (!open) return;
    setTo(initialTo);
    setCc("");
    setBcc("");
    setSubject(initialSubject);
    setBody(initialBody);
    setShowCopies(false);
    setError("");
    setSent(null);
    setSending(false);
  }, [open, initialTo, initialSubject, initialBody]);

  const recipients = splitAddresses(to);
  const copies = [...splitAddresses(cc), ...splitAddresses(bcc)];
  const invalid = [...recipients, ...copies].filter((a) => !looksLikeAddress(a));
  const canSend = recipients.length > 0 && subject.trim() !== "" && body.trim() !== "" && !invalid.length;

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const email = await sendEmail({
        to: recipients,
        cc: splitAddresses(cc),
        bcc: splitAddresses(bcc),
        subject,
        body,
        project_id: projectId,
        task_id: taskId,
        draft_log_id: draftLogId ?? undefined,
      });
      setSent(email);
      onSent?.(email);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !sending && onClose()}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: "6px" } }}
    >
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600 }}>
        {sent ? "Email sent" : "Send email"}
      </DialogTitle>

      <DialogContent>
        {sent ? (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Alert severity={sent.status === "failed" ? "error" : "success"}>
              {sent.status === "failed"
                ? `The mail server rejected it: ${sent.error}`
                : `Sent to ${sent.recipient_count} recipient${sent.recipient_count === 1 ? "" : "s"}.`}
            </Alert>
            <Box>
              <Typography sx={{ fontSize: 12, color: tokens.text3, mb: 0.5 }}>To</Typography>
              <Stack direction="row" gap={0.5} flexWrap="wrap" useFlexGap>
                {sent.to.map((a) => <Chip key={a} size="small" label={a} />)}
              </Stack>
            </Box>
            {sent.bcc.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 12, color: tokens.text3, mb: 0.5 }}>
                  Bcc — hidden from everyone else on the message
                </Typography>
                <Stack direction="row" gap={0.5} flexWrap="wrap" useFlexGap>
                  {sent.bcc.map((a) => <Chip key={a} size="small" variant="outlined" label={a} />)}
                </Stack>
              </Box>
            )}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              fullWidth
              size="small"
              required
              label="To"
              placeholder="name@example.com, another@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              helperText="Separate several addresses with commas."
            />

            {showCopies ? (
              <>
                <TextField
                  fullWidth size="small" label="Cc"
                  placeholder="name@example.com"
                  value={cc} onChange={(e) => setCc(e.target.value)}
                />
                <TextField
                  fullWidth size="small" label="Bcc"
                  placeholder="name@example.com"
                  value={bcc} onChange={(e) => setBcc(e.target.value)}
                  helperText="Blind copies — invisible to everyone else on the message."
                />
              </>
            ) : (
              <Button
                size="small"
                color="inherit"
                onClick={() => setShowCopies(true)}
                sx={{ alignSelf: "flex-start", fontSize: 12.5 }}
              >
                Add Cc / Bcc
              </Button>
            )}

            <TextField
              fullWidth size="small" required label="Subject"
              value={subject} onChange={(e) => setSubject(e.target.value)}
            />

            <TextField
              fullWidth size="small" required multiline minRows={9} label="Message"
              value={body} onChange={(e) => setBody(e.target.value)}
            />

            {invalid.length > 0 && (
              <Alert severity="warning" sx={{ fontSize: 12.5 }}>
                Check these addresses: {invalid.join(", ")}
              </Alert>
            )}

            <Typography sx={{ fontSize: 11, color: tokens.text3 }}>
              Sent from your organisation's KOS mailbox. Replies come back to you.
            </Typography>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" color="inherit" onClick={onClose} disabled={sending}>
          {sent ? "Done" : "Cancel"}
        </Button>
        {!sent && (
          <Button
            size="small"
            variant="contained"
            onClick={submit}
            disabled={!canSend || sending}
            startIcon={sending ? <CircularProgress size={14} /> : <SendRoundedIcon sx={{ fontSize: 16 }} />}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
