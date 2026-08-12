import { api, fetchAll } from "../../api/client";

export interface Notification {
  id: number;
  event: string;
  title: string;
  body: string;
  url: string;
  task: number | null;
  project: number | null;
  is_read: boolean;
  requires_acknowledgement: boolean;
  needs_acknowledgement: boolean;
  acknowledged_at: string | null;
  acknowledgement_message: string;
  created_at: string;
}

export interface Preferences {
  inapp_enabled: boolean;
  email_enabled: boolean;
  daily_digest: boolean;
}

// Pull the whole set (following pagination) so the page can bucket it into
// "Needs your action" vs "Recent updates" and page each tab client-side. The
// list endpoint paginates at 25; reading only the first page silently hid the
// rest, which this also fixes.
export async function listNotifications(): Promise<Notification[]> {
  return fetchAll<Notification>("/notifications/");
}

export async function unreadCount(): Promise<{ unread: number; needs_ack: number }> {
  const { data } = await api.get("/notifications/unread_count/");
  return data;
}

export async function markRead(id: number): Promise<void> {
  await api.post(`/notifications/${id}/mark_read/`);
}

export async function markAllRead(): Promise<void> {
  await api.post("/notifications/mark_all_read/");
}

export async function dismissNotification(id: number): Promise<void> {
  await api.delete(`/notifications/${id}/`);
}

export async function clearRead(): Promise<{ deleted: number }> {
  const { data } = await api.post("/notifications/clear_read/");
  return data;
}

export async function acknowledge(id: number, message: string): Promise<Notification> {
  const { data } = await api.post<Notification>(`/notifications/${id}/acknowledge/`, { message });
  return data;
}

export async function getPreferences(): Promise<Preferences> {
  const { data } = await api.get<Preferences>("/notification-preferences/");
  return data;
}

export async function updatePreferences(payload: Partial<Preferences>): Promise<Preferences> {
  const { data } = await api.put<Preferences>("/notification-preferences/", payload);
  return data;
}

// --- Outbound email account (Integrations → Email), admin-only -------------- //
export interface EmailAccount {
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  from_email: string;
  is_enabled: boolean;
  has_password: boolean;
  updated_at: string | null;
}

export interface EmailAccountInput {
  host?: string;
  port?: number;
  use_tls?: boolean;
  username?: string;
  from_email?: string;
  is_enabled?: boolean;
  password?: string;
}

export async function getEmailAccount(): Promise<EmailAccount> {
  const { data } = await api.get<EmailAccount>("/email-account/");
  return data;
}

export async function updateEmailAccount(payload: EmailAccountInput): Promise<EmailAccount> {
  const { data } = await api.put<EmailAccount>("/email-account/", payload);
  return data;
}

export async function testEmailAccount(payload: EmailAccountInput & { to?: string }) {
  const { data } = await api.post<{ ok: boolean; detail: string }>("/email-account/test/", payload);
  return data;
}
