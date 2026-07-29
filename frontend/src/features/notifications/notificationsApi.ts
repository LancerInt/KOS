import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }

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

export async function listNotifications(): Promise<Notification[]> {
  const { data } = await api.get<Paginated<Notification>>("/notifications/");
  return data.results ?? (data as unknown as Notification[]);
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
