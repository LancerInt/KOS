import { useEffect, useRef, useState } from "react";
import { Box, CircularProgress, IconButton, Popper, Stack, Tooltip, Typography } from "@mui/material";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";

import { useDictation } from "./dictation";
import { tokens } from "../../theme";

/**
 * Dictate into any text input. Drop it beside a field and append what it gives
 * you — every AI input in KOS uses this one button.
 *
 * It renders nothing at all where the browser can offer no dictation, rather
 * than showing a control that would fail on click. While listening it pulses
 * red and turns into a stop button, because the one thing a person needs to
 * know from across the room is whether the microphone is still open.
 */
export default function MicButton({
  onText, disabled, size = "small", hint = "Dictate", onError,
}: {
  /** A finished chunk of speech. Append it — dictation adds to a draft. */
  onText: (text: string) => void;
  disabled?: boolean;
  size?: "small" | "medium";
  /** Tooltip when idle, e.g. "Dictate your prompt". */
  hint?: string;
  /** Surface a dictation failure in the consumer's own error slot. */
  onError?: (message: string) => void;
}) {
  const { supported, state, interim, toggle, error } = useDictation(onText);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // The hook owns the message; the consumer owns where errors belong on its
  // own screen. Reported in an effect, never during render — calling a parent's
  // setState mid-render is what produces React's cross-component update warning.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => { if (error) onErrorRef.current?.(error); }, [error]);

  if (!supported) return null;

  const listening = state === "listening";
  const busy = state === "transcribing";
  const label = busy ? "Transcribing…" : listening ? "Stop dictating" : hint;

  return (
    <>
    {/* Live feedback, and the whole reason this isn't just an icon. Recognition
        can take a second to produce its first words, and Chrome sends the audio
        away to be recognised — so without something on screen reacting the
        moment you speak, a working microphone and a broken one look identical. */}
    <Popper open={listening || busy} anchorEl={anchor} placement="top-end"
      sx={{ zIndex: (t) => t.zIndex.modal + 2, maxWidth: 320, pointerEvents: "none" }}>
      <Box sx={{ mb: 0.75, px: 1.25, py: 0.75, borderRadius: "8px", bgcolor: tokens.ink, color: "#fff",
        boxShadow: "0 6px 20px rgba(20,22,29,.28)" }}>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            bgcolor: busy ? "#9AA3B2" : tokens.attn,
            animation: busy ? "none" : "kos-mic-blink 1s ease-in-out infinite",
            "@keyframes kos-mic-blink": { "0%,100%": { opacity: 1 }, "50%": { opacity: .25 } } }} />
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
            {busy ? "Transcribing…" : "Listening"}
          </Typography>
        </Stack>
        {interim && (
          <Typography sx={{ fontSize: 12, opacity: .85, mt: 0.4, lineHeight: 1.4 }}>{interim}</Typography>
        )}
      </Box>
    </Popper>

    <Tooltip title={label}>
      {/* span: a disabled button fires no events, so the tooltip needs a host */}
      <span ref={setAnchor}>
        <IconButton
          size={size}
          onClick={toggle}
          disabled={disabled || busy}
          aria-label={label}
          sx={{
            color: listening ? "#fff" : tokens.text3,
            bgcolor: listening ? tokens.attn : "transparent",
            "&:hover": listening
              ? { bgcolor: tokens.attn }
              : { color: tokens.kriyaInk, bgcolor: "rgba(15,122,139,.08)" },
            ...(listening && {
              animation: "kos-mic-pulse 1.4s ease-in-out infinite",
              "@keyframes kos-mic-pulse": {
                "0%, 100%": { boxShadow: `0 0 0 0 ${tokens.attn}66` },
                "50%": { boxShadow: `0 0 0 6px ${tokens.attn}00` },
              },
            }),
          }}
        >
          {busy ? (
            <CircularProgress size={size === "small" ? 15 : 18} color="inherit" />
          ) : listening ? (
            <StopRoundedIcon sx={{ fontSize: size === "small" ? 17 : 20 }} />
          ) : (
            <MicRoundedIcon sx={{ fontSize: size === "small" ? 17 : 20 }} />
          )}
        </IconButton>
      </span>
    </Tooltip>
    </>
  );
}
