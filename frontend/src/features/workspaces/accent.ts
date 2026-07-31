import { tokens } from "../../theme";

/**
 * Each workspace gets its own identity hue — used on the header badge and the
 * project "shelf" cards — over one shared layout. base = the accent, ink = a
 * darker shade for text/gradients, soft = a pale wash for tints.
 */
export interface Accent { base: string; ink: string; soft: string; }

const MAP: Record<string, Accent> = {
  "amazon-usa": { base: "#C07A1E", ink: "#8A551A", soft: "#F7ECDA" },           // marketplace marigold
  "cibrc": { base: "#3F6CB5", ink: "#2C4E85", soft: "#E9EEF7" },                // regulatory blue
  "epa-reg": { base: "#2E8B6B", ink: "#1F6650", soft: "#E3F1EC" },              // environmental green
  "marketing-marathon": { base: "#C0417A", ink: "#93305C", soft: "#F9E7F0" },   // campaign magenta
  "crm": { base: "#1F9AA6", ink: "#147078", soft: "#E0F1F3" },                  // relationship cyan
  "exhibition-b2c": { base: "#7C5CD6", ink: "#5B41A5", soft: "#EFEBFB" },        // event purple
  "distribution-us": { base: "#4A6572", ink: "#354A54", soft: "#E8EDEF" },       // logistics slate
  "social-media": { base: "#C15B8A", ink: "#94436A", soft: "#FAE9F1" },          // social rose
  "website-biodesk": { base: "#5C6BC0", ink: "#3F4E9E", soft: "#ECEEF9" },        // product periwinkle
  "entomology": { base: "#5B8C3E", ink: "#446A2E", soft: "#EBF1E2" },            // lab green
  "finance-statutory": { base: "#B08A24", ink: "#7F631A", soft: "#F5EED9" },      // statutory gold
};

const DEFAULT: Accent = { base: tokens.kriya, ink: tokens.kriyaInk, soft: tokens.kriyaWash };

/** Build an {base, ink, soft} accent from a single hex — for dynamic workspaces
 *  whose colour is chosen at creation. ink = a darkened shade, soft = a pale wash. */
export function accentFromHex(hex?: string): Accent {
  if (!hex || !/^#([0-9a-f]{6})$/i.test(hex)) return DEFAULT;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number, t: number, amt: number) => Math.round(c + (t - c) * amt);
  const hx = (c: number) => c.toString(16).padStart(2, "0");
  const ink = `#${hx(mix(r, 0, 0.32))}${hx(mix(g, 0, 0.32))}${hx(mix(b, 0, 0.32))}`;   // 32% toward black
  const soft = `#${hx(mix(r, 255, 0.86))}${hx(mix(g, 255, 0.86))}${hx(mix(b, 255, 0.86))}`; // 86% toward white
  return { base: hex, ink, soft };
}

// Accents for dynamic workspaces, registered at load time (keyed by their slug).
const DYNAMIC: Record<string, Accent> = {};
export function registerDynamicAccents(entries: { key: string; accent?: string }[]): void {
  for (const e of entries) if (e.accent) DYNAMIC[e.key] = accentFromHex(e.accent);
}

export const workspaceAccent = (key?: string): Accent =>
  (key && (MAP[key] || DYNAMIC[key])) || DEFAULT;
