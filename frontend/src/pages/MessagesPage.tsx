import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, IconButton, InputBase, Menu, MenuItem, Paper, Snackbar,
  Stack, Tooltip, Typography, useMediaQuery, useTheme,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import MapsUgcRoundedIcon from "@mui/icons-material/MapsUgcRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";

import {
  announceMessagesChanged, deleteConversation, deleteMessage, directory, editMessage,
  listConversations, listMessages, markThreadRead, sendMessage,
  type Conversation, type DirectMessage,
} from "../features/messages/messagesApi";
import MessagePersonDialog, { initialsOf } from "../features/messages/MessagePersonDialog";
import Pager, { usePaged } from "../components/Pager";
import { tokens, monoFont } from "../theme";

const LIST_POLL_MS = 15000;
const THREAD_POLL_MS = 8000;

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function listStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? clockTime(iso) : dayLabel(iso);
}

export default function MessagesPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const activeId = id ? Number(id) : null;
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down("md"));

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("");
  const [canStart, setCanStart] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<DirectMessage | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; message: DirectMessage } | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<DirectMessage | null>(null);
  const [threadMenu, setThreadMenu] = useState<HTMLElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSeenId = useRef<number | null>(null);

  const loadConversations = useCallback(
    () => listConversations().then(setConversations).catch(() => setConversations([])),
    [],
  );

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { directory().then((d) => setCanStart(d.can_start)).catch(() => {}); }, []);

  // The list refreshes on a slow timer so a message arriving in another thread
  // shows up without a reload.
  useEffect(() => {
    const t = window.setInterval(loadConversations, LIST_POLL_MS);
    return () => window.clearInterval(t);
  }, [loadConversations]);

  const active = useMemo(
    () => (conversations ?? []).find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // Opening a thread marks the other side's lines read, which is also what
  // clears the sidebar badge.
  const loadThread = useCallback((conversationId: number, markRead: boolean) => {
    return listMessages(conversationId)
      .then((rows) => {
        setMessages(rows);
        if (markRead && rows.some((m) => !m.mine && !m.read_at)) {
          return markThreadRead(conversationId).then(() => {
            setConversations((cs) => (cs ?? []).map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)));
            announceMessagesChanged();
          });
        }
      })
      .catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    if (activeId === null) { setMessages(null); return; }
    setMessages(null);
    lastSeenId.current = null;
    setDraft("");
    setEditing(null);
    setError("");
    loadThread(activeId, true);
  }, [activeId, loadThread]);

  useEffect(() => {
    if (activeId === null) return;
    const t = window.setInterval(() => loadThread(activeId, true), THREAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [activeId, loadThread]);

  // Jump to the newest line whenever one arrives — but not on every poll, or
  // the view would fight anyone scrolling back through history.
  useEffect(() => {
    const newest = messages && messages.length ? messages[messages.length - 1].id : null;
    if (newest !== null && newest !== lastSeenId.current) {
      lastSeenId.current = newest;
      const el = scrollRef.current;
      if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [messages]);

  // The composer doubles as the edit box: while `editing` is set, the same
  // field and send button correct that message instead of adding a new one.
  const send = () => {
    const body = draft.trim();
    if (!body || activeId === null || sending) return;
    setSending(true);

    if (editing) {
      const id = editing.id;
      editMessage(id, body)
        .then((m) => {
          setDraft("");
          setEditing(null);
          setMessages((rows) => (rows ?? []).map((r) => (r.id === id ? m : r)));
          loadConversations();
        })
        .catch((e) => setError(e?.response?.data?.detail ?? "Could not save that edit."))
        .finally(() => setSending(false));
      return;
    }

    sendMessage(activeId, body)
      .then((m) => {
        setDraft("");
        setMessages((rows) => [...(rows ?? []), m]);
        loadConversations();
      })
      .catch(() => setError("Could not send that message."))
      .finally(() => setSending(false));
  };

  const startEditing = (m: DirectMessage) => {
    setMenu(null);
    setEditing(m);
    setDraft(m.body);
  };

  const cancelEditing = () => { setEditing(null); setDraft(""); };

  const doDeleteMessage = () => {
    const m = confirmMessage;
    if (!m) return;
    setConfirmMessage(null);
    if (editing?.id === m.id) cancelEditing();
    deleteMessage(m.id)
      .then((tomb) => {
        setMessages((rows) => (rows ?? []).map((r) => (r.id === tomb.id ? tomb : r)));
        loadConversations();
        announceMessagesChanged();
      })
      .catch(() => setError("Could not delete that message."));
  };

  const doDeleteConversation = () => {
    if (activeId === null) return;
    setConfirmClear(false);
    setThreadMenu(null);
    deleteConversation(activeId)
      .then(() => {
        announceMessagesChanged();
        return loadConversations();
      })
      .then(() => navigate("/messages"))
      .catch(() => setError("Could not delete that conversation."));
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = conversations ?? [];
    if (!q) return rows;
    return rows.filter(
      (c) => c.other.name.toLowerCase().includes(q) || (c.last_message?.body ?? "").toLowerCase().includes(q),
    );
  }, [conversations, filter]);
  const shownPaged = usePaged(shown, 20);

  // Below md there is only room for one pane, so the thread replaces the list.
  const showList = !isNarrow || activeId === null;
  const showThread = !isNarrow || activeId !== null;

  const listPane = (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%",
      borderRight: isNarrow ? "none" : `1px solid ${tokens.line}`, bgcolor: tokens.surface }}>
      <Box sx={{ px: 2, pt: 2, pb: 1.25 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="h1" sx={{ fontSize: 22 }}>Messages</Typography>
          {canStart && (
            <Tooltip title="New message">
              <IconButton size="small" onClick={() => setComposeOpen(true)}
                sx={{ bgcolor: tokens.kriyaWash, color: tokens.kriyaInk, "&:hover": { bgcolor: "#D7EBEF" } }}>
                <MapsUgcRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}
          sx={{ px: 1.25, py: 0.6, borderRadius: "9px", bgcolor: tokens.paper, border: `1px solid ${tokens.line}` }}>
          <SearchRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} />
          <InputBase value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Search conversations" sx={{ fontSize: 13.5, flex: 1 }} />
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {conversations === null && (
          <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={22} /></Stack>
        )}
        {conversations !== null && shown.length === 0 && (
          <Box sx={{ px: 3, py: 5, textAlign: "center" }}>
            <ForumRoundedIcon sx={{ fontSize: 34, color: tokens.text3, mb: 1 }} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: tokens.text2 }}>
              {filter ? "No matches" : "No conversations yet"}
            </Typography>
            {!filter && (
              <Typography sx={{ fontSize: 12.5, color: tokens.text3, mt: 0.5 }}>
                {canStart
                  ? "Start one with the pencil button above."
                  : "A message from Management will appear here."}
              </Typography>
            )}
          </Box>
        )}
        {shownPaged.pageItems.map((c) => {
          const on = c.id === activeId;
          return (
            <Stack key={c.id} direction="row" spacing={1.25} alignItems="center"
              onClick={() => navigate(`/messages/${c.id}`)}
              sx={{ px: 2, py: 1.25, cursor: "pointer", borderBottom: `1px solid ${tokens.line}`,
                bgcolor: on ? tokens.kriyaWash : "transparent",
                borderLeft: `3px solid ${on ? tokens.kriya : "transparent"}`,
                "&:hover": { bgcolor: on ? tokens.kriyaWash : tokens.paper } }}>
              <Avatar sx={{ width: 38, height: 38, flexShrink: 0, fontSize: 14,
                bgcolor: on ? tokens.kriya : tokens.kriyaInk }}>
                {initialsOf(c.other.name)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="baseline" spacing={1}>
                  <Typography noWrap sx={{ flex: 1, fontSize: 13.5, fontWeight: c.unread ? 700 : 600, color: tokens.text }}>
                    {c.other.name}
                  </Typography>
                  <Typography sx={{ fontFamily: monoFont, fontSize: 10, color: tokens.text3, flexShrink: 0 }}>
                    {listStamp(c.last_message_at)}
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.15 }}>
                  <Typography noWrap sx={{ flex: 1, fontSize: 12, color: c.unread ? tokens.text : tokens.text3,
                    fontWeight: c.unread ? 600 : 400,
                    fontStyle: c.last_message?.deleted ? "italic" : "normal" }}>
                    {!c.last_message
                      ? "No messages yet"
                      : c.last_message.deleted
                        ? "This message was deleted"
                        : `${c.last_message.mine ? "You: " : ""}${c.last_message.body}`}
                  </Typography>
                  {c.unread > 0 && (
                    <Box sx={{ minWidth: 18, height: 18, px: 0.5, borderRadius: 9, flexShrink: 0,
                      bgcolor: tokens.attn, color: "#fff", fontSize: 10.5, fontWeight: 700,
                      display: "grid", placeItems: "center" }}>
                      {c.unread}
                    </Box>
                  )}
                </Stack>
              </Box>
            </Stack>
          );
        })}
        <Pager page={shownPaged.page} pageCount={shownPaged.pageCount} total={shownPaged.total}
          onPrev={shownPaged.prev} onNext={shownPaged.next} unit="conversations" />
      </Box>
    </Box>
  );

  const threadPane = (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", bgcolor: tokens.paper }}>
      {active === null ? (
        <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ flex: 1, px: 4, textAlign: "center" }}>
          <ForumRoundedIcon sx={{ fontSize: 44, color: tokens.text3 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: tokens.text2 }}>
            {activeId === null ? "Pick a conversation" : "Conversation not found"}
          </Typography>
          <Typography sx={{ fontSize: 13, color: tokens.text3, maxWidth: 320 }}>
            Messages here are private between the two of you — they aren't part of any project record.
          </Typography>
        </Stack>
      ) : (
        <>
          {/* header */}
          <Stack direction="row" alignItems="center" spacing={1.25}
            sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${tokens.line}`, bgcolor: tokens.surface, flexShrink: 0 }}>
            {isNarrow && (
              <IconButton size="small" onClick={() => navigate("/messages")} aria-label="Back to conversations">
                <ArrowBackRoundedIcon sx={{ fontSize: 19 }} />
              </IconButton>
            )}
            <Avatar sx={{ width: 34, height: 34, fontSize: 13, bgcolor: tokens.kriyaInk }}>
              {initialsOf(active.other.name)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 700, color: tokens.ink }}>
                {active.other.name}
              </Typography>
              <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>
                {active.other.role || active.other.email}
              </Typography>
            </Box>
            <Tooltip title="Conversation options">
              <IconButton size="small" aria-label="Conversation options"
                onClick={(e) => setThreadMenu(e.currentTarget)}>
                <MoreVertRoundedIcon sx={{ fontSize: 19, color: tokens.text3 }} />
              </IconButton>
            </Tooltip>
          </Stack>

          {/* thread */}
          <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, py: 2 }}>
            {messages === null && (
              <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={22} /></Stack>
            )}
            {messages !== null && messages.length === 0 && (
              <Typography sx={{ textAlign: "center", fontSize: 13, color: tokens.text3, py: 4 }}>
                No messages yet — say something.
              </Typography>
            )}
            <Stack spacing={0.5}>
              {(messages ?? []).map((m, i) => {
                const prev = (messages ?? [])[i - 1];
                const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
                return (
                  <Box key={m.id}>
                    {newDay && (
                      <Stack alignItems="center" sx={{ my: 1.5 }}>
                        <Box sx={{ px: 1.25, py: 0.3, borderRadius: 9, bgcolor: tokens.surface,
                          border: `1px solid ${tokens.line}`, fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>
                          {dayLabel(m.created_at)}
                        </Box>
                      </Stack>
                    )}
                    <Stack direction="row" alignItems="center" spacing={0.5}
                      justifyContent={m.mine ? "flex-end" : "flex-start"}
                      // The actions button is revealed by hovering the row on a
                      // desktop; on touch there is no hover, so it just stays put.
                      sx={{ "&:hover .msg-actions": { opacity: 1 } }}>
                      {m.mine && !m.deleted && (
                        <IconButton size="small" className="msg-actions" aria-label="Message actions"
                          onClick={(e) => setMenu({ el: e.currentTarget, message: m })}
                          sx={{ order: -1, opacity: isNarrow ? 1 : 0, transition: "opacity .12s",
                            "&:focus-visible": { opacity: 1 } }}>
                          <MoreVertRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                        </IconButton>
                      )}
                      <Paper elevation={0}
                        sx={{ maxWidth: "min(78%, 560px)", px: 1.5, py: 1, borderRadius: "12px",
                          border: `1px solid ${m.deleted ? tokens.line : m.mine ? "transparent" : tokens.line}`,
                          borderTopRightRadius: m.mine ? "4px" : "12px",
                          borderTopLeftRadius: m.mine ? "12px" : "4px",
                          bgcolor: m.deleted ? "transparent" : m.mine ? tokens.kriya : tokens.surface,
                          color: m.deleted ? tokens.text3 : m.mine ? "#fff" : tokens.text,
                          outline: editing?.id === m.id ? `2px solid ${tokens.kriyaGlow}` : "none",
                          outlineOffset: 2 }}>
                        {m.deleted ? (
                          <Stack direction="row" alignItems="center" spacing={0.6}>
                            <BlockRoundedIcon sx={{ fontSize: 14 }} />
                            <Typography sx={{ fontSize: 13, fontStyle: "italic" }}>
                              {m.mine ? "You deleted this message" : "This message was deleted"}
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography sx={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {m.body}
                          </Typography>
                        )}
                        <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.4} sx={{ mt: 0.35 }}>
                          {m.edited_at && !m.deleted && (
                            <Typography sx={{ fontSize: 9.5, fontStyle: "italic",
                              color: m.mine ? "rgba(255,255,255,.75)" : tokens.text3 }}>
                              edited
                            </Typography>
                          )}
                          <Typography sx={{ fontFamily: monoFont, fontSize: 9.5,
                            color: m.deleted ? tokens.text3 : m.mine ? "rgba(255,255,255,.75)" : tokens.text3 }}>
                            {clockTime(m.created_at)}
                          </Typography>
                          {m.mine && !m.deleted && (m.read_at
                            ? <DoneAllRoundedIcon sx={{ fontSize: 13, color: "#BFF0F6" }} />
                            : <CheckRoundedIcon sx={{ fontSize: 13, color: "rgba(255,255,255,.65)" }} />)}
                        </Stack>
                      </Paper>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {/* composer — also the edit box while `editing` is set */}
          <Box sx={{ borderTop: `1px solid ${tokens.line}`, bgcolor: tokens.surface, flexShrink: 0 }}>
            {editing && (
              <Stack direction="row" alignItems="center" spacing={1}
                sx={{ px: 1.75, pt: 1.25, pb: 0.25 }}>
                <EditRoundedIcon sx={{ fontSize: 15, color: tokens.kriyaInk }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: tokens.kriyaInk }}>
                    Editing message
                  </Typography>
                  <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>
                    {editing.body}
                  </Typography>
                </Box>
                <Tooltip title="Cancel edit">
                  <IconButton size="small" onClick={cancelEditing} aria-label="Cancel edit">
                    <CloseRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
            <Stack direction="row" alignItems="flex-end" spacing={1} sx={{ p: 1.5, pt: editing ? 1 : 1.5 }}>
              <Box sx={{ flex: 1, px: 1.5, py: 1, borderRadius: "12px", bgcolor: tokens.paper,
                border: `1px solid ${editing ? tokens.kriyaGlow : tokens.line}`, maxHeight: 160, overflowY: "auto" }}>
                <InputBase
                  multiline maxRows={6} fullWidth value={draft}
                  placeholder={editing ? "Edit your message…" : "Type a message…"}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                    if (e.key === "Escape" && editing) { e.preventDefault(); cancelEditing(); }
                  }}
                  sx={{ fontSize: 13.5 }}
                />
              </Box>
              <Button variant="contained" onClick={send} disabled={!draft.trim() || sending}
                sx={{ minWidth: 0, width: 42, height: 42, borderRadius: "50%", p: 0, flexShrink: 0 }}>
                {sending ? <CircularProgress size={16} color="inherit" />
                  : editing ? <CheckRoundedIcon sx={{ fontSize: 20 }} />
                  : <SendRoundedIcon sx={{ fontSize: 19 }} />}
              </Button>
            </Stack>
          </Box>
        </>
      )}
    </Box>
  );

  return (
    <>
      {/* The shell hands each page a scrollable pane; this one instead fills it
          exactly and scrolls its two columns independently, so the composer
          stays pinned to the bottom the way a chat window should. */}
      <Box sx={{ height: "100%", display: "grid", minHeight: 0,
        gridTemplateColumns: isNarrow ? "1fr" : "320px 1fr" }}>
        {showList && listPane}
        {showThread && threadPane}
      </Box>

      <MessagePersonDialog open={composeOpen} onClose={() => setComposeOpen(false)}
        onSent={(conversationId) => { loadConversations(); navigate(`/messages/${conversationId}`); }} />

      {/* per-message actions */}
      <Menu anchorEl={menu?.el ?? null} open={menu !== null} onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <MenuItem disabled={!menu?.message.can_edit}
          onClick={() => menu && startEditing(menu.message)}>
          <EditRoundedIcon sx={{ fontSize: 17, mr: 1.25, color: tokens.text2 }} />
          <Box>
            <Typography sx={{ fontSize: 13.5 }}>Edit</Typography>
            {menu && !menu.message.can_edit && (
              // Explaining the greyed-out row beats leaving the sender to guess
              // why the option they used ten minutes ago has stopped working.
              <Typography sx={{ fontSize: 11, color: tokens.text3 }}>
                Too old to edit — send a follow-up
              </Typography>
            )}
          </Box>
        </MenuItem>
        <MenuItem onClick={() => { setConfirmMessage(menu?.message ?? null); setMenu(null); }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 17, mr: 1.25, color: tokens.attn }} />
          <Typography sx={{ fontSize: 13.5, color: tokens.attn }}>Delete</Typography>
        </MenuItem>
      </Menu>

      {/* conversation actions */}
      <Menu anchorEl={threadMenu} open={threadMenu !== null} onClose={() => setThreadMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem onClick={() => { setConfirmClear(true); setThreadMenu(null); }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 17, mr: 1.25, color: tokens.attn }} />
          <Typography sx={{ fontSize: 13.5, color: tokens.attn }}>Delete conversation</Typography>
        </MenuItem>
      </Menu>

      <Dialog open={confirmMessage !== null} onClose={() => setConfirmMessage(null)}
        PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17 }}>
          Delete this message?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13.5 }}>
            The text is removed for both of you and can't be recovered. The thread will
            show that a message was deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmMessage(null)} sx={{ color: tokens.text2 }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={doDeleteMessage}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}
        PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17 }}>
          Delete this conversation?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13.5 }}>
            It's removed from <b>your</b> list only — {active?.other.name ?? "the other person"} keeps
            their copy. If they write again, the thread comes back with just the new messages.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmClear(false)} sx={{ color: tokens.text2 }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={doDeleteConversation}>Delete for me</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="error" onClose={() => setError("")} sx={{ fontSize: 13 }}>{error}</Alert>
      </Snackbar>
    </>
  );
}
