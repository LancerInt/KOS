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

export const workspaceAccent = (key?: string): Accent => (key && MAP[key]) || DEFAULT;
