import { useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import LightbulbRoundedIcon from "@mui/icons-material/LightbulbRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";

import { tokens } from "../../theme";
import { aiErrorMessage, dashboard, type ExplainData, type InsightsData } from "./aiApi";
import { useAiAssistant } from "./AiContext";

/**
 * Portfolio insights — reads the dashboard's own figures and says what they
 * mean, then answers questions about them.
 *
 * Both halves already existed on the server (`/ai/dashboard/insights/` and
 * `/ai/dashboard/explain/`) and in the API client; nothing called them. This is
 * the surface for them.
 *
 * Insights are generated once per opening and kept for as long as the page
 * lives — there is no stored copy the way a stand-up has one, so every call is
 * a provider call, and reopening the dialog must not quietly spend another.
 * Regenerate is the explicit way to pay for a fresh read.
 */

const SEVERITY: Record<string, { label: string; fg: string; bg: string }> = {
  high: { label: "High", fg: tokens.attn, bg: tokens.attnWash },
  critical: { label: "Critical", fg: tokens.attn, bg: tokens.attnWash },
  medium: { label: "Medium", fg: "#8A6D1F", bg: "#FBF3DE" },
  low: { label: "Low", fg: tokens.text3, bg: "#F1F3F5" },
};

/** A titled list, so every block on the panel reads the same way. */
function Block({ icon, title, items }: { icon: React.ReactNode; title: string; items?: string[] }) {
  const list = (items ?? []).filter((i) => typeof i === "string" && i.trim());
  if (!list.length) return null;
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
        <Box sx={{ display: "flex", color: tokens.text3 }}>{icon}</Box>
        <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: tokens.text3 }}>
          {title}
        </Typography>
      </Stack>
      <Stack component="ul" spacing={0.4} sx={{ m: 0, pl: 2.5 }}>
        {list.map((item, index) => (
          <Typography key={index} component="li" sx={{ fontSize: 13.5, lineHeight: 1.55 }}>{item}</Typography>
        ))}
      </Stack>
    </Box>
  );
}

export default function PortfolioInsightsWidget() {
  const { status } = useAiAssistant();
  const [open, setOpen] = useState(false);

  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ExplainData | null>(null);
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState("");

  const aiOff = status ? !status.enabled : false;

  const run = async () => {
    setLoading(true);
    setErr("");
    try {
      const outcome = await dashboard.insights();
      // A model that ignored the JSON contract still answered — show its prose
      // rather than an error, which is what the envelope's `text` is for.
      setInsights(outcome.structured
        ? outcome.data
        : { headline: outcome.text || "No insights returned.", insights: [], recommendations: [], trends: [] });
    } catch (e) {
      setErr(aiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const openDialog = () => {
    setOpen(true);
    if (!insights && !loading && !aiOff) void run();
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskErr("");
    try {
      const outcome = await dashboard.explain(q);
      setAnswer(outcome.structured
        ? outcome.data
        : { explanation: outcome.text || "No answer returned.", key_takeaways: [], watch_outs: [] });
    } catch (e) {
      setAskErr(aiErrorMessage(e));
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <Button
        size="small" variant="outlined"
        startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={openDialog}
        sx={{ whiteSpace: "nowrap" }}
      >
        Portfolio insights
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 16 }}>
          Portfolio insights
        </DialogTitle>

        <DialogContent dividers>
          {aiOff ? (
            <Alert severity="info" sx={{ fontSize: 13 }}>
              AI features are switched off for this system.
            </Alert>
          ) : loading ? (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 4 }}>
              <CircularProgress size={22} />
              <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>Reading your projects…</Typography>
            </Stack>
          ) : err ? (
            <Alert severity="error" sx={{ fontSize: 13 }}>{err}</Alert>
          ) : insights ? (
            <Stack spacing={2.25}>
              {insights.headline && (
                <Typography sx={{ fontSize: 14.5, lineHeight: 1.55, fontWeight: 500 }}>
                  {insights.headline}
                </Typography>
              )}

              {(insights.insights ?? []).length > 0 && (
                <Stack spacing={1}>
                  {insights.insights.map((item, index) => {
                    const sev = SEVERITY[(item.severity || "").toLowerCase()] ?? SEVERITY.low;
                    return (
                      <Box key={index} sx={{ p: 1.25, borderRadius: "6px", border: `1px solid ${tokens.line}` }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.4 }}>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
                            {item.title}
                          </Typography>
                          <Chip size="small" label={sev.label}
                            sx={{ height: 18, fontSize: 10, color: sev.fg, bgcolor: sev.bg, flexShrink: 0 }} />
                        </Stack>
                        <Typography sx={{ fontSize: 13, color: tokens.text2, lineHeight: 1.55 }}>
                          {item.detail}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              )}

              <Block icon={<TrendingUpRoundedIcon sx={{ fontSize: 15 }} />} title="Trends" items={insights.trends} />
              <Block icon={<LightbulbRoundedIcon sx={{ fontSize: 15 }} />} title="Recommendations" items={insights.recommendations} />

              <Divider />

              {/* Ask about the same figures — the server rebuilds the metrics, so
                  the question is answered against what this dashboard shows. */}
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
                  <HelpOutlineRoundedIcon sx={{ fontSize: 15, color: tokens.text3 }} />
                  <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: tokens.text3 }}>
                    Ask about these numbers
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small" fullWidth value={question} disabled={asking}
                    placeholder="Why are so many projects overdue?"
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void ask(); } }}
                  />
                  <Button size="small" variant="contained" onClick={() => void ask()}
                    disabled={asking || !question.trim()} sx={{ flexShrink: 0 }}>
                    {asking ? "Asking…" : "Ask"}
                  </Button>
                </Stack>

                {askErr && <Alert severity="error" sx={{ mt: 1, fontSize: 13 }}>{askErr}</Alert>}
                {answer && (
                  <Stack spacing={1.5} sx={{ mt: 1.5, p: 1.5, borderRadius: "6px", bgcolor: "#F7F8FA" }}>
                    <Typography sx={{ fontSize: 13.5, lineHeight: 1.6 }}>{answer.explanation}</Typography>
                    <Block icon={<LightbulbRoundedIcon sx={{ fontSize: 15 }} />} title="Key takeaways" items={answer.key_takeaways} />
                    <Block icon={<TrendingUpRoundedIcon sx={{ fontSize: 15 }} />} title="Watch outs" items={answer.watch_outs} />
                  </Stack>
                )}
              </Box>
            </Stack>
          ) : (
            <Typography sx={{ fontSize: 13.5, color: tokens.text3, py: 2 }}>
              Nothing to report yet.
            </Typography>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Tooltip title={aiOff ? "AI features are switched off for this system." : ""}>
            <span>
              <Button size="small" variant="contained" onClick={() => void run()} disabled={loading || aiOff}
                startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />}>
                {loading ? "Reading…" : insights ? "Regenerate" : "Generate"}
              </Button>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Button size="small" color="inherit" onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
