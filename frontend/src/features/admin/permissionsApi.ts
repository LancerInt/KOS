import { api } from "../../api/client";

export type WsAccess = "view" | "edit";

export interface WorkspacePermission {
  id: number;
  role: number;
  workspace: string;
  access: WsAccess;
}

export const listRolePermissions = (role: number) =>
  api.get<WorkspacePermission[]>("/workspace-permissions/", { params: { role } }).then((r) => r.data);

export const saveRolePermissions = (
  role: number,
  permissions: { workspace: string; access: WsAccess }[],
) => api.post("/workspace-permissions/bulk/", { role, permissions }).then((r) => r.data);

// --- Per-person workspace access (overrides role grants) -------------------
export type UserWsLevel = "hidden" | "view" | "edit";

export interface UserAccessResponse {
  user: number;
  is_supervisor: boolean;
  /** Effective, post-override access; any workspace absent here is hidden. */
  access: Record<string, WsAccess>;
}

export const getUserAccess = (userId: number) =>
  api
    .get<UserAccessResponse>("/workspace-user-access/", { params: { user: userId } })
    .then((r) => r.data);

export const saveUserAccess = (
  userId: number,
  permissions: { workspace: string; access: UserWsLevel }[],
) => api.post("/workspace-user-access/", { user: userId, permissions }).then((r) => r.data);
