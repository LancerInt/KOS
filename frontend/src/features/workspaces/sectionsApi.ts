import { api } from "../../api/client";
import type { FieldDef } from "./fields";

export interface WorkspaceSection {
  id: number;
  project: number;
  /** Parent section id — null for a top-level section. Sections nest to any depth. */
  parent: number | null;
  workspace: string;
  name: string;
  blurb: string;
  fields: FieldDef[];
  /** Lowercased name of the built-in section this row adopts; "" for a custom
   *  one. Identity for a built-in, so it survives a rename — see sectionTree. */
  builtin_key: string;
  hidden: boolean;
  created_by: number | null;
  created_at: string;
}

/** Every section for a project, at every depth, in one unpaginated call — the
 *  client assembles the tree from `parent`. */
export const listSections = (project: number) =>
  api.get<WorkspaceSection[]>("/workspace-sections/", { params: { project } }).then((r) => r.data);

/** Options rather than positionals: `hidden` was already the fifth positional
 *  argument, and slotting `parent` in beside it is exactly the kind of call-site
 *  mix-up that ships silently. */
export interface CreateSectionInput {
  project: number;
  name: string;
  blurb?: string;
  fields?: FieldDef[];
  hidden?: boolean;
  parent?: number | null;
  /** Set when the row is adopting a built-in section, so a later rename can't
   *  detach it from the built-in it stands for. */
  builtinKey?: string;
}

export const createSection = (input: CreateSectionInput) =>
  api.post<WorkspaceSection>("/workspace-sections/", {
    project: input.project,
    name: input.name,
    blurb: input.blurb ?? "",
    fields: input.fields ?? [],
    hidden: input.hidden ?? false,
    parent: input.parent ?? null,
    builtin_key: input.builtinKey ?? "",
  }).then((r) => r.data);

/** Patch a section — persist its field schema, name/blurb, hidden flag or parent.
 *  `builtin_key` is accepted only to backfill a row adopted before the column
 *  existed; the server rejects any attempt to repoint an existing one. */
export const updateSection = (
  id: number,
  patch: {
    name?: string; blurb?: string; fields?: FieldDef[];
    hidden?: boolean; parent?: number | null; builtin_key?: string;
  },
) => api.patch<WorkspaceSection>(`/workspace-sections/${id}/`, patch).then((r) => r.data);

export const deleteSection = (id: number) => api.delete(`/workspace-sections/${id}/`);
