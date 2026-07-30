/**
 * Typed field schema for workspace sections.
 *
 * A section's fields drive both the field builder (Fields tab) and the record
 * "Add" form (Records tab). Built-in sections start from their config field
 * labels (converted to typed fields); once customised, the schema is persisted
 * on the section's `fields` array. Record values are stored in the record's
 * `data` payload keyed by field label, so display stays stable across edits.
 */

export type FieldType =
  | "text"
  | "paragraph"
  | "dropdown"
  | "radio"
  | "checkbox"
  | "number"
  | "date"
  | "file";

export interface FieldDef {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: string[];
}

export type FieldGroup = "text" | "choice" | "value" | "media";

/** Four families the picker groups field types under, each with its own accent. */
export const FIELD_GROUPS: Record<FieldGroup, { name: string; color: string; soft: string }> = {
  text: { name: "Text", color: "#0F7A8B", soft: "#E6F3F5" },
  choice: { name: "Choice", color: "#7C5CD6", soft: "#EFEBFB" },
  value: { name: "Value", color: "#2E7DE0", soft: "#E6EEF8" },
  media: { name: "Media", color: "#C07A1E", soft: "#F7ECDA" },
};

export const TYPE_ORDER: FieldGroup[] = ["text", "choice", "value", "media"];

export const FIELD_TYPES: Record<
  FieldType,
  { label: string; glyph: string; group: FieldGroup; hasOptions?: boolean }
> = {
  text: { label: "Short text", glyph: "Ab", group: "text" },
  paragraph: { label: "Paragraph", glyph: "¶", group: "text" },
  dropdown: { label: "Dropdown", glyph: "▾", group: "choice", hasOptions: true },
  radio: { label: "Radio group", glyph: "◉", group: "choice", hasOptions: true },
  checkbox: { label: "Checkboxes", glyph: "☑", group: "choice", hasOptions: true },
  number: { label: "Number", glyph: "#", group: "value" },
  date: { label: "Date", glyph: "▦", group: "value" },
  file: { label: "File upload", glyph: "⤒", group: "media" },
};

let _seq = 0;
/** A short, collision-resistant id for a field within a section. */
export const fieldId = (): string => `f${Date.now().toString(36)}${(_seq++).toString(36)}`;

export function newField(type: FieldType): FieldDef {
  const t = FIELD_TYPES[type];
  const f: FieldDef = { id: fieldId(), type, label: t.label, placeholder: "", help: "", required: false };
  if (t.hasOptions) f.options = ["Option 1", "Option 2", "Option 3"];
  return f;
}

/**
 * Convert a legacy `string[]` field list (from `workspaces.tsx`) into typed
 * fields, so built-in sections open with sensible defaults. Description-like
 * labels become paragraphs; everything else is short text.
 */
export function stringsToFields(labels: string[]): FieldDef[] {
  return labels.map((label) => ({
    id: fieldId(),
    type: /description|notes|remarks|details|comment|summary/i.test(label) ? "paragraph" : "text",
    label,
    placeholder: "",
    help: "",
    required: false,
  }));
}

/** Normalise a persisted schema (may be `unknown` from the API) into FieldDefs. */
export function toFieldDefs(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is FieldDef => !!f && typeof f === "object" && typeof (f as FieldDef).type === "string")
    .map((f) => ({ ...f, id: f.id || fieldId() }));
}

const PRIMARY_RE = /name|title|description|subject/i;

/** The headline field — shown as a record's title and required to save. */
export function primaryField(fields: FieldDef[]): FieldDef | undefined {
  return fields.find((f) => PRIMARY_RE.test(f.label)) ?? fields[0];
}

/** A field whose value carries a datetime duration (Entomology steps). */
export const isDurationField = (f: FieldDef): boolean => /duration/i.test(f.label);
