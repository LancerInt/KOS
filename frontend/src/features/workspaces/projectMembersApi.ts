import { api } from "../../api/client";
import type { Addable, MemberRow, MemberScope } from "./memberScope";

/** A person on one project's roster.
 *
 * Project membership sits a tier below workspace membership and narrows it, but
 * only when it is used: a project with **no** members is open to everyone who
 * can open its workspace, and becomes members-only the moment the first person
 * is listed. Emptying the roster re-opens it. Joining a project also joins its
 * workspace, so a member can always reach what they were given. */
export interface ProjectMember extends MemberRow {
  project: number;
}

export const listProjectMembers = (project: number) =>
  api.get<ProjectMember[]>("/workspace-project-members/", { params: { project } }).then((r) => r.data);

export const addableProjectMembers = (project: number) =>
  api.get<Addable>("/workspace-project-members/addable/", { params: { project } }).then((r) => r.data);

export const addProjectMember = (project: number, user: number) =>
  api.post<ProjectMember>("/workspace-project-members/", { project, user }).then((r) => r.data);

export const removeProjectMember = (id: number) => api.delete(`/workspace-project-members/${id}/`);

/** Who can open one project — the roster `MembersDialog` edits. */
export const projectMemberScope = (project: number): MemberScope => ({
  list: () => listProjectMembers(project),
  addable: () => addableProjectMembers(project),
  add: (user) => addProjectMember(project, user),
  remove: (id) => removeProjectMember(id),
});
