import { api } from "../../api/client";
import type { Addable, MemberRow, MemberScope } from "./memberScope";

export type { Addable, AddableUser } from "./memberScope";

/** A person granted need-to-know access to one workspace. Members hold full
 * edit and may add/remove other members of the same team. */
export interface WorkspaceMember extends MemberRow {
  workspace: string;
  access: "view" | "edit";
}

export const listMembers = (workspace: string) =>
  api.get<WorkspaceMember[]>("/workspace-members/", { params: { workspace } }).then((r) => r.data);

export const addableMembers = (workspace: string) =>
  api.get<Addable>("/workspace-members/addable/", { params: { workspace } }).then((r) => r.data);

export const addMember = (workspace: string, user: number) =>
  api.post<WorkspaceMember>("/workspace-members/", { workspace, user }).then((r) => r.data);

export const removeMember = (id: number) => api.delete(`/workspace-members/${id}/`);

/** Who can open a whole workspace — the roster `MembersDialog` edits. */
export const workspaceMemberScope = (workspace: string): MemberScope => ({
  list: () => listMembers(workspace),
  addable: () => addableMembers(workspace),
  add: (user) => addMember(workspace, user),
  remove: (id) => removeMember(id),
});
