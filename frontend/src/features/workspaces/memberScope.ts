/** The contract `MembersDialog` drives.
 *
 * Workspaces and projects both hand out per-user access the same way — a roster
 * of people, a candidate list drawn from the workspace's team, add and remove —
 * so they share one dialog and differ only in the endpoints behind these four
 * calls. Build a scope with `workspaceMemberScope` / `projectMemberScope`.
 */

/** A person on a roster. Both endpoints return this shape (plus their own key). */
export interface MemberRow {
  id: number;
  user: number;
  user_name: string;
  user_email: string;
  added_by: number | null;
  added_by_name: string;
  created_at: string;
}

/** A candidate who may be added — someone on the workspace's team who isn't on
 *  this roster yet. */
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

export interface MemberScope {
  list(): Promise<MemberRow[]>;
  addable(): Promise<Addable>;
  add(user: number): Promise<unknown>;
  remove(id: number): Promise<unknown>;
}
