import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  department: number | null;
  teams: number[];
  roles: number[];
  role_names: string[];
  is_active: boolean;
  is_privileged: boolean;
  mfa_enabled: boolean;
}

export interface UserInput {
  username?: string;
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  roles?: number[];
  is_active?: boolean;
}

export interface AdminRole {
  id: number;
  name: string;
  description: string;
  is_system: boolean;
  default_scope: string;
  capabilities: { capability: string; scope: string }[];
  user_count: number;
}

export interface MiniProject {
  id: number;
  code: string;
  name: string;
}

export type ProjectRole = "owner" | "manager" | "contributor" | "reviewer" | "viewer";

export const listUsers = () =>
  api.get<Paginated<AdminUser>>("/users/").then((r) => unwrap(r.data));

export const createUser = (payload: UserInput) =>
  api.post<AdminUser>("/users/", payload).then((r) => r.data);

export const updateUser = (id: number, payload: UserInput) =>
  api.patch<AdminUser>(`/users/${id}/`, payload).then((r) => r.data);

export const deleteUser = (id: number) => api.delete(`/users/${id}/`);

export interface RoleInput {
  name?: string;
  description?: string;
  default_scope?: string;
  capabilities?: { capability: string; scope: string }[];
}

export const listRoles = () =>
  api.get<Paginated<AdminRole>>("/roles/").then((r) => unwrap(r.data));

export const createRole = (payload: RoleInput) =>
  api.post<AdminRole>("/roles/", payload).then((r) => r.data);

export const updateRole = (id: number, payload: RoleInput) =>
  api.patch<AdminRole>(`/roles/${id}/`, payload).then((r) => r.data);

export const deleteRole = (id: number) => api.delete(`/roles/${id}/`);

export const listMiniProjects = () =>
  api.get<Paginated<MiniProject>>("/projects/").then((r) => unwrap(r.data));

export const addMembership = (user: number, project: number, project_role: ProjectRole) =>
  api.post("/memberships/", { user, project, project_role }).then((r) => r.data);

export interface LastLogin {
  id: number;
  name: string;
  username: string;
  last_login: string;
  source_ip: string | null;
}

export const listLastLogins = () =>
  api.get<LastLogin[]>("/auth/last-logins/").then((r) => r.data);
