import { api } from "../../api/client";

/** A person granted need-to-know access to one workspace. Members hold full
 * edit and may add/remove other members of the same team. */
export interface WorkspaceMember {
  id: number;
  workspace: string;
  user: number;
  user_name: string;
  user_email: string;
  access: "view" | "edit";
  added_by: number | null;
  added_by_name: string;
  created_at: string;
}

/** A candidate who may be added to a workspace (its team, not already a member). */
export interface AddableUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface Addable {
  domain: "research" | "executive" | null;
  users: AddableUser[];
}

export const listMembers = (workspace: string) =>
  api.get<WorkspaceMember[]>("/workspace-members/", { params: { workspace } }).then((r) => r.data);

export const addableMembers = (workspace: string) =>
  api.get<Addable>("/workspace-members/addable/", { params: { workspace } }).then((r) => r.data);

export const addMember = (workspace: string, user: number) =>
  api.post<WorkspaceMember>("/workspace-members/", { workspace, user }).then((r) => r.data);

export const removeMember = (id: number) => api.delete(`/workspace-members/${id}/`);
