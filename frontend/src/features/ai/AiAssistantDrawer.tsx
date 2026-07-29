import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Drawer,
  Fab,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import AddCommentRoundedIcon from "@mui/icons-material/AddCommentRounded";

import { tokens } from "../../theme";
import {
  aiErrorMessage,
  chat,
  getConversation,
  listConversations,
  type AiConversation,
} from "./aiApi";
import { useAiAssistant } from "./AiContext";

/**
 * The floating assistant, available from every page.
 *
 * It is page-aware: whatever context the current page registered via
 * `useAiPageContext` is sent with each message, so "summarise this page" or
 * "what's at risk here?" resolve against real data instead of guesswork.
 */

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Offered when the page has not registered any context. */
const GENERAL_PROMPTS = [
  "What should I focus on today?",
  "Summarise my overdue work",
  "Draft a status update email",
];

/** Offered when the page did register context. */
const CONTEXTUAL_PROMPTS = [
  "Summarise this page",
  "What are the risks here?",
  "What should I do next?",
];

/**
 * One turn of the transcript.
 *
 * The user's own words get a tinted block with a teal rule; the assistant's are
 * plain text on paper. Filled balloons on both sides made a working tool look
 * like a consumer chat toy.
 */
function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <Box
        sx={{
          bgcolor: tokens.kriyaWash,
          borderLeft: `2px solid ${tokens.kriya}`,
          borderRadius: "0 6px 6px 0",
          px: 1.5,
          py: 1.1,
        }}
      >
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {turn.content}
        </Typography>
      </Box>
    );
  }
  return (
    <Typography sx={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap", color: tokens.text }}>
      {turn.content}
    </Typography>
  );
}

export default function AiAssistantDrawer() {
  const { isOpen, close, open, page, pendingPrompt, clearPendingPrompt, status, statusLoaded } =
    useAiAssistant();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [history, setHistory] = useState<AiConversation[]>([]);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen && pendingPrompt) {
      setInput(pendingPrompt);
      clearPendingPrompt();
    }
  }, [isOpen, pendingPrompt, clearPendingPrompt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;

    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setError("");

    try {
      const outcome = await chat({
        message,
        conversation_id: conversationId,
        page_context: page?.text ?? "",
        page_path: window.location.pathname,
        project_id: page?.projectId ?? null,
      });
      if (outcome.conversation_id) setConversationId(outcome.conversation_id);
      setTurns((prev) => [...prev, { role: "assistant", content: outcome.text }]);
    } catch (err) {
      setError(aiErrorMessage(err));
      // Drop the unanswered question so the thread does not show a dangling turn.
      setTurns((prev) => prev.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  const startNewThread = () => {
    setTurns([]);
    setConversationId(null);
    setError("");
  };

  const openHistory = async (element: HTMLElement) => {
    setHistoryAnchor(element);
    try {
      setHistory(await listConversations());
    } catch {
      setHistory([]);
    }
  };

  const loadThread = async (id: number) => {
    setHistoryAnchor(null);
    setBusy(true);
    try {
      const conversation = await getConversation(id);
      setConversationId(conversation.id);
      setTurns((conversation.messages ?? []).map((m) => ({ role: m.role, content: m.content })));
      setError("");
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = page ? CONTEXTUAL_PROMPTS : GENERAL_PROMPTS;
  const aiDisabled = statusLoaded && status !== null && !status.enabled;

  return (
    <>
      <Tooltip title="AI assistant" placement="left">
        <Fab
          color="primary"
          onClick={() => open()}
          aria-label="Open the AI assistant"
          sx={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: (t) => t.zIndex.drawer - 1,
            bgcolor: tokens.kriya,
            "&:hover": { bgcolor: tokens.kriyaInk },
          }}
        >
          <AutoAwesomeRoundedIcon />
        </Fab>
      </Tooltip>

      <Drawer
        anchor="right"
        open={isOpen}
        onClose={close}
        PaperProps={{ sx: { width: { xs: "100%", sm: 440 }, display: "flex", flexDirection: "column" } }}
      >
        {/* header */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${tokens.line}`, background: tokens.paper }}
        >
          <AutoAwesomeRoundedIcon sx={{ color: tokens.kriya, fontSize: 20 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 15 }}>
              AI Assistant
            </Typography>
            {page && (
              <Typography noWrap sx={{ fontSize: 11.5, color: tokens.text3 }}>
                Context: {page.label}
              </Typography>
            )}
          </Box>
          <Tooltip title="Past conversations">
            <IconButton size="small" onClick={(e) => openHistory(e.currentTarget)}>
              <HistoryRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="New conversation">
            <IconButton size="small" onClick={startNewThread}>
              <AddCommentRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={close} aria-label="Close the assistant">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Menu anchorEl={historyAnchor} open={Boolean(historyAnchor)} onClose={() => setHistoryAnchor(null)}>
          {history.length === 0 && <MenuItem disabled>No earlier conversations</MenuItem>}
          {history.slice(0, 15).map((conversation) => (
            <MenuItem key={conversation.id} onClick={() => loadThread(conversation.id)} sx={{ maxWidth: 380 }}>
              <Typography noWrap sx={{ fontSize: 13 }}>
                {conversation.title || `Conversation ${conversation.id}`}
              </Typography>
            </MenuItem>
          ))}
        </Menu>

        {/* messages */}
        <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 2, bgcolor: tokens.paper }}>
          {aiDisabled && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              AI features are switched off for this system. An administrator can enable them in AI settings.
            </Alert>
          )}
          {status?.offline_fallback && (
            <Alert severity="info" sx={{ mb: 2, fontSize: 12.5 }}>
              Running in offline mode — no provider API key is configured, so replies are placeholders.
            </Alert>
          )}

          {turns.length === 0 && !busy && (
            <Stack spacing={1.5} sx={{ py: 2 }}>
              <Typography sx={{ fontSize: 13.5, color: tokens.text2 }}>
                Ask about your projects, tasks and deadlines — or use a starting point:
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {suggestions.map((prompt) => (
                  <Chip
                    key={prompt}
                    label={prompt}
                    size="small"
                    onClick={() => send(prompt)}
                    disabled={aiDisabled}
                    sx={{ bgcolor: "#F1F3F5", color: tokens.text2, fontSize: 12.5 }}
                  />
                ))}
              </Stack>
            </Stack>
          )}

          <Stack spacing={1.25}>
            {turns.map((turn, index) => (
              <Turn key={index} turn={turn} />
            ))}
            {busy && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
                <CircularProgress size={14} />
                <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Thinking…</Typography>
              </Stack>
            )}
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <div ref={endRef} />
        </Box>

        {/* composer */}
        <Box sx={{ p: 1.5, borderTop: `1px solid ${tokens.line}`, bgcolor: tokens.surface }}>
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <TextField
              fullWidth
              multiline
              maxRows={5}
              size="small"
              placeholder="Ask the assistant…"
              value={input}
              disabled={aiDisabled}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: "6px" } }}
            />
            <IconButton
              color="primary"
              onClick={() => send(input)}
              disabled={busy || !input.trim() || aiDisabled}
              aria-label="Send"
              sx={{ mb: 0.25 }}
            >
              <SendRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Typography sx={{ fontSize: 10.5, color: tokens.text3, mt: 0.75, px: 0.5 }}>
            AI can be wrong — check anything you act on.
          </Typography>
        </Box>
      </Drawer>
    </>
  );
}
