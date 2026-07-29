export interface CurrentUser {
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
  /** capability -> broadest scope (PRD §7.4). */
  effective_capabilities: Record<string, string>;
}

export interface LoginResult {
  access?: string;
  refresh?: string;
  user?: CurrentUser;
  mfa_required?: boolean;
  mfa_setup_required?: boolean;
}
