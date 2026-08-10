import { Children, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";

import { tokens } from "../../theme";
import { aiErrorMessage, type AiOutcome } from "./aiApi";
import { useAiAssistant } from "./AiContext";
import AiResultView from "./AiResultView";
import MicButton from "./MicButton";
import SendEmailDialog from "./SendEmailDialog";
import { appendSpoken } from "./dictation";

/**
 * The "✨ …" buttons that appear throughout the ERP.
 *
 * Every AI action in KOS is: click → run → review the result → optionally apply
 * it. That flow is implemented once here so no screen invents its own loading,
 * error or apply behaviour, and so **nothing is ever written to the ERP without
 * the user seeing it first**.
 */

/** Flatten a result to plain text for the clipboard. */
export function outcomeToText(outcome: AiOutcome<object>): string {
  if (!outcome.structured) return outcome.text;

  const data = outcome.data as Record<string, unknown>;
  const lines: string[] = [];

  const push = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      lines.push(label ? `${label}\n${value}` : value);
    } else if (Array.isArray(value) && value.length) {
      const items = value
        .map((item) =>
          typeof item === "string"
            ? item
            : [
                (item as Record<string, unknown>)?.title,
                (item as Record<string, unknown>)?.action,
                (item as Record<string, unknown>)?.heading,
                (item as Record<string, unknown>)?.content,
                (item as Record<string, unknown>)?.detail,
              ]
                .filter(Boolean)
                .join(" — "),
        )
        .filter(Boolean);
      if (items.length) lines.push(`${label}\n${items.map((i) => `- ${i}`).join("\n")}`);
    }
  };

  // Email drafts are the most-copied output, so keep them first and verbatim.
  if (data.subject || data.body) {
    push("", `Subject: ${data.subject ?? ""}`);
    push("", String(data.body ?? ""));
  }
  push("", data.text);
  push("", data.headline);
  push("", data.summary ?? data.executive_summary ?? data.explanation);
  push("Key points:", data.key_points);
  push("Decisions:", data.decisions);
  push("Risks:", data.risks);
  push("Insights:", data.insights);
  push("Action items:", data.action_items);
  push("Recommendations:", data.recommendations);
  push("Next actions:", data.next_actions);
  push("", data.sections);

  return lines.join("\n\n").trim() || outcome.text;
}

export interface AiApplyAction {
  label: string;
  /** Return false to keep the dialog open (e.g. validation failed). */
  onApply: (outcome: AiOutcome<object>) => Promise<boolean | void> | boolean | void;
}

/**
 * Offer to send the result as an email.
 *
 * Opt-in rather than inferred from the result's shape: several actions happen
 * to produce a `subject` and a `body`, and only the screen knows which of them
 * are meant to leave the building.
 */
export interface AiEmailAction {
  /**
   * Pre-fills the To field — a customer's address, say. When omitted, a
   * collected input field named `to` is used instead, so a screen can ask for
   * the address up front without wiring any state of its own.
   */
  defaultTo?: string;
  projectId?: number;
  taskId?: number;
}

/** An input collected before the action runs — e.g. the customer's message. */
export interface AiInputField {
  name: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  defaultValue?: string;
}

interface AiActionButtonProps {
  label: string;
  /** Receives the collected `fields` values; ignore the argument when there are none. */
  run: (values: Record<string, string>) => Promise<AiOutcome<object>>;
  /** When present, the dialog collects these before running. */
  fields?: AiInputField[];
  /** Dialog heading; defaults to the button label. */
  title?: string;
  icon?: ReactNode;
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium";
  disabled?: boolean;
  disabledReason?: string;
  apply?: AiApplyAction;
  /** Offer "Send email…" on the result. See {@link AiEmailAction}. */
  email?: AiEmailAction;
  /** Render as an icon-only button — used in dense toolbars. */
  iconOnly?: boolean;
}

export default function AiActionButton({
  label,
  run,
  fields,
  title,
  icon,
  variant = "outlined",
  size = "small",
  disabled = false,
  disabledReason,
  apply,
  email,
  iconOnly = false,
}: AiActionButtonProps) {
  const { status } = useAiAssistant();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<AiOutcome<object> | null>(null);
  const [error, setError] = useState("");
  const [micError, setMicError] = useState("");
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [composing, setComposing] = useState(false);

  // The draft to send. A result with neither a subject nor a body is not an
  // email however the screen labelled it, so Send stays hidden for it.
  const draft = outcome?.structured ? (outcome.data as Record<string, unknown>) : null;
  const canSendEmail =
    Boolean(email) && Boolean(draft && (draft.subject || draft.body)) && !loading && !error;

  const aiOff = status ? !status.enabled : false;
  const isDisabled = disabled || aiOff;
  const reason = aiOff ? "AI features are switched off for this system." : disabledReason;

  // Actions with inputs open on a form; the rest run straight away.
  const needsInput = Boolean(fields?.length) && !outcome && !loading;

  const execute = async (collected: Record<string, string>) => {
    setLoading(true);
    setError("");
    setOutcome(null);
    setCopied(false);
    try {
      setOutcome(await run(collected));
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const start = async () => {
    setOpen(true);
    setOutcome(null);
    setError("");
    setCopied(false);
    if (fields?.length) {
      setValues(Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ""])));
      return; // wait for the user to fill the form
    }
    await execute({});
  };

  const missingRequired = (fields ?? []).some((f) => f.required && !(values[f.name] ?? "").trim());

  const copy = async () => {
    if (!outcome) return;
    try {
      await navigator.clipboard.writeText(outcomeToText(outcome));
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the text is on screen either way.
    }
  };

  const doApply = async () => {
    if (!apply || !outcome) return;
    setApplying(true);
    try {
      const result = await apply.onApply(outcome);
      if (result !== false) setOpen(false);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const trigger = iconOnly ? (
    <IconButton size="small" onClick={start} disabled={isDisabled} aria-label={label}>
      {icon ?? <AutoAwesomeRoundedIcon sx={{ fontSize: 18 }} />}
    </IconButton>
  ) : (
    <Button
      size={size}
      variant={variant}
      onClick={start}
      disabled={isDisabled}
      startIcon={icon ?? <AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />}
      sx={{ whiteSpace: "nowrap" }}
    >
      {label}
    </Button>
  );

  return (
    <>
      {reason ? <Tooltip title={reason}><span>{trigger}</span></Tooltip> : trigger}

      <Dialog
        open={open}
        onClose={() => !applying && setOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: "6px" } }}
      >
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600 }}>
          {title ?? label}
        </DialogTitle>

        <DialogContent sx={{ minHeight: 150 }}>
          {needsInput && !error && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {/* Dictation trouble gets its own slot rather than `error`: that
                  one replaces the whole form, and losing a half-typed brief
                  because a microphone hiccuped would be its own bug. */}
              {micError && (
                <Alert severity="warning" onClose={() => setMicError("")} sx={{ fontSize: 12.5 }}>
                  {micError}
                </Alert>
              )}
              {/* This dialog backs every AI action across projects, tasks, CRM
                  and HR, so a mic here reaches all of them at once. Only the
                  long-form fields get one — dictating a one-line title is
                  slower than typing it. */}
              {fields!.map((field) => (
                <Stack key={field.name} direction="row" alignItems="flex-start" spacing={0.5}>
                  <TextField
                    fullWidth
                    size="small"
                    label={field.label}
                    placeholder={field.placeholder}
                    required={field.required}
                    multiline={field.multiline}
                    minRows={field.multiline ? 4 : undefined}
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  />
                  {field.multiline && (
                    <Box sx={{ pt: 0.5 }}>
                      <MicButton
                        onText={(text) => setValues((prev) => ({
                          ...prev, [field.name]: appendSpoken(prev[field.name] ?? "", text),
                        }))}
                        disabled={loading}
                        hint={`Dictate ${field.label.toLowerCase()}`}
                        onError={setMicError}
                      />
                    </Box>
                  )}
                </Stack>
              ))}
            </Stack>
          )}

          {loading && (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 4 }}>
              <CircularProgress size={26} />
              <Typography sx={{ fontSize: 13, color: tokens.text2 }}>Thinking…</Typography>
            </Stack>
          )}

          {!loading && error && <Alert severity="error">{error}</Alert>}

          {!loading && !error && outcome && (
            <Stack spacing={2}>
              {status?.offline_fallback && (
                <Alert severity="info" sx={{ fontSize: 12.5 }}>
                  No provider API key is configured, so this is placeholder output from the offline
                  provider. Add a key in AI settings for real analysis.
                </Alert>
              )}
              <AiResultView outcome={outcome} />
              <Typography sx={{ fontSize: 11, color: tokens.text3 }}>
                Generated by {outcome.provider}
                {outcome.model && ` · ${outcome.model}`}. Review before acting on it.
              </Typography>
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          {outcome && !loading && (
            <Button size="small" color="inherit" onClick={copy} sx={{ mr: "auto" }}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {outcome && !loading && !error && (
            <Button size="small" color="inherit" onClick={() => execute(values)}>
              Regenerate
            </Button>
          )}
          <Button size="small" color="inherit" onClick={() => setOpen(false)} disabled={applying}>
            Close
          </Button>
          {needsInput && !error && (
            <Button size="small" variant="contained" onClick={() => execute(values)} disabled={missingRequired}>
              Generate
            </Button>
          )}
          {canSendEmail && (
            <Button
              size="small"
              variant={apply ? "outlined" : "contained"}
              onClick={() => setComposing(true)}
              startIcon={<SendRoundedIcon sx={{ fontSize: 16 }} />}
            >
              Send email…
            </Button>
          )}
          {apply && outcome && !loading && !error && (
            <Button size="small" variant="contained" onClick={doApply} disabled={applying}>
              {applying ? "Applying…" : apply.label}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Composing sits on top of the result so the draft stays readable behind
          it, and closing the compose window returns to the draft rather than
          throwing away a generation the user has already paid for. */}
      {email && (
        <SendEmailDialog
          open={composing}
          onClose={() => setComposing(false)}
          subject={String(draft?.subject ?? "")}
          body={String(draft?.body ?? outcome?.text ?? "")}
          to={email.defaultTo ?? values.to ?? ""}
          draftLogId={outcome?.log_id}
          projectId={email.projectId}
          taskId={email.taskId}
          onSent={() => {
            // Sent is the end of this flow — leaving the draft open invites a
            // second send of a message that has already gone.
            setComposing(false);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * A row of AI buttons.
 *
 * Beyond `max` the rest collapse into a "More" menu — eight buttons in a page
 * header out-shouts the page itself, however quietly they are styled.
 */
export function AiActionBar({ children, max = 5 }: { children: ReactNode; max?: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items = Children.toArray(children);
  const visible = items.length > max ? items.slice(0, max) : items;
  const overflow = items.length > max ? items.slice(max) : [];

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      {visible}
      {overflow.length > 0 && (
        <>
          <Button
            size="small"
            color="inherit"
            onClick={(e) => setAnchor(e.currentTarget)}
            endIcon={<ExpandMoreRoundedIcon sx={{ fontSize: 16 }} />}
            sx={{ whiteSpace: "nowrap" }}
          >
            More
          </Button>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {overflow.map((item, index) => (
              // Each child is a self-contained button; the menu row is just its holder.
              <MenuItem key={index} onClick={() => setAnchor(null)} sx={{ py: 0.75 }}>
                {item}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Stack>
  );
}
