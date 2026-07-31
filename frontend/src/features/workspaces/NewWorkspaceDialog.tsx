import { useState } from "react";
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { createWorkspace, type WorkspaceDomain } from "./workspacesApi";
import { loadDynamicWorkspaces, ICON_REGISTRY, ICON_OPTIONS, ACCENT_OPTIONS } from "./workspaces";
import { suggestWorkspace, aiErrorMessage } from "../ai/aiApi";
import { useAppSelector } from "../../hooks";
import { tokens } from "../../theme";

const AI = "#7C5CD6";

const DOMAIN_LABEL: Record<WorkspaceDomain, string> = { research: "Research", executive: "Executive" };

export default function NewWorkspaceDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const user = useAppSelector((s) => s.auth.user);
  const roleNames = user?.role_names ?? [];
  // The creator's own team forces the domain; a neutral creator (IT / Management
  // / admin — no Researcher/Executive role) chooses it.
  const autoDomain: WorkspaceDomain | null =
    roleNames.includes("Researcher") ? "research" : roleNames.includes("Executive") ? "executive" : null;

  const [label, setLabel] = useState("");
  const [blurb, setBlurb] = useState("");
  const [icon, setIcon] = useState("folder");
  const [accent, setAccent] = useState(ACCENT_OPTIONS[0]);
  const [chosenDomain, setChosenDomain] = useState<WorkspaceDomain>("research");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const domain = autoDomain ?? chosenDomain;

  const draftWithAi = async () => {
    const p = aiPrompt.trim();
    if (!p) return;
    setAiBusy(true); setErr("");
    try {
      const outcome = await suggestWorkspace(p);
      const s = outcome.data;
      if (s.label) setLabel(s.label);
      if (s.blurb) setBlurb(s.blurb);
      if (s.icon && ICON_OPTIONS.includes(s.icon)) setIcon(s.icon);
      if (s.accent && /^#[0-9a-fA-F]{6}$/.test(s.accent)) setAccent(s.accent);
    } catch (e) {
      setErr(aiErrorMessage(e));
    } finally {
      setAiBusy(false);
    }
  };

  const reset = () => {
    setLabel(""); setBlurb(""); setIcon("folder"); setAccent(ACCENT_OPTIONS[0]); setChosenDomain("research"); setErr(""); setAiPrompt("");
  };
  const close = () => { reset(); onClose(); };

  const save = async () => {
    const name = label.trim();
    if (!name) return;
    setSaving(true); setErr("");
    try {
      const ws = await createWorkspace({ label: name, blurb: blurb.trim(), icon, accent, domain });
      await loadDynamicWorkspaces(true);
      reset();
      onCreated(ws.key);
    } catch (e) {
      const detail = (e as { response?: { data?: { label?: string[] } } }).response?.data?.label?.[0];
      setErr(detail ?? "Could not create the workspace.");
    } finally {
      setSaving(false);
    }
  };

  const SwatchIcon = ICON_REGISTRY[icon];

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New workspace</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {/* Draft the whole thing from a prompt */}
          <Box sx={{ p: 1.5, borderRadius: "11px", border: `1px solid ${AI}33`, bgcolor: "#F7F5FD" }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField size="small" fullWidth multiline maxRows={3}
                placeholder="Describe it and let AI name it & pick an icon — e.g. 'European distributor onboarding'"
                value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                sx={{ "& .MuiOutlinedInput-root": { bgcolor: "#fff" } }} />
              <Button onClick={draftWithAi} disabled={aiBusy || !aiPrompt.trim()} variant="contained"
                startIcon={aiBusy ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />}
                sx={{ flexShrink: 0, bgcolor: AI, "&:hover": { bgcolor: "#5B41A5" } }}>
                {aiBusy ? "…" : "Draft"}
              </Button>
            </Stack>
          </Box>

          {/* live preview */}
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ width: 44, height: 44, borderRadius: "11px", display: "grid", placeItems: "center",
              color: "#fff", background: `linear-gradient(150deg, ${accent}cc, ${accent})` }}>
              <SwatchIcon sx={{ fontSize: 23 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 16 }} noWrap>
                {label.trim() || "Workspace name"}
              </Typography>
              <Typography sx={{ fontSize: 12, color: tokens.text3 }}>Starts empty · you add sections per project</Typography>
            </Box>
          </Stack>

          <TextField size="small" label="Name" value={label} autoFocus fullWidth
            onChange={(e) => setLabel(e.target.value)} />
          <TextField size="small" label="Description (optional)" value={blurb} fullWidth multiline minRows={2}
            onChange={(e) => setBlurb(e.target.value)} />

          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3, mb: 0.75 }}>Icon</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {ICON_OPTIONS.map((name) => {
                const Ic = ICON_REGISTRY[name];
                const on = name === icon;
                return (
                  <Box key={name} onClick={() => setIcon(name)}
                    sx={{ width: 34, height: 34, borderRadius: "8px", display: "grid", placeItems: "center", cursor: "pointer",
                      border: `1px solid ${on ? accent : tokens.line}`, bgcolor: on ? `${accent}14` : "#fff",
                      color: on ? accent : tokens.text2, "&:hover": { borderColor: accent } }}>
                    <Ic sx={{ fontSize: 19 }} />
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3, mb: 0.75 }}>Colour</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {ACCENT_OPTIONS.map((c) => (
                <Box key={c} onClick={() => setAccent(c)}
                  sx={{ width: 24, height: 24, borderRadius: "50%", bgcolor: c, cursor: "pointer",
                    boxShadow: accent === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : "none" }} />
              ))}
            </Box>
          </Box>

          {!autoDomain && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3, mb: 0.75 }}>Access</Typography>
              <Box sx={{ display: "inline-flex", p: "3px", borderRadius: "9px", bgcolor: "#EEF0F3", border: `1px solid ${tokens.line}` }}>
                {(["research", "executive"] as WorkspaceDomain[]).map((d) => {
                  const on = chosenDomain === d;
                  return (
                    <Box key={d} component="button" type="button" onClick={() => setChosenDomain(d)}
                      sx={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12.5,
                        px: 1.75, py: 0.75, borderRadius: "7px",
                        color: on ? tokens.kriyaInk : tokens.text2, bgcolor: on ? "#fff" : "transparent",
                        boxShadow: on ? "0 1px 2px rgba(20,22,29,.12)" : "none" }}>
                      {DOMAIN_LABEL[d]}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || !label.trim()}>
          {saving ? "Creating…" : "Create workspace"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
