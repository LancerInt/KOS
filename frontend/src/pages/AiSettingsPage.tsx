import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import {
  aiErrorMessage,
  getSettings,
  updateSettings,
  type AiSettings,
} from "../features/ai/aiApi";
import { monoFont, tokens } from "../theme";

/**
 * AI configuration and the automation schedule.
 *
 * Administrators only — the route is capability-gated in the sidebar and the
 * API enforces it again server-side.
 *
 * The API key is deliberately absent from this screen: it lives in the server
 * environment and the API only ever reports whether one is present.
 *
 * Request logs and usage statistics are still recorded server-side; they are
 * read through Django admin and the API rather than shown here.
 */

const PROVIDERS = [
  { value: "groq", label: "Groq" },
  { value: "grok", label: "Grok (xAI)" },
  { value: "openai", label: "OpenAI" },
  { value: "mock", label: "Offline (no external calls)" },
];

const TABS = ["Configuration", "Automation"];

/**
 * The escalation ladder rendered as the sequence it is. Depth of a single hue
 * carries the intensity — a traffic-light ramp would read as decoration.
 */
const LADDER_STEPS = ["#C8D3D6", "#7FAEB5", "#2E8494", tokens.kriyaInk];

const AUTOMATION_TOGGLES: { key: keyof AiSettings; label: string; detail: string }[] = [
  { key: "overdue_scan_enabled", label: "Overdue detection", detail: "Every 5 minutes — reminders and the escalation ladder" },
  { key: "blocked_scan_enabled", label: "Blocked & high priority", detail: "Every 15 minutes — blockers, critical work, SLA breaches" },
  { key: "health_scan_enabled", label: "Project health", detail: "Hourly — health scoring and critical-status alerts" },
  { key: "daily_summary_enabled", label: "Daily summaries", detail: "A personal briefing email each morning" },
  { key: "weekly_report_enabled", label: "Weekly reports", detail: "Team report every Monday" },
  { key: "monthly_report_enabled", label: "Monthly reports", detail: "KPI and executive summary on the 1st" },
];

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: "6px" }}>
      <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 15 }}>{title}</Typography>
      {description && (
        <Typography sx={{ fontSize: 12.5, color: tokens.text2, mt: 0.25, mb: 1.5 }}>{description}</Typography>
      )}
      <Box sx={{ mt: description ? 0 : 1.5 }}>{children}</Box>
    </Paper>
  );
}

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => setError(aiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      const { status, updated_at, ...payload } = settings;
      void status;
      void updated_at;
      setSettings(await updateSettings(payload));
      setSaved(true);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress size={26} />
      </Box>
    );
  }

  if (!settings) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || "AI settings could not be loaded."}</Alert>
      </Box>
    );
  }

  const { status } = settings;

  return (
    <Box sx={{ p: 3, maxWidth: 1000 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="h4" sx={{ fontSize: 24 }}>
          AI Automation
        </Typography>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </Stack>
      <Typography sx={{ fontSize: 13, color: tokens.text2, mb: 2 }}>
        Provider and automation schedule.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>AI settings saved.</Alert>}

      {status.offline_fallback && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>{status.configured_provider}</strong> is selected but no API key is set on the server, so
          the offline provider is answering with placeholder text. Set{" "}
          <code>{`${status.configured_provider.toUpperCase()}_API_KEY`}</code> in the
          backend environment and restart to enable real analysis.
        </Alert>
      )}

      {/* The tab row KOS uses elsewhere (CRM, My Work): a 2px accent underline. */}
      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {TABS.map((t, i) => (
          <Box
            key={t}
            onClick={() => setTab(i)}
            sx={{
              cursor: "pointer", px: 1.5, py: 1.1, fontSize: 13.5, fontWeight: 500,
              color: tab === i ? tokens.kriyaInk : tokens.text2,
              borderBottom: `2px solid ${tab === i ? tokens.kriya : "transparent"}`,
              mb: "-1px",
            }}
          >
            {t}
          </Box>
        ))}
      </Stack>

      {/* --- configuration --- */}
      {tab === 0 && (
        <Stack spacing={2}>
          <SectionCard title="Provider" description="Which AI service KOS calls. Switching provider changes nothing else in the system.">
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  select
                  size="small"
                  label="Provider"
                  value={settings.provider}
                  onChange={(e) => update("provider", e.target.value)}
                  sx={{ minWidth: 220 }}
                >
                  {PROVIDERS.map((p) => (
                    <MenuItem key={p.value} value={p.value}>
                      {p.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Model"
                  placeholder="provider default"
                  value={settings.model}
                  onChange={(e) => update("model", e.target.value)}
                  sx={{ minWidth: 220 }}
                />
                <TextField
                  size="small"
                  label="Base URL override"
                  placeholder="provider default"
                  value={settings.base_url}
                  onChange={(e) => update("base_url", e.target.value)}
                  sx={{ minWidth: 260 }}
                />
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={status.key_configured ? "API key present" : "No API key"}
                  sx={{
                    height: 20, fontSize: 10.5,
                    bgcolor: status.key_configured ? tokens.kriyaWash : "#F1F3F5",
                    color: status.key_configured ? tokens.kriyaInk : tokens.text2,
                  }}
                />
                <Chip
                  size="small"
                  label={`Answering: ${status.active_provider}`}
                  sx={{ height: 20, fontSize: 10.5, bgcolor: "#F1F3F5", color: tokens.text2 }}
                />
                {status.model && (
                  <Chip size="small" label={status.model} sx={{ height: 20, fontSize: 10.5, bgcolor: "#F1F3F5", color: tokens.text2 }} />
                )}
                <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
                  The API key is held in the server environment and is never sent to the browser.
                </Typography>
              </Stack>

              <Divider />

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  size="small" type="number" label="Temperature" inputProps={{ step: 0.1, min: 0, max: 2 }}
                  value={settings.temperature}
                  onChange={(e) => update("temperature", Number(e.target.value))}
                  sx={{ width: 150 }}
                />
                <TextField
                  size="small" type="number" label="Max tokens" value={settings.max_tokens}
                  onChange={(e) => update("max_tokens", Number(e.target.value))}
                  sx={{ width: 150 }}
                />
                <TextField
                  size="small" type="number" label="Timeout (seconds)" value={settings.timeout_seconds}
                  onChange={(e) => update("timeout_seconds", Number(e.target.value))}
                  sx={{ width: 170 }}
                />
              </Stack>
            </Stack>
          </SectionCard>

          <SectionCard title="Master switches">
            <Stack>
              <FormControlLabel
                control={<Switch checked={settings.is_enabled} onChange={(e) => update("is_enabled", e.target.checked)} />}
                label="AI features enabled"
              />
              <FormControlLabel
                control={<Switch checked={settings.automation_enabled} onChange={(e) => update("automation_enabled", e.target.checked)} />}
                label="Scheduled automations enabled"
              />
              <FormControlLabel
                control={<Switch checked={settings.email_enabled} onChange={(e) => update("email_enabled", e.target.checked)} />}
                label="Automations may send email"
              />
            </Stack>
          </SectionCard>

          <SectionCard title="Guard rails" description="Caps that bound cost and blast radius if something misbehaves.">
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <TextField
                size="small" type="number" label="Max calls per hour" helperText="0 = unlimited"
                value={settings.max_calls_per_hour}
                onChange={(e) => update("max_calls_per_hour", Number(e.target.value))}
                sx={{ width: 190 }}
              />
              <TextField
                size="small" type="number" label="Max items per scan"
                helperText="Records one scheduled scan will process"
                value={settings.max_items_per_scan}
                onChange={(e) => update("max_items_per_scan", Number(e.target.value))}
                sx={{ width: 230 }}
              />
            </Stack>
          </SectionCard>
        </Stack>
      )}

      {/* --- automation --- */}
      {tab === 1 && (
        <Stack spacing={2}>
          <SectionCard title="Scheduled scans" description="Each runs on its own cadence and can be switched off independently.">
            <Stack spacing={0.5}>
              {AUTOMATION_TOGGLES.map((toggle) => (
                <Box key={String(toggle.key)}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(settings[toggle.key])}
                        onChange={(e) => update(toggle.key, e.target.checked as never)}
                      />
                    }
                    label={
                      <Box>
                        <Typography sx={{ fontSize: 13.5 }}>{toggle.label}</Typography>
                        <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>{toggle.detail}</Typography>
                      </Box>
                    }
                  />
                </Box>
              ))}
            </Stack>
          </SectionCard>

          <SectionCard
            title="Escalation ladder"
            description="How an overdue task climbs from a gentle nudge to a formal escalation. Each step must come after the one before it."
          >
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <TextField
                size="small" type="number" label="Repeat reminder after (minutes)"
                value={settings.reminder_repeat_minutes}
                onChange={(e) => update("reminder_repeat_minutes", Number(e.target.value))}
                sx={{ width: 250 }}
              />
              <TextField
                size="small" type="number" label="Notify manager after (hours)"
                value={settings.manager_notify_hours}
                onChange={(e) => update("manager_notify_hours", Number(e.target.value))}
                sx={{ width: 230 }}
              />
              <TextField
                size="small" type="number" label="Escalate after (hours)"
                value={settings.escalate_hours}
                onChange={(e) => update("escalate_hours", Number(e.target.value))}
                sx={{ width: 200 }}
              />
            </Stack>
            {/* The ladder drawn as the sequence it is — each rung fires only
                after the one before it. */}
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 1.25, mt: 2.5 }}>
              {[
                { stage: "Detected", action: "Owner reminded", when: "immediately" },
                { stage: "Repeat", action: "Reminded again", when: `+${settings.reminder_repeat_minutes} min` },
                { stage: "Manager", action: "Manager notified", when: `+${settings.manager_notify_hours} hours` },
                { stage: "Escalate", action: "Leadership", when: `+${settings.escalate_hours} hours` },
              ].map((rung, i) => (
                <Box
                  key={rung.stage}
                  sx={{
                    border: `1px solid ${tokens.line}`,
                    borderTop: `3px solid ${LADDER_STEPS[i]}`,
                    borderRadius: "6px",
                    p: 1.4,
                    bgcolor: tokens.paper,
                  }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: tokens.text3 }}>
                    {rung.stage}
                  </Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 0.4 }}>{rung.action}</Typography>
                  <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3, mt: 0.4 }}>
                    {rung.when}
                  </Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        </Stack>
      )}
    </Box>
  );
}
