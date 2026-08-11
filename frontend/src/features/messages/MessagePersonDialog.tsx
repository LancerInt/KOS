import { useEffect, useMemo, useState } from "react";
import {
  Alert, Autocomplete, Avatar, Box, Button, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Stack, TextField, Typography,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";

import { announceMessagesChanged, directory, startConversation, type Person } from "./messagesApi";
import { tokens } from "../../theme";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selected recipient. Omit to let the sender pick from the directory. */
  person?: Person | null;
  /** Called with the thread id once the message is away. */
  onSent?: (conversationId: number) => void;
}

/**
 * Write one person a message. Used from the Messages page ("New message") and
 * from anywhere else that has a colleague on screen.
 */
export default function MessagePersonDialog({ open, onClose, person = null, onSent }: Props) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [canStart, setCanStart] = useState(true);
  const [picked, setPicked] = useState<Person | null>(person);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Reset per opening — a dialog that remembers last time's draft recipient is
  // a way to send the wrong person a message.
  useEffect(() => {
    if (!open) return;
    setPicked(person);
    setBody("");
    setError("");
    if (person) return; // no picker to fill
    directory()
      .then((d) => { setPeople(d.people); setCanStart(d.can_start); })
      .catch(() => setPeople([]));
  }, [open, person]);

  const sorted = useMemo(
    () => (people ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const send = () => {
    const text = body.trim();
    if (!picked || !text || sending) return;
    setSending(true);
    setError("");
    startConversation(picked.id, text)
      .then((conv) => {
        announceMessagesChanged();
        onSent?.(conv.id);
        onClose();
      })
      .catch((e) => setError(e?.response?.data?.detail ?? "Could not send that message."))
      .finally(() => setSending(false));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
      PaperProps={{ sx: { borderRadius: "14px" } }}>
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 18, pb: 1 }}>
        New message
      </DialogTitle>
      <DialogContent sx={{ pt: "8px !important" }}>
        <Stack spacing={2}>
          {!canStart && (
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Only Management and IT Team can start a new conversation. You can still
              reply to anyone who has written to you.
            </Alert>
          )}

          {person ? (
            <Stack direction="row" spacing={1.25} alignItems="center"
              sx={{ p: 1.25, borderRadius: "10px", bgcolor: tokens.kriyaWash }}>
              <Avatar sx={{ width: 34, height: 34, bgcolor: tokens.kriyaInk, fontSize: 13 }}>
                {initialsOf(person.name)}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>{person.name}</Typography>
                {person.role && (
                  <Typography sx={{ fontSize: 12, color: tokens.text2 }} noWrap>{person.role}</Typography>
                )}
              </Box>
            </Stack>
          ) : (
            <Autocomplete
              options={sorted}
              value={picked}
              onChange={(_, v) => setPicked(v)}
              loading={people === null}
              disabled={!canStart}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderOption={(props, o) => (
                <Box component="li" {...props} key={o.id}>
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, py: 0.25 }}>
                    <Avatar sx={{ width: 28, height: 28, bgcolor: tokens.kriyaInk, fontSize: 11.5 }}>
                      {initialsOf(o.name)}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13.5 }} noWrap>{o.name}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: tokens.text3 }} noWrap>
                        {o.role || o.email}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              )}
              renderInput={(params) => (
                <TextField {...params} label="To" placeholder="Search people…" autoFocus
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {people === null && <CircularProgress size={16} />}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }} />
              )}
            />
          )}

          <TextField
            label="Message" multiline minRows={4} fullWidth autoFocus={!!person}
            placeholder="Write a personal note…"
            value={body} onChange={(e) => setBody(e.target.value)}
            // Enter sends, Shift+Enter breaks the line — the habit everyone
            // already has from every other chat box.
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />

          {error && <Alert severity="error" sx={{ fontSize: 13 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ color: tokens.text2 }}>Cancel</Button>
        <Button variant="contained" onClick={send}
          disabled={!picked || !body.trim() || sending || !canStart}
          startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendRoundedIcon sx={{ fontSize: 16 }} />}>
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
