import { api } from "../../api/client";

/** A user-added workspace (the 11 built-ins live in `workspaces.tsx`). */
export interface DynamicWorkspace {
  id: number;
  key: string;
  label: string;
  blurb: string;
  icon: string;     // name → ICON_REGISTRY in workspaces.tsx
  accent: string;   // hex "#RRGGBB" (may be empty → default)
  order: number;
  archived_at: string | null;
  is_archived: boolean;
  days_left: number | null;   // days until auto-purge (archived only)
  created_at: string;
}

/** A workspace belongs to one domain team (Researcher XOR Executive). */
export type WorkspaceDomain = "research" | "executive";

export interface NewWorkspace {
  label: string;
  blurb?: string;
  icon?: string;
  accent?: string;
  domain?: WorkspaceDomain;   // used only for neutral creators (IT/Management/admin)
}

export const listWorkspaces = () =>
  api.get<DynamicWorkspace[]>("/workspaces/").then((r) => r.data);

export const listArchivedWorkspaces = () =>
  api.get<DynamicWorkspace[]>("/workspaces/", { params: { archived: 1 } }).then((r) => r.data);

export const createWorkspace = (payload: NewWorkspace) =>
  api.post<DynamicWorkspace>("/workspaces/", payload).then((r) => r.data);

/** Archive (soft-delete) a workspace — recoverable for 30 days. */
export const archiveWorkspace = (key: string) => api.delete(`/workspaces/${key}/`);

export const restoreWorkspace = (key: string) =>
  api.post<DynamicWorkspace>(`/workspaces/${key}/restore/`).then((r) => r.data);

/** A soft-deleted workspace item (project/section/record) in the Archive. */
export interface DeletedItem {
  id: number;
  kind: "project" | "section" | "record";
  name: string;
  workspace: string;  // workspace key
  context: string;    // parent project / category
  actor: string;      // who deleted it (shown to supervisors)
  at: string;         // ISO timestamp of deletion
  days_left: number;  // days until permanent purge
}

export interface DeletedItemsResponse {
  is_supervisor: boolean;   // true for IT Team / Management / admin — they see everyone's
  items: DeletedItem[];
}

export const listDeletedItems = () =>
  api.get<DeletedItemsResponse>("/workspaces/deleted-items/").then((r) => r.data);

/** Restore a soft-deleted project/section/record back into its workspace. */
export const restoreDeletedItem = (kind: DeletedItem["kind"], id: number) =>
  api.post("/workspaces/deleted-items/", { kind, id }).then((r) => r.data);
