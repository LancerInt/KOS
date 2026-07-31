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

/** A deleted workspace item (project/section/record) for the Archive log. */
export interface DeletedItem {
  id: number;
  kind: string;       // "project" | "section" | "record"
  name: string;
  workspace: string;  // workspace key
  context: string;    // parent project / category
  actor: string;      // who deleted it (shown to supervisors)
  at: string;         // ISO timestamp
}

export interface DeletedItemsResponse {
  is_supervisor: boolean;   // true for IT Team / Management / admin — they see everyone's
  items: DeletedItem[];
}

export const listDeletedItems = () =>
  api.get<DeletedItemsResponse>("/workspaces/deleted-items/").then((r) => r.data);
