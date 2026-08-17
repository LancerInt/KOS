import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, IconButton, InputBase, Menu, MenuItem, Paper, Snackbar,
  Stack, TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import MapsUgcRoundedIcon from "@mui/icons-material/MapsUgcRounded";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import AddReactionOutlinedIcon from "@mui/icons-material/AddReactionOutlined";

import {
  announceMessagesChanged, deleteConversation, deleteGroupMessage, deleteMessage, directory,
  editGroupMessage, editMessage, leaveGroup, listConversations, listGroupMessages,
  listGroupThreads, listMessages, markGroupRead, markThreadRead, reactToDirectMessage,
  reactToGroupMessage, renameGroup, sendGroupMessage, sendMessage,
  type Conversation, type GroupThread, type MessageAttachment, type MessageReaction,
} from "../features/messages/messagesApi";
import MessagePersonDialog, { initialsOf } from "../features/messages/MessagePersonDialog";
import MessageAttachments from "../features/messages/MessageAttachments";
import GroupDialog from "../features/messages/GroupDialog";
import Pager, { usePaged } from "../components/Pager";
import { tokens, monoFont } from "../theme";

const LIST_POLL_MS = 15000;
const THREAD_POLL_MS = 8000;
const GROUP_COLOR = "#6C4FD8";

// The common shape both a DM line and a group line render as. `read_at` is a DM
// nicety (delivery/read ticks); groups don't carry it, so it's optional.
type ChatMessage = {
  id: number; sender: number; sender_name: string; mine: boolean; body: string;
  created_at: string; edited_at: string | null; deleted: boolean; can_edit: boolean;
  read_at?: string | null;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
};

const REACTION_CHOICES = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function recClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type ThreadItem = {
  kind: "dm" | "group";
  id: number;
  title: string;
  subtitle: string;
  unread: number;
  lastAt: string | null;
  subtitleDeleted: boolean;
  memberCount?: number;
};

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

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export default function MessagesPage() {
  const navigate = useNavigate();
  const { id, gid } = useParams();
  const activeKind: "dm" | "group" | null = gid ? "group" : id ? "dm" : null;
  const activeId = gid ? Number(gid) : id ? Number(id) : null;
  const isGroup = activeKind === "group";
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down("md"));

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [groups, setGroups] = useState<GroupThread[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("");
  const [canStart, setCanStart] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; message: ChatMessage } | null>(null);
  const [reactTarget, setReactTarget] = useState<{ el: HTMLElement; message: ChatMessage } | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<ChatMessage | null>(null);
  const [threadMenu, setThreadMenu] = useState<HTMLElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState("");

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSeenId = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const recStartRef = useRef(0);
  const recCancelRef = useRef(false);

  const loadThreads = useCallback(
    () => Promise.all([
      listConversations().then(setConversations).catch(() => setConversations([])),
      listGroupThreads().then(setGroups).catch(() => setGroups([])),
    ]),
    [],
  );

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { directory().then((d) => setCanStart(d.can_start)).catch(() => {}); }, []);

  useEffect(() => {
    const t = window.setInterval(loadThreads, LIST_POLL_MS);
    return () => window.clearInterval(t);
  }, [loadThreads]);

  const activeDm = useMemo(
    () => (activeKind === "dm" ? (conversations ?? []).find((c) => c.id === activeId) ?? null : null),
    [conversations, activeId, activeKind],
  );
  const activeGroup = useMemo(
    () => (activeKind === "group" ? (groups ?? []).find((g) => g.id === activeId) ?? null : null),
    [groups, activeId, activeKind],
  );
  // Only call it "not found" once both lists have loaded and neither has it.
  const activeMissing =
    activeId !== null && conversations !== null && groups !== null && !activeDm && !activeGroup;

  const loadThread = useCallback((kind: "dm" | "group", tid: number, markRead: boolean) => {
    const p: Promise<ChatMessage[]> = kind === "group" ? listGroupMessages(tid) : listMessages(tid);
    return p
      .then((rows) => {
        setMessages(rows);
        if (!markRead) return;
        if (kind === "dm") {
          if (rows.some((m) => !m.mine && !m.read_at)) {
            return markThreadRead(tid).then(() => {
              setConversations((cs) => (cs ?? []).map((c) => (c.id === tid ? { ...c, unread: 0 } : c)));
              announceMessagesChanged();
            });
          }
        } else if (rows.some((m) => !m.mine)) {
          return markGroupRead(tid).then(() => {
            setGroups((gs) => (gs ?? []).map((g) => (g.id === tid ? { ...g, unread: 0 } : g)));
            announceMessagesChanged();
          });
        }
      })
      .catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    if (activeId === null || activeKind === null) { setMessages(null); return; }
    setMessages(null);
    lastSeenId.current = null;
    setDraft("");
    setEditing(null);
    setError("");
    setPendingFiles([]);
    // Abandon a recording in progress rather than send it to the thread you left.
    if (recRef.current && recRef.current.state !== "inactive") { recCancelRef.current = true; recRef.current.stop(); }
    loadThread(activeKind, activeId, true);
  }, [activeId, activeKind, loadThread]);

  useEffect(() => {
    if (activeId === null || activeKind === null) return;
    const t = window.setInterval(() => loadThread(activeKind, activeId, true), THREAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [activeId, activeKind, loadThread]);

  // Jump to the newest line whenever one arrives — but not on every poll.
  useEffect(() => {
    const newest = messages && messages.length ? messages[messages.length - 1].id : null;
    if (newest !== null && newest !== lastSeenId.current) {
      lastSeenId.current = newest;
      const el = scrollRef.current;
      if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [messages]);

  // Send a new line: text and/or files (a voice note passes its length as ms).
  const deliver = (body: string, files: File[], durationMs?: number) => {
    if (activeId === null || sending) return;
    if (!body.trim() && files.length === 0) return;
    setSending(true);
    const extras = files.length ? { files, durationMs } : undefined;
    const p: Promise<ChatMessage> = isGroup
      ? sendGroupMessage(activeId, body.trim(), extras)
      : sendMessage(activeId, body.trim(), extras);
    p.then((m) => {
      setDraft(""); setPendingFiles([]);
      setMessages((rows) => [...(rows ?? []), m]);
      loadThreads();
    }).catch(() => setError("Could not send that message.")).finally(() => setSending(false));
  };

  const send = () => {
    if (activeId === null || sending) return;
    if (editing) {
      const body = draft.trim();
      if (!body) return;
      const mid = editing.id;
      setSending(true);
      const p: Promise<ChatMessage> = isGroup ? editGroupMessage(mid, body) : editMessage(mid, body);
      p.then((m) => {
        setDraft(""); setEditing(null);
        setMessages((rows) => (rows ?? []).map((r) => (r.id === mid ? m : r)));
        loadThreads();
      })
        .catch((e) => setError(e?.response?.data?.detail ?? "Could not save that edit."))
        .finally(() => setSending(false));
      return;
    }
    deliver(draft, pendingFiles);
  };

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) setPendingFiles((prev) => [...prev, ...picked].slice(0, 10));
    e.target.value = "";  // let the same file be picked again after removal
  };
  const removePending = (i: number) => setPendingFiles((prev) => prev.filter((_, j) => j !== i));

  // Voice notes: record with MediaRecorder, send the clip on stop (with its length).
  const startRecording = async () => {
    if (recording || activeId === null) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      recCancelRef.current = false;
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) window.clearInterval(recTimerRef.current);
        const ms = Date.now() - recStartRef.current;
        setRecording(false); setRecMs(0);
        if (recCancelRef.current || chunksRef.current.length === 0) return;
        const type = chunksRef.current[0].type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("ogg") ? "ogg" : "webm";
        deliver("", [new File([blob], `voice-note.${ext}`, { type })], ms);
      };
      recRef.current = mr;
      recStartRef.current = Date.now();
      mr.start();
      setRecording(true);
      recTimerRef.current = window.setInterval(() => setRecMs(Date.now() - recStartRef.current), 200);
    } catch {
      setError("Couldn't access the microphone.");
    }
  };
  const stopRecording = () => recRef.current?.stop();
  const cancelRecording = () => { recCancelRef.current = true; recRef.current?.stop(); };
  // Tidy up a recording in progress if the user navigates away.
  useEffect(() => () => { if (recRef.current && recRef.current.state !== "inactive") { recCancelRef.current = true; recRef.current.stop(); } }, []);

  const startEditing = (m: ChatMessage) => { setMenu(null); setEditing(m); setDraft(m.body); };
  const cancelEditing = () => { setEditing(null); setDraft(""); };

  const doReact = (m: ChatMessage, emoji: string) => {
    setReactTarget(null);
    const p = isGroup ? reactToGroupMessage(m.id, emoji) : reactToDirectMessage(m.id, emoji);
    p.then((updated) => setMessages((rows) => (rows ?? []).map((r) => (r.id === updated.id ? updated : r))))
      .catch(() => setError("Couldn't add that reaction."));
  };

  const doDeleteMessage = () => {
    const m = confirmMessage;
    if (!m) return;
    setConfirmMessage(null);
    if (editing?.id === m.id) cancelEditing();
    const p: Promise<ChatMessage> = isGroup ? deleteGroupMessage(m.id) : deleteMessage(m.id);
    p.then((tomb) => {
      setMessages((rows) => (rows ?? []).map((r) => (r.id === tomb.id ? tomb : r)));
      loadThreads();
      announceMessagesChanged();
    }).catch(() => setError("Could not delete that message."));
  };

  const doDeleteConversation = () => {
    if (activeId === null) return;
    setConfirmClear(false);
    setThreadMenu(null);
    deleteConversation(activeId)
      .then(() => { announceMessagesChanged(); return loadThreads(); })
      .then(() => navigate("/messages"))
      .catch(() => setError("Could not delete that conversation."));
  };

  const doLeaveGroup = () => {
    if (activeId === null) return;
    setConfirmLeave(false);
    setThreadMenu(null);
    leaveGroup(activeId)
      .then(() => { announceMessagesChanged(); return loadThreads(); })
      .then(() => navigate("/messages"))
      .catch(() => setError("Could not leave that group."));
  };

  const doRename = () => {
    const name = renameDraft.trim();
    if (!activeId || !name) return;
    renameGroup(activeId, name)
      .then((g) => { setGroups((gs) => (gs ?? []).map((x) => (x.id === g.id ? g : x))); setRenameOpen(false); })
      .catch(() => setError("Could not rename the group."));
  };

  // Merge DMs + groups into one inbox, newest first.
  const threads: ThreadItem[] = useMemo(() => {
    const dm: ThreadItem[] = (conversations ?? []).map((c) => ({
      kind: "dm", id: c.id, title: c.other.name, unread: c.unread, lastAt: c.last_message_at,
      subtitleDeleted: !!c.last_message?.deleted,
      subtitle: !c.last_message ? "No messages yet"
        : c.last_message.deleted ? "This message was deleted"
        : `${c.last_message.mine ? "You: " : ""}${c.last_message.body || "📎 Attachment"}`,
    }));
    const grp: ThreadItem[] = (groups ?? []).map((g) => ({
      kind: "group", id: g.id, title: g.name, unread: g.unread, lastAt: g.last_message_at,
      memberCount: g.member_count, subtitleDeleted: !!g.last_message?.deleted,
      subtitle: !g.last_message ? "No messages yet"
        : g.last_message.deleted ? "A message was deleted"
        : `${g.last_message.mine ? "You: " : g.last_message.sender_name ? `${firstName(g.last_message.sender_name)}: ` : ""}${g.last_message.body || "📎 Attachment"}`,
    }));
    return [...dm, ...grp].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  }, [conversations, groups]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q));
  }, [threads, filter]);
  const shownPaged = usePaged(shown, 20);

  const loaded = conversations !== null && groups !== null;
  const isActive = (t: ThreadItem) => t.kind === activeKind && t.id === activeId;

  // Below md there is only room for one pane, so the thread replaces the list.
  const showList = !isNarrow || activeId === null;
  const showThread = !isNarrow || activeId !== null;

  const headerTitle = isGroup ? activeGroup?.name ?? "Group" : activeDm?.other.name ?? "";
  const headerSub = isGroup
    ? `${activeGroup?.member_count ?? 0} members`
    : activeDm?.other.role || activeDm?.other.email || "";

  const listPane = (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%",
      borderRight: isNarrow ? "none" : `1px solid ${tokens.line}`, bgcolor: tokens.surface }}>
      <Box sx={{ px: 2, pt: 2, pb: 1.25 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="h1" sx={{ fontSize: 22 }}>Messages</Typography>
          {canStart && (
            <>
              <Tooltip title="New message or group">
                <IconButton size="small" onClick={(e) => setNewMenu(e.currentTarget)}
                  sx={{ bgcolor: tokens.kriyaWash, color: tokens.kriyaInk, "&:hover": { bgcolor: "#D7EBEF" } }}>
                  <MapsUgcRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={newMenu} open={newMenu !== null} onClose={() => setNewMenu(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
                <MenuItem onClick={() => { setNewMenu(null); setComposeOpen(true); }}>
                  <MapsUgcRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: tokens.text2 }} />
                  <Typography sx={{ fontSize: 13.5 }}>New message</Typography>
                </MenuItem>
                <MenuItem onClick={() => { setNewMenu(null); setGroupCreateOpen(true); }}>
                  <GroupAddRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: tokens.text2 }} />
                  <Typography sx={{ fontSize: 13.5 }}>New group</Typography>
                </MenuItem>
              </Menu>
            </>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}
          sx={{ px: 1.25, py: 0.6, borderRadius: "9px", bgcolor: tokens.paper, border: `1px solid ${tokens.line}` }}>
          <SearchRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} />
          <InputBase value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Search messages" sx={{ fontSize: 13.5, flex: 1 }} />
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!loaded && <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={22} /></Stack>}
        {loaded && shown.length === 0 && (
          <Box sx={{ px: 3, py: 5, textAlign: "center" }}>
            <ForumRoundedIcon sx={{ fontSize: 34, color: tokens.text3, mb: 1 }} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: tokens.text2 }}>
              {filter ? "No matches" : "No conversations yet"}
            </Typography>
            {!filter && (
              <Typography sx={{ fontSize: 12.5, color: tokens.text3, mt: 0.5 }}>
                {canStart ? "Start one with the button above." : "A message will appear here when someone writes to you."}
              </Typography>
            )}
          </Box>
        )}
        {shownPaged.pageItems.map((t) => {
          const on = isActive(t);
          const to = t.kind === "group" ? `/messages/g/${t.id}` : `/messages/${t.id}`;
          return (
            <Stack key={`${t.kind}-${t.id}`} direction="row" spacing={1.25} alignItems="center"
              onClick={() => navigate(to)}
              sx={{ px: 2, py: 1.25, cursor: "pointer", borderBottom: `1px solid ${tokens.line}`,
                bgcolor: on ? tokens.kriyaWash : "transparent",
                borderLeft: `3px solid ${on ? tokens.kriya : "transparent"}`,
                "&:hover": { bgcolor: on ? tokens.kriyaWash : tokens.paper } }}>
              <Avatar sx={{ width: 38, height: 38, flexShrink: 0, fontSize: 14,
                bgcolor: t.kind === "group" ? GROUP_COLOR : on ? tokens.kriya : tokens.kriyaInk }}>
                {t.kind === "group" ? <GroupRoundedIcon sx={{ fontSize: 20 }} /> : initialsOf(t.title)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="baseline" spacing={1}>
                  <Typography noWrap sx={{ flex: 1, fontSize: 13.5, fontWeight: t.unread ? 700 : 600, color: tokens.text }}>
                    {t.title}
                  </Typography>
                  <Typography sx={{ fontFamily: monoFont, fontSize: 10, color: tokens.text3, flexShrink: 0 }}>
                    {listStamp(t.lastAt)}
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.15 }}>
                  <Typography noWrap sx={{ flex: 1, fontSize: 12, color: t.unread ? tokens.text : tokens.text3,
                    fontWeight: t.unread ? 600 : 400, fontStyle: t.subtitleDeleted ? "italic" : "normal" }}>
                    {t.subtitle}
                  </Typography>
                  {t.unread > 0 && (
                    <Box sx={{ minWidth: 18, height: 18, px: 0.5, borderRadius: 9, flexShrink: 0,
                      bgcolor: tokens.attn, color: "#fff", fontSize: 10.5, fontWeight: 700,
                      display: "grid", placeItems: "center" }}>
                      {t.unread}
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
      {activeId === null ? (
        <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ flex: 1, px: 4, textAlign: "center" }}>
          <ForumRoundedIcon sx={{ fontSize: 44, color: tokens.text3 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: tokens.text2 }}>Pick a conversation</Typography>
          <Typography sx={{ fontSize: 13, color: tokens.text3, maxWidth: 320 }}>
            Direct messages are private between the two of you; group chats are shared with their members.
          </Typography>
        </Stack>
      ) : activeMissing ? (
        <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ flex: 1, px: 4, textAlign: "center" }}>
          <ForumRoundedIcon sx={{ fontSize: 44, color: tokens.text3 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: tokens.text2 }}>Conversation not found</Typography>
          {isNarrow && <Button onClick={() => navigate("/messages")} sx={{ mt: 1 }}>Back to messages</Button>}
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
            <Avatar sx={{ width: 34, height: 34, fontSize: 13, bgcolor: isGroup ? GROUP_COLOR : tokens.kriyaInk }}>
              {isGroup ? <GroupRoundedIcon sx={{ fontSize: 19 }} /> : initialsOf(headerTitle)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 700, color: tokens.ink }}>{headerTitle}</Typography>
              <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>{headerSub}</Typography>
            </Box>
            <Tooltip title={isGroup ? "Group options" : "Conversation options"}>
              <IconButton size="small" aria-label="Conversation options" onClick={(e) => setThreadMenu(e.currentTarget)}>
                <MoreVertRoundedIcon sx={{ fontSize: 19, color: tokens.text3 }} />
              </IconButton>
            </Tooltip>
          </Stack>

          {/* thread */}
          <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, py: 2 }}>
            {messages === null && <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={22} /></Stack>}
            {messages !== null && messages.length === 0 && (
              <Typography sx={{ textAlign: "center", fontSize: 13, color: tokens.text3, py: 4 }}>
                No messages yet — say something.
              </Typography>
            )}
            <Stack spacing={0.5}>
              {(messages ?? []).map((m, i) => {
                const prev = (messages ?? [])[i - 1];
                const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
                const showSender = isGroup && !m.mine && (newDay || !prev || prev.sender !== m.sender || prev.mine);
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
                      sx={{ "&:hover .msg-actions": { opacity: 1 } }}>
                      {!m.deleted && (
                        <Stack direction="row" alignItems="center" className="msg-actions"
                          sx={{ order: m.mine ? -1 : 2, opacity: isNarrow ? 1 : 0, transition: "opacity .12s",
                            "&:focus-within": { opacity: 1 } }}>
                          <IconButton size="small" aria-label="Add reaction"
                            onClick={(e) => setReactTarget({ el: e.currentTarget, message: m })}>
                            <AddReactionOutlinedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                          </IconButton>
                          {m.mine && (
                            <IconButton size="small" aria-label="Message actions"
                              onClick={(e) => setMenu({ el: e.currentTarget, message: m })}>
                              <MoreVertRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                            </IconButton>
                          )}
                        </Stack>
                      )}
                      <Box sx={{ order: 1, display: "flex", flexDirection: "column", minWidth: 0,
                        alignItems: m.mine ? "flex-end" : "flex-start" }}>
                      <Paper elevation={0}
                        sx={{ maxWidth: "min(78%, 560px)", px: 1.5, py: 1, borderRadius: "12px",
                          border: `1px solid ${m.deleted ? tokens.line : m.mine ? "transparent" : tokens.line}`,
                          borderTopRightRadius: m.mine ? "4px" : "12px",
                          borderTopLeftRadius: m.mine ? "12px" : "4px",
                          bgcolor: m.deleted ? "transparent" : m.mine ? tokens.kriya : tokens.surface,
                          color: m.deleted ? tokens.text3 : m.mine ? "#fff" : tokens.text,
                          outline: editing?.id === m.id ? `2px solid ${tokens.kriyaGlow}` : "none", outlineOffset: 2 }}>
                        {showSender && !m.deleted && (
                          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: GROUP_COLOR, mb: 0.25 }}>
                            {firstName(m.sender_name)}
                          </Typography>
                        )}
                        {m.deleted ? (
                          <Stack direction="row" alignItems="center" spacing={0.6}>
                            <BlockRoundedIcon sx={{ fontSize: 14 }} />
                            <Typography sx={{ fontSize: 13, fontStyle: "italic" }}>
                              {m.mine ? "You deleted this message" : "This message was deleted"}
                            </Typography>
                          </Stack>
                        ) : (
                          <>
                            {m.attachments && m.attachments.length > 0 && (
                              <MessageAttachments attachments={m.attachments} mine={m.mine} />
                            )}
                            {m.body && (
                              <Typography sx={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {m.body}
                              </Typography>
                            )}
                          </>
                        )}
                        <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.4} sx={{ mt: 0.35 }}>
                          {m.edited_at && !m.deleted && (
                            <Typography sx={{ fontSize: 9.5, fontStyle: "italic",
                              color: m.mine ? "rgba(255,255,255,.75)" : tokens.text3 }}>edited</Typography>
                          )}
                          <Typography sx={{ fontFamily: monoFont, fontSize: 9.5,
                            color: m.deleted ? tokens.text3 : m.mine ? "rgba(255,255,255,.75)" : tokens.text3 }}>
                            {clockTime(m.created_at)}
                          </Typography>
                          {!isGroup && m.mine && !m.deleted && (m.read_at
                            ? <DoneAllRoundedIcon sx={{ fontSize: 13, color: "#BFF0F6" }} />
                            : <CheckRoundedIcon sx={{ fontSize: 13, color: "rgba(255,255,255,.65)" }} />)}
                        </Stack>
                      </Paper>
                      {m.reactions && m.reactions.length > 0 && (
                        <Stack direction="row" spacing={0.5} useFlexGap
                          sx={{ mt: 0.4, flexWrap: "wrap", justifyContent: m.mine ? "flex-end" : "flex-start" }}>
                          {m.reactions.map((rx) => (
                            <Box key={rx.emoji} onClick={() => doReact(m, rx.emoji)}
                              sx={{ display: "inline-flex", alignItems: "center", gap: 0.3, px: 0.7, py: 0.1,
                                borderRadius: 10, cursor: "pointer", fontSize: 12.5, lineHeight: 1.5, userSelect: "none",
                                bgcolor: rx.mine ? tokens.kriyaWash : tokens.surface,
                                border: `1px solid ${rx.mine ? tokens.kriya : tokens.line}` }}>
                              <span>{rx.emoji}</span>
                              {rx.count > 1 && (
                                <Typography component="span" sx={{ fontSize: 10.5, fontWeight: 600,
                                  color: rx.mine ? tokens.kriyaInk : tokens.text3 }}>{rx.count}</Typography>
                              )}
                            </Box>
                          ))}
                        </Stack>
                      )}
                      </Box>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {/* composer */}
          <Box sx={{ borderTop: `1px solid ${tokens.line}`, bgcolor: tokens.surface, flexShrink: 0 }}>
            {editing && (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.75, pt: 1.25, pb: 0.25 }}>
                <EditRoundedIcon sx={{ fontSize: 15, color: tokens.kriyaInk }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: tokens.kriyaInk }}>Editing message</Typography>
                  <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>{editing.body}</Typography>
                </Box>
                <Tooltip title="Cancel edit">
                  <IconButton size="small" onClick={cancelEditing} aria-label="Cancel edit">
                    <CloseRoundedIcon sx={{ fontSize: 16, color: tokens.text3 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
            {/* files chosen but not yet sent */}
            {pendingFiles.length > 0 && !recording && (
              <Stack direction="row" spacing={1} useFlexGap sx={{ px: 1.75, pt: 1.25, flexWrap: "wrap" }}>
                {pendingFiles.map((f, i) => (
                  <Stack key={i} direction="row" alignItems="center" spacing={0.75}
                    sx={{ px: 1, py: 0.5, borderRadius: "8px", bgcolor: tokens.paper, border: `1px solid ${tokens.line}`, maxWidth: 200 }}>
                    {f.type.startsWith("image/")
                      ? <Box component="img" src={URL.createObjectURL(f)} alt="" sx={{ width: 28, height: 28, borderRadius: "6px", objectFit: "cover" }} />
                      : <InsertDriveFileRoundedIcon sx={{ fontSize: 20, color: tokens.kriyaInk }} />}
                    <Typography noWrap sx={{ fontSize: 11.5, flex: 1, minWidth: 0 }}>{f.name}</Typography>
                    <IconButton size="small" onClick={() => removePending(i)} sx={{ p: 0.25 }}>
                      <CloseRoundedIcon sx={{ fontSize: 14, color: tokens.text3 }} />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}

            <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />

            <Stack direction="row" alignItems="flex-end" spacing={1} sx={{ p: 1.5, pt: (editing || pendingFiles.length) ? 1 : 1.5 }}>
              {recording ? (
                <Stack direction="row" alignItems="center" spacing={1.25}
                  sx={{ flex: 1, px: 1.5, height: 42, borderRadius: "12px", bgcolor: tokens.attnWash, border: `1px solid ${tokens.attn}` }}>
                  <Tooltip title="Discard">
                    <IconButton size="small" onClick={cancelRecording} aria-label="Discard recording">
                      <DeleteRoundedIcon sx={{ fontSize: 19, color: tokens.attn }} />
                    </IconButton>
                  </Tooltip>
                  <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: tokens.attn,
                    animation: "kospulse 1s infinite", "@keyframes kospulse": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.25 } } }} />
                  <Typography sx={{ fontFamily: monoFont, fontSize: 13, color: tokens.attn, fontWeight: 600 }}>{recClock(recMs)}</Typography>
                  <Typography sx={{ fontSize: 12, color: tokens.text3 }}>Recording — tap ✓ to send</Typography>
                </Stack>
              ) : (
                <>
                  {!editing && (
                    <Tooltip title="Attach photo or file">
                      <IconButton onClick={() => fileInputRef.current?.click()} aria-label="Attach a file"
                        sx={{ color: tokens.text3, flexShrink: 0 }}>
                        <AttachFileRoundedIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Box sx={{ flex: 1, px: 1.5, py: 1, borderRadius: "12px", bgcolor: tokens.paper,
                    border: `1px solid ${editing ? tokens.kriyaGlow : tokens.line}`, maxHeight: 160, overflowY: "auto" }}>
                    <InputBase multiline maxRows={6} fullWidth value={draft}
                      placeholder={editing ? "Edit your message…" : "Type a message…"}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                        if (e.key === "Escape" && editing) { e.preventDefault(); cancelEditing(); }
                      }}
                      sx={{ fontSize: 13.5 }} />
                  </Box>
                </>
              )}

              {(() => {
                const hasContent = !!draft.trim() || pendingFiles.length > 0;
                const onClick = editing ? send : recording ? stopRecording : hasContent ? send : startRecording;
                const disabled = sending || (!!editing && !draft.trim());
                const icon = sending ? <CircularProgress size={16} color="inherit" />
                  : editing ? <CheckRoundedIcon sx={{ fontSize: 20 }} />
                  : recording ? <CheckRoundedIcon sx={{ fontSize: 20 }} />
                  : hasContent ? <SendRoundedIcon sx={{ fontSize: 19 }} />
                  : <MicRoundedIcon sx={{ fontSize: 20 }} />;
                return (
                  <Button variant="contained" onClick={onClick} disabled={disabled}
                    aria-label={recording ? "Send voice note" : hasContent || editing ? "Send" : "Record voice note"}
                    sx={{ minWidth: 0, width: 42, height: 42, borderRadius: "50%", p: 0, flexShrink: 0,
                      bgcolor: recording ? tokens.attn : undefined, "&:hover": recording ? { bgcolor: "#B23A1F" } : undefined }}>
                    {icon}
                  </Button>
                );
              })()}
            </Stack>
          </Box>
        </>
      )}
    </Box>
  );

  return (
    <>
      <Box sx={{ height: "100%", display: "grid", minHeight: 0,
        gridTemplateColumns: isNarrow ? "1fr" : "320px 1fr" }}>
        {showList && listPane}
        {showThread && threadPane}
      </Box>

      <MessagePersonDialog open={composeOpen} onClose={() => setComposeOpen(false)}
        onSent={(conversationId) => { loadThreads(); navigate(`/messages/${conversationId}`); }} />

      <GroupDialog open={groupCreateOpen} onClose={() => setGroupCreateOpen(false)} mode="create"
        onCreated={(groupId) => { loadThreads(); navigate(`/messages/g/${groupId}`); }} />

      <GroupDialog open={addPeopleOpen} onClose={() => setAddPeopleOpen(false)} mode="add"
        groupId={activeGroup?.id}
        excludeIds={(activeGroup?.members ?? []).map((p) => p.id)}
        onAdded={(g) => { setGroups((gs) => (gs ?? []).map((x) => (x.id === g.id ? g : x))); }} />

      {/* emoji reaction picker */}
      <Menu anchorEl={reactTarget?.el ?? null} open={reactTarget !== null} onClose={() => setReactTarget(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        MenuListProps={{ sx: { py: 0.5 } }}>
        <Stack direction="row" sx={{ px: 0.5 }}>
          {REACTION_CHOICES.map((e) => (
            <IconButton key={e} aria-label={`React ${e}`}
              onClick={() => reactTarget && doReact(reactTarget.message, e)}
              sx={{ width: 40, height: 40, fontSize: 21 }}>
              <span>{e}</span>
            </IconButton>
          ))}
        </Stack>
      </Menu>

      {/* per-message actions */}
      <Menu anchorEl={menu?.el ?? null} open={menu !== null} onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <MenuItem disabled={!menu?.message.can_edit} onClick={() => menu && startEditing(menu.message)}>
          <EditRoundedIcon sx={{ fontSize: 17, mr: 1.25, color: tokens.text2 }} />
          <Box>
            <Typography sx={{ fontSize: 13.5 }}>Edit</Typography>
            {menu && !menu.message.can_edit && (
              <Typography sx={{ fontSize: 11, color: tokens.text3 }}>Too old to edit — send a follow-up</Typography>
            )}
          </Box>
        </MenuItem>
        <MenuItem onClick={() => { setConfirmMessage(menu?.message ?? null); setMenu(null); }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 17, mr: 1.25, color: tokens.attn }} />
          <Typography sx={{ fontSize: 13.5, color: tokens.attn }}>Delete</Typography>
        </MenuItem>
      </Menu>

      {/* thread / group actions */}
      <Menu anchorEl={threadMenu} open={threadMenu !== null} onClose={() => setThreadMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        {isGroup ? [
          <MenuItem key="add" onClick={() => { setThreadMenu(null); setAddPeopleOpen(true); }}>
            <PersonAddAltRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: tokens.text2 }} />
            <Typography sx={{ fontSize: 13.5 }}>Add people</Typography>
          </MenuItem>,
          ...(activeGroup?.is_admin ? [
            <MenuItem key="rename" onClick={() => { setThreadMenu(null); setRenameDraft(activeGroup?.name ?? ""); setRenameOpen(true); }}>
              <DriveFileRenameOutlineRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: tokens.text2 }} />
              <Typography sx={{ fontSize: 13.5 }}>Rename group</Typography>
            </MenuItem>,
          ] : []),
          <MenuItem key="leave" onClick={() => { setConfirmLeave(true); setThreadMenu(null); }}>
            <LogoutRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: tokens.attn }} />
            <Typography sx={{ fontSize: 13.5, color: tokens.attn }}>Leave group</Typography>
          </MenuItem>,
        ] : (
          <MenuItem onClick={() => { setConfirmClear(true); setThreadMenu(null); }}>
            <DeleteOutlineRoundedIcon sx={{ fontSize: 17, mr: 1.25, color: tokens.attn }} />
            <Typography sx={{ fontSize: 13.5, color: tokens.attn }}>Delete conversation</Typography>
          </MenuItem>
        )}
      </Menu>

      <Dialog open={confirmMessage !== null} onClose={() => setConfirmMessage(null)}
        PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17 }}>Delete this message?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13.5 }}>
            The text is removed for everyone and can't be recovered. The thread will show that a message was deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmMessage(null)} sx={{ color: tokens.text2 }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={doDeleteMessage}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17 }}>Delete this conversation?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13.5 }}>
            It's removed from <b>your</b> list only — {activeDm?.other.name ?? "the other person"} keeps their copy.
            If they write again, the thread comes back with just the new messages.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmClear(false)} sx={{ color: tokens.text2 }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={doDeleteConversation}>Delete for me</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmLeave} onClose={() => setConfirmLeave(false)} PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17 }}>Leave this group?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13.5 }}>
            You'll stop receiving messages from <b>{activeGroup?.name ?? "this group"}</b> and it will leave your list.
            Anyone in the group can add you back later.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmLeave(false)} sx={{ color: tokens.text2 }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={doLeaveGroup}>Leave group</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} fullWidth maxWidth="xs"
        PaperProps={{ sx: { borderRadius: "14px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 17 }}>Rename group</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
            inputProps={{ maxLength: 120 }} sx={{ mt: 1 }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doRename(); } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRenameOpen(false)} sx={{ color: tokens.text2 }}>Cancel</Button>
          <Button variant="contained" onClick={doRename} disabled={!renameDraft.trim()}>Save</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="error" onClose={() => setError("")} sx={{ fontSize: 13 }}>{error}</Alert>
      </Snackbar>
    </>
  );
}
