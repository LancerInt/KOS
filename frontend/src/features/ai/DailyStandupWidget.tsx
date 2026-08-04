import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Menu, MenuItem, Stack, Tooltip, Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import LightbulbRoundedIcon from "@mui/icons-material/LightbulbRounded";

import { tokens, monoFont } from "../../theme";
import {
  aiErrorMessage, generateStandup, getStandup, listStandups, standupToText,
  type DailyStandup,
} from "./aiApi";
import { useAiAssistant } from "./AiContext";

/**
 * The Daily Stand-Up — an AI-action button (like the others in the bar) that
 * opens the stand-up in a dialog. Content loads on first open so the dashboard
 * costs nothing until asked. **Refresh** re-reads storage; **Generate /
 * Regenerate** is the only control that spends a provider call.
 */

const POLL_INTERVAL_MS = 2000;
const POLL_LIMIT = 30; // ≈60s, comfortably longer than a provider call

/** Section rows share one shape so the panel reads as a single list. */
function Section({
  icon, title, items, accent, empty,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  accent?: string;
  empty?: string;
}) {
  const list = (items ?? []).filter((i) => typeof i === "string" && i.trim());
  if (!list.length && !empty) return null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
        <Box sx={{ display: "flex", color: accent ?? tokens.text3 }}>{icon}</Box>
        <Typography
          sx={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: tokens.text3 }}
        >
          {title}
        </Typography>
      </Stack>
      {list.length ? (
        <Stack component="ul" spacing={0.4} sx={{ m: 0, pl: 2.5 }}>
          {list.map((item, index) => (
            <Typography
              key={index}
              component="li"
              sx={{ fontSize: 13.5, lineHeight: 1.6, "&::marker": { color: accent ?? tokens.text3 } }}
            >
              {item}
            </Typography>
          ))}
        </Stack>
      ) : (
        <Typography sx={{ fontSize: 12.5, color: tokens.text3, pl: 2.5 }}>{empty}</Typography>
      )}
    </Box>
  );
}

function CountChip({ label, value, attn }: { label: string; value: number; attn?: boolean }) {
  if (!value) return null;
  const hot = Boolean(attn);
  return (
    <Chip
      size="small"
      label={`${value} ${label}`}
      sx={{
        height: 21, fontSize: 11, fontWeight: 600, fontFamily: monoFont,
        bgcolor: hot ? tokens.attnWash : tokens.kriyaWash,
        color: hot ? tokens.attn : tokens.kriyaInk,
      }}
    />
  );
}

function StandupBody({ standup }: { standup: DailyStandup }) {
  const c = standup.content;
  const counts = standup.metrics?.counts;

  return (
    <Stack spacing={2}>
      {c.greeting && (
        <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 16, fontWeight: 600 }}>
          {c.greeting}
        </Typography>
      )}

      {counts && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <CountChip label="open" value={counts.assigned_open} />
          <CountChip label="overdue" value={counts.overdue} attn />
          <CountChip label="due today" value={counts.due_today} />
          <CountChip label="blocked" value={counts.blocked} attn />
          <CountChip label="done yesterday" value={counts.completed_yesterday} />
          <CountChip label="today" value={counts.meetings_today} />
        </Stack>
      )}

      <Section
        icon={<CheckRoundedIcon sx={{ fontSize: 15 }} />}
        title="Yesterday"
        items={c.yesterday}
        empty="Nothing was completed yesterday."
      />
      <Section
        icon={<AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />}
        title="Today's priorities"
        items={c.today_priorities}
        accent={tokens.kriya}
        empty="Nothing is due today."
      />
      <Section
        icon={<WarningAmberRoundedIcon sx={{ fontSize: 15 }} />}
        title="Attention needed"
        items={[...(c.overdue ?? []), ...(c.attention ?? [])]}
        accent={tokens.attn}
      />
      <Section icon={<BlockRoundedIcon sx={{ fontSize: 15 }} />} title="Blockers" items={c.blockers} />
      <Section
        icon={<LightbulbRoundedIcon sx={{ fontSize: 15 }} />}
        title="Recommendations"
        items={c.recommendations}
        accent={tokens.kriya}
      />

      {c.narrative && (
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{c.narrative}</Typography>
      )}

      {c.productivity_insight && (
        <Box sx={{ p: 1.25, borderRadius: "6px", bgcolor: tokens.paper, border: `1px solid ${tokens.line}` }}>
          <Typography sx={{ fontSize: 12.5, color: tokens.text2, lineHeight: 1.6 }}>
            {c.productivity_insight}
          </Typography>
        </Box>
      )}
    </Stack>
  );
}

export default function DailyStandupWidget() {
  const { status } = useAiAssistant();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [standup, setStandup] = useState<DailyStandup | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<"" | "generating" | "regenerating">("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const [copied, setCopied] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<DailyStandup[] | null>(null);
  const [viewing, setViewing] = useState<DailyStandup | null>(null);

  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getStandup();
      if (cancelled.current) return;
      setStandup(response.standup);
      setDetail(response.standup ? "" : response.detail ?? "");
      setError("");
      setLoaded(true);
    } catch (err) {
      if (!cancelled.current) setError(aiErrorMessage(err));
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, []);

  const openDialog = () => {
    setOpen(true);
    if (!loaded && !loading) void load();   // fetch on first open only
  };

  /** Poll until a queued worker job produces the stand-up. */
  const pollUntilReady = useCallback(async () => {
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelled.current) return true;
      const response = await getStandup();
      if (response.standup) {
        setStandup(response.standup);
        setDetail("");
        return true;
      }
    }
    return false;
  }, []);

  const run = async (force: boolean) => {
    setWorking(force ? "regenerating" : "generating");
    setError("");
    setCopied(false);
    try {
      const response = await generateStandup(force);
      if (cancelled.current) return;
      if (response.standup) {
        setStandup(response.standup);
        setDetail("");
      } else if (response.queued) {
        const ready = await pollUntilReady();
        if (!ready && !cancelled.current) {
          setError("Your stand-up is still being generated. Try refreshing in a moment.");
        }
      } else {
        setDetail(response.detail ?? "");
      }
    } catch (err) {
      if (!cancelled.current) setError(aiErrorMessage(err));
    } finally {
      if (!cancelled.current) setWorking("");
    }
  };

  const copy = async () => {
    if (!standup) return;
    try {
      await navigator.clipboard.writeText(standupToText(standup));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the text is on screen either way.
    }
  };

  const exportText = () => {
    if (!standup) return;
    const blob = new Blob([standupToText(standup)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kos-standup-${standup.standup_date}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openHistory = async () => {
    setMenuAnchor(null);
    setHistoryOpen(true);
    if (history === null) {
      try {
        setHistory(await listStandups());
      } catch {
        setHistory([]);
      }
    }
  };

  const aiOff = status ? !status.enabled : false;
  const busy = working !== "";

  return (
    <>
      <Button
        size="small" variant="outlined"
        startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={openDialog}
        sx={{ whiteSpace: "nowrap" }}
      >
        Daily stand-up
      </Button>

      {/* the stand-up, in a dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: "6px" } }}>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <AutoAwesomeRoundedIcon sx={{ fontSize: 18, color: tokens.kriya }} />
            <Box component="span" sx={{ flex: 1 }}>Daily Stand-Up</Box>
            {standup && (
              <Typography sx={{ fontSize: 11.5, fontFamily: monoFont, color: tokens.text3, fontWeight: 400 }}>
                {new Date(standup.standup_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </Typography>
            )}
            <Tooltip title="Refresh">
              <span>
                <IconButton size="small" onClick={() => void load()} disabled={busy}>
                  <RefreshRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="More">
              <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                <HistoryRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </DialogTitle>

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem onClick={() => { setMenuAnchor(null); void copy(); }} disabled={!standup} sx={{ fontSize: 13 }}>
            <ContentCopyRoundedIcon sx={{ fontSize: 16, mr: 1 }} /> {copied ? "Copied" : "Copy"}
          </MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); exportText(); }} disabled={!standup} sx={{ fontSize: 13 }}>
            <DownloadRoundedIcon sx={{ fontSize: 16, mr: 1 }} /> Export
          </MenuItem>
          <MenuItem onClick={() => void openHistory()} sx={{ fontSize: 13 }}>
            <HistoryRoundedIcon sx={{ fontSize: 16, mr: 1 }} /> Previous stand-ups
          </MenuItem>
        </Menu>

        <DialogContent dividers sx={{ minHeight: 160 }}>
          {loading ? (
            <Stack alignItems="center" spacing={1.25} sx={{ py: 3 }}>
              <CircularProgress size={22} />
              <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Loading your stand-up…</Typography>
            </Stack>
          ) : busy && !standup ? (
            <Stack alignItems="center" spacing={1.25} sx={{ py: 3 }}>
              <CircularProgress size={22} />
              <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>
                Writing your stand-up… this takes a few seconds.
              </Typography>
            </Stack>
          ) : error ? (
            <Alert severity="error" sx={{ fontSize: 12.5 }}>{error}</Alert>
          ) : standup ? (
            <StandupBody standup={standup} />
          ) : (
            <Stack spacing={1.5} alignItems="flex-start" sx={{ py: 1 }}>
              <Typography sx={{ fontSize: 13.5, color: tokens.text2 }}>
                {detail || "No stand-up has been generated for today yet."}
              </Typography>
              <Typography sx={{ fontSize: 12, color: tokens.text3 }}>Press Generate to write one now.</Typography>
            </Stack>
          )}

          {standup && !standup.ai_ok && (
            <Alert severity="info" sx={{ mt: 2, fontSize: 12.5 }}>
              The AI provider was unavailable, so this stand-up was assembled from your figures directly.
              {/* The provider's own words. "Unavailable" alone cannot tell a
                  wrong key from an unpaid account from a rate limit, and the
                  three need different fixes — so say which it was rather than
                  making someone open Django admin to find out. */}
              {standup.error && (
                <Box
                  component="span"
                  sx={{ display: "block", mt: 0.75, fontFamily: monoFont, fontSize: 11.5, color: tokens.text2 }}
                >
                  {standup.error}
                </Box>
              )}
            </Alert>
          )}
          {standup && status?.offline_fallback && standup.ai_ok && (
            <Alert severity="info" sx={{ mt: 2, fontSize: 12.5 }}>
              No provider API key is configured, so this is placeholder output from the offline provider.
            </Alert>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Tooltip title={aiOff ? "AI features are switched off for this system." : ""}>
            <span>
              <Button
                size="small"
                variant={standup ? "text" : "contained"}
                // With nothing stored yet, pressing this must force. The server
                // declines a stand-up for a quiet day (has_anything_to_say), and
                // `force` is the override it provides for exactly this case —
                // without it the button returns the same empty state it started
                // from, which reads as a dead button. Once a stand-up exists the
                // unforced call is right: it hands back the stored one for free,
                // and Regenerate is there to spend a provider call.
                onClick={() => void run(!standup)}
                disabled={busy || aiOff}
                startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />}
              >
                {working === "generating" ? "Generating…" : standup ? "Generate" : "Generate stand-up"}
              </Button>
            </span>
          </Tooltip>
          {standup && (
            <Button size="small" color="inherit" onClick={() => void run(true)} disabled={busy || aiOff}>
              {working === "regenerating" ? "Regenerating…" : "Regenerate"}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {standup && (
            <Button size="small" color="inherit" onClick={() => void copy()} disabled={busy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          <Button size="small" color="inherit" onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* previous stand-ups */}
      <Dialog open={historyOpen} onClose={() => { setHistoryOpen(false); setViewing(null); }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 16 }}>
          {viewing
            ? new Date(viewing.standup_date).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })
            : "Previous stand-ups"}
        </DialogTitle>
        <DialogContent dividers>
          {viewing ? (
            <Stack spacing={2}>
              <Button size="small" color="inherit" onClick={() => setViewing(null)} sx={{ alignSelf: "flex-start" }}>
                ← Back to list
              </Button>
              <StandupBody standup={viewing} />
            </Stack>
          ) : history === null ? (
            <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={22} /></Stack>
          ) : history.length === 0 ? (
            <Typography sx={{ fontSize: 13.5, color: tokens.text3, py: 2 }}>
              No stand-ups yet. One is generated for you each morning.
            </Typography>
          ) : (
            <Stack spacing={0}>
              {history.map((entry, index) => (
                <Stack
                  key={entry.id}
                  direction="row" alignItems="center" spacing={1.5}
                  onClick={() => setViewing(entry)}
                  sx={{
                    py: 1.25, cursor: "pointer",
                    borderTop: index === 0 ? "none" : `1px solid ${tokens.line}`,
                    "&:hover .title": { color: tokens.kriyaInk },
                  }}
                >
                  <Typography sx={{ fontSize: 12, fontFamily: monoFont, color: tokens.text3, minWidth: 74 }}>
                    {new Date(entry.standup_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </Typography>
                  <Typography className="title" sx={{ fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                    {entry.content?.greeting || "Stand-up"}
                  </Typography>
                  {entry.trigger === "manual" && (
                    <Chip size="small" label="manual" sx={{ height: 18, fontSize: 10, bgcolor: "#F1F3F5", color: tokens.text3 }} />
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
