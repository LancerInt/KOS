import { useCallback, useEffect, useState } from "react";
import { IconButton, Tooltip } from "@mui/material";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";

import { tokens } from "../../theme";

/**
 * Read an AI reply aloud, using the browser's own speech synthesis — no server
 * call, no cost, works offline. Off unless asked for: nothing here ever starts
 * talking on its own.
 *
 * Only one thing speaks at a time. `speechSynthesis` is a single global queue,
 * so starting a second reply without cancelling the first would have them read
 * back to back minutes later, long after the user moved on.
 */

const supported = typeof window !== "undefined" && "speechSynthesis" in window;

/** Strip the markdown the model writes so it isn't read out as punctuation —
 *  "star star overdue star star" is not a sentence anyone wants to hear. */
function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s*/gm, ", ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default function SpeakButton({ text, size = 15 }: { text: string; size?: number }) {
  const [speaking, setSpeaking] = useState(false);

  // Leaving the page (or the drawer) must not leave a voice running.
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, []);

  const toggle = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    // Cancel first either way: stopping this one, or displacing another reply
    // that is still talking.
    synth.cancel();
    if (speaking) { setSpeaking(false); return; }

    const body = speakable(text);
    if (!body) return;
    const utterance = new SpeechSynthesisUtterance(body);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1.02;              // a touch above default; plainer to follow
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }, [speaking, text]);

  if (!supported || !text.trim()) return null;

  return (
    <Tooltip title={speaking ? "Stop" : "Read aloud"}>
      <IconButton size="small" onClick={toggle} aria-label={speaking ? "Stop reading" : "Read aloud"}
        sx={{ color: speaking ? tokens.kriyaInk : tokens.text3, p: 0.4,
          "&:hover": { color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.08)" } }}>
        {speaking ? <StopRoundedIcon sx={{ fontSize: size }} /> : <VolumeUpRoundedIcon sx={{ fontSize: size }} />}
      </IconButton>
    </Tooltip>
  );
}
