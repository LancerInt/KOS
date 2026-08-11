import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar, Box, Button, CircularProgress, IconButton, InputBase, Paper, Stack,
  Tooltip, Typography, useMediaQuery, useTheme,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import MapsUgcRoundedIcon from "@mui/icons-material/MapsUgcRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";

import {
  announceMessagesChanged, directory, listConversations, listMessages, markThreadRead,
  sendMessage, type Conversation, type DirectMessage,
} from "../features/messages/messagesApi";
import MessagePersonDialog, { initialsOf } from "../features/messages/MessagePersonDialog";
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

  const send = () => {
    const body = draft.trim();
    if (!body || activeId === null || sending) return;
    setSending(true);
    sendMessage(activeId, body)
      .then((m) => {
        setDraft("");
        setMessages((rows) => [...(rows ?? []), m]);
        loadConversations();
      })
      .catch(() => {})
      .finally(() => setSending(false));
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = conversations ?? [];
    if (!q) return rows;
    return rows.filter(
      (c) => c.other.name.toLowerCase().includes(q) || (c.last_message?.body ?? "").toLowerCase().includes(q),
    );
  }, [conversations, filter]);

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
        {shown.map((c) => {
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
                    fontWeight: c.unread ? 600 : 400 }}>
                    {c.last_message
                      ? `${c.last_message.mine ? "You: " : ""}${c.last_message.body}`
                      : "No messages yet"}
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
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 700, color: tokens.ink }}>
                {active.other.name}
              </Typography>
              <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>
                {active.other.role || active.other.email}
              </Typography>
            </Box>
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
                    <Stack direction="row" justifyContent={m.mine ? "flex-end" : "flex-start"}>
                      <Paper elevation={0}
                        sx={{ maxWidth: "min(78%, 560px)", px: 1.5, py: 1, borderRadius: "12px",
                          border: `1px solid ${m.mine ? "transparent" : tokens.line}`,
                          borderTopRightRadius: m.mine ? "4px" : "12px",
                          borderTopLeftRadius: m.mine ? "12px" : "4px",
                          bgcolor: m.mine ? tokens.kriya : tokens.surface,
                          color: m.mine ? "#fff" : tokens.text }}>
                        <Typography sx={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {m.body}
                        </Typography>
                        <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.4} sx={{ mt: 0.35 }}>
                          <Typography sx={{ fontFamily: monoFont, fontSize: 9.5,
                            color: m.mine ? "rgba(255,255,255,.75)" : tokens.text3 }}>
                            {clockTime(m.created_at)}
                          </Typography>
                          {m.mine && (m.read_at
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

          {/* composer */}
          <Stack direction="row" alignItems="flex-end" spacing={1}
            sx={{ p: 1.5, borderTop: `1px solid ${tokens.line}`, bgcolor: tokens.surface, flexShrink: 0 }}>
            <Box sx={{ flex: 1, px: 1.5, py: 1, borderRadius: "12px", bgcolor: tokens.paper,
              border: `1px solid ${tokens.line}`, maxHeight: 160, overflowY: "auto" }}>
              <InputBase
                multiline maxRows={6} fullWidth value={draft} placeholder="Type a message…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                sx={{ fontSize: 13.5 }}
              />
            </Box>
            <Button variant="contained" onClick={send} disabled={!draft.trim() || sending}
              sx={{ minWidth: 0, width: 42, height: 42, borderRadius: "50%", p: 0, flexShrink: 0 }}>
              {sending ? <CircularProgress size={16} color="inherit" /> : <SendRoundedIcon sx={{ fontSize: 19 }} />}
            </Button>
          </Stack>
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
    </>
  );
}
