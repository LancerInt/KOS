import { Children, useState, type ReactNode } from "react";
import {
  Alert,
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

import { tokens } from "../../theme";
import { aiErrorMessage, type AiOutcome } from "./aiApi";
import { useAiAssistant } from "./AiContext";
import AiResultView from "./AiResultView";

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
  iconOnly = false,
}: AiActionButtonProps) {
  const { status } = useAiAssistant();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<AiOutcome<object> | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

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
              {fields!.map((field) => (
                <TextField
                  key={field.name}
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
          {apply && outcome && !loading && !error && (
            <Button size="small" variant="contained" onClick={doApply} disabled={applying}>
              {applying ? "Applying…" : apply.label}
            </Button>
          )}
        </DialogActions>
      </Dialog>
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
