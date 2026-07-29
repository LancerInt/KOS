import { createTheme } from "@mui/material/styles";

/**
 * KOS design system — "Ink & Flow".
 *
 * A calm, operational palette: a soft near-white canvas, ink structure, a
 * confident brand teal for actions, and a single warm coral reserved only for
 * "needs your attention" moments (the 48-hour acknowledgement model, PRD §22.4).
 * Type: Manrope (display/numbers), IBM Plex Sans (UI), IBM Plex Mono (IDs/codes).
 */

export const tokens = {
  ink: "#16181D",
  ink2: "#262A33",
  paper: "#FBFAF6",
  surface: "#FFFFFF",
  line: "#E5E7EB",
  text: "#1B1E25",
  text2: "#5A6373",
  text3: "#8A93A3",
  kriya: "#0F7A8B",
  kriyaInk: "#0B5D6B",
  kriyaGlow: "#16B8C9",
  kriyaWash: "#E6F3F5",
  attn: "#E05A3C",
  attnWash: "#FCEAE4",
} as const;

/** Six canonical status categories (PRD §12.1) — used system-wide, incl. the Flow Rail. */
export const categoryColors = {
  notStarted: "#9AA3B2",
  active: "#2E7DE0",
  waiting: "#E0A83D",
  inReview: "#7C5CD6",
  done: "#2FA36B",
  cancelled: "#A65A6E",
} as const;

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: tokens.kriya, dark: tokens.kriyaInk, light: tokens.kriyaGlow, contrastText: "#FFFFFF" },
    error: { main: tokens.attn },
    background: { default: tokens.paper, paper: tokens.surface },
    text: { primary: tokens.text, secondary: tokens.text2 },
    divider: tokens.line,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
    // Give every heading variant a little more line-height than MUI's tight
    // defaults so descenders (the tail of "y", "g", "p") always render fully.
    h1: { fontFamily: '"Manrope Variable", sans-serif', fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25 },
    h2: { fontFamily: '"Manrope Variable", sans-serif', fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25 },
    h3: { fontFamily: '"Manrope Variable", sans-serif', fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 },
    h4: { fontFamily: '"Manrope Variable", sans-serif', fontWeight: 600, lineHeight: 1.3 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // IBM Plex Sans and Manrope both render noticeably crisper with grayscale
        // smoothing; optimizeLegibility keeps kerning consistent across pages.
        html: { WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale", textRendering: "optimizeLegibility" },
        body: { letterSpacing: "0.01em" },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none", border: `1px solid ${tokens.line}` },
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});

/** Monospace stack for IDs, project codes, timestamps, audit values. */
export const monoFont = '"IBM Plex Mono", ui-monospace, monospace';
