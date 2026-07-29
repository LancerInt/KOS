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
