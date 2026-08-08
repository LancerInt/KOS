/**
 * A heading you can rename where it stands.
 *
 * Used for the workspace title and the project title. Editing happens in place
 * rather than in a dialog because the heading *is* the thing being changed —
 * a modal would cover the page whose name is in question, and the surrounding
 * breadcrumb is what gives a bare name like "ABC" its meaning.
 *
 * The section drawer has its own variant of this: it edits a name and a
 * description together inside a fixed-width panel, so its layout differs enough
 * that sharing one component would mean a prop for every difference.
 */
import { useState } from "react";
import { Box, Button, IconButton, Stack, TextField, Typography } from "@mui/material";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { tokens } from "../../theme";

export function InlineRename({
  value, label, fontSize = 26, subtitle, onSave,
}: {
  value: string;
  /** Field label while editing — "Workspace name", "Project name". */
  label: string;
  fontSize?: number;
  subtitle?: React.ReactNode;
  /** Rejects with a message to show inline. Omit to render a plain heading. */
  onSave?: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const start = () => { setDraft(value); setErr(""); setEditing(true); };
  const cancel = () => { setEditing(false); setErr(""); };

  const save = async () => {
    const next = draft.trim();
    if (!next || busy || !onSave) return;
    if (next === value.trim()) { cancel(); return; }   // nothing to send
    setBusy(true);
    setErr("");
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Could not rename this.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="flex-start" spacing={1}>
          <TextField
            size="small" label={label} value={draft} autoFocus fullWidth disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
          />
          <Button size="small" variant="contained" onClick={save} disabled={busy || !draft.trim()}
            startIcon={<CheckRoundedIcon sx={{ fontSize: 16 }} />} sx={{ mt: 0.25, flexShrink: 0 }}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button size="small" onClick={cancel} disabled={busy} sx={{ mt: 0.25, flexShrink: 0 }}>
            Cancel
          </Button>
        </Stack>
        {err && <Typography sx={{ fontSize: 12, color: tokens.attn, mt: 0.5 }}>{err}</Typography>}
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minWidth: 0, "&:hover .inline-rename": { opacity: 1 } }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="h1" sx={{ fontSize, lineHeight: 1.2 }}>{value}</Typography>
        {onSave && (
          <IconButton className="inline-rename" size="small" title={`Rename — ${label.toLowerCase()}`}
            onClick={start}
            sx={{ opacity: 0, transition: "opacity .14s", color: tokens.text3, flexShrink: 0,
              "&:hover": { color: tokens.kriyaInk } }}>
            <EditRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Stack>
      {subtitle}
    </Box>
  );
}
