import { useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, ClickAwayListener, Paper, Popper, Stack, TextField, Typography } from "@mui/material";

import { tokens } from "../../theme";

export interface MentionPerson { id: number; name: string; }

/**
 * A comment box with inline @mentions. Typing "@" opens a people picker filtered
 * by what follows it; choosing someone inserts "@Their Name" and remembers their
 * id. On submit we send the body plus the ids whose "@name" is still present, so
 * deleting the text also drops the mention.
 */
export default function MentionComposer({
  people, onSubmit, disabled, placeholder = "Add a comment…  (type @ to mention)",
}: {
  people: MentionPerson[];
  onSubmit: (body: string, mentionIds: number[]) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null); // null = picker closed
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // The "@token" immediately before the caret, if any.
  const tokenBeforeCaret = (value: string, caret: number): string | null => {
    const upto = value.slice(0, caret);
    const m = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(upto);
    return m ? m[2] : null;
  };

  const onChange = (value: string, caret: number) => {
    setText(value);
    const tok = tokenBeforeCaret(value, caret);
    setQuery(tok);
    setHighlight(0);
  };

  const matches = query === null
    ? []
    : people
        .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6);

  const choose = (p: MentionPerson) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}._-]*)$/u, `@${p.name} `);
    const after = text.slice(caret);
    const next = before + after;
    setText(next);
    setPicked((m) => new Map(m).set(p.id, p.name));
    setQuery(null);
    // Restore focus and drop the caret after the inserted mention.
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length;
      try { el?.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    const ids = [...picked.entries()].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
    void onSubmit(body, ids);
    setText("");
    setPicked(new Map());
    setQuery(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (query !== null && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[highlight]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    // Ctrl/⌘+Enter posts.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          inputRef={inputRef}
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          size="small" fullWidth multiline maxRows={5} disabled={disabled}
        />
        <Button variant="contained" onClick={submit} disabled={disabled || !text.trim()} sx={{ flexShrink: 0 }}>
          Post
        </Button>
      </Stack>

      <Popper open={query !== null && matches.length > 0} anchorEl={inputRef.current} placement="top-start" sx={{ zIndex: 1500 }}>
        <ClickAwayListener onClickAway={() => setQuery(null)}>
          <Paper sx={{ mb: 0.5, py: 0.5, minWidth: 220, boxShadow: "0 6px 20px rgba(20,22,29,.14)" }}>
            {matches.map((p, i) => (
              <Box key={p.id} onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                sx={{ px: 1.5, py: 0.75, cursor: "pointer", fontSize: 13,
                  bgcolor: i === highlight ? tokens.kriyaWash : "transparent",
                  "&:hover": { bgcolor: tokens.kriyaWash } }}>
                {p.name}
              </Box>
            ))}
          </Paper>
        </ClickAwayListener>
      </Popper>

      {picked.size > 0 && (
        <Typography sx={{ fontSize: 11, color: tokens.text3, mt: 0.5 }}>
          Ctrl/⌘+Enter to post · mentions notify the person
        </Typography>
      )}
    </Box>
  );
}

/** Render a comment body with any "@Name" (for the given mentioned names) shown in brand colour. */
export function renderWithMentions(body: string, names: string[]) {
  const clean = names.filter(Boolean);
  if (!clean.length) return body;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(?:${clean.map(esc).join("|")})`, "g");
  const out: (string | JSX.Element)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(<b key={m.index} style={{ color: tokens.kriyaInk }}>{m[0]}</b>);
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}
