import { api } from "../../api/client";

/**
 * Direct messages — a private one-to-one thread between two people.
 *
 * Management/IT open a thread with someone; from then on both sides can write
 * in it. `directory()` reports whether the current user may start one, so the
 * UI can explain itself instead of offering a button that always fails.
 */

interface Paginated<T> { results: T[]; }

export interface Person {
  id: number;
  name: string;
  username: string;
  email: string;
  role: string;
}

export interface LastMessage {
  body: string;
  sender: number;
  mine: boolean;
}

export interface Conversation {
  id: number;
  other: Person;
  unread: number;
  last_message: LastMessage | null;
  last_message_at: string | null;
  created_at: string;
}

export interface DirectMessage {
  id: number;
  conversation: number;
  sender: number;
  sender_name: string;
  mine: boolean;
  body: string;
  created_at: string;
  read_at: string | null;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data } = await api.get<Paginated<Conversation>>("/conversations/");
  return data.results ?? (data as unknown as Conversation[]);
}

export async function listMessages(conversationId: number): Promise<DirectMessage[]> {
  const { data } = await api.get<DirectMessage[]>(`/conversations/${conversationId}/messages/`);
  return data;
}

export async function sendMessage(conversationId: number, body: string): Promise<DirectMessage> {
  const { data } = await api.post<DirectMessage>(`/conversations/${conversationId}/messages/`, { body });
  return data;
}

/** Open (or reuse) a thread with someone, optionally with its first line. */
export async function startConversation(recipient: number, body?: string): Promise<Conversation> {
  const { data } = await api.post<Conversation>("/conversations/", { recipient, body });
  return data;
}

export async function markThreadRead(conversationId: number): Promise<{ marked: number }> {
  const { data } = await api.post(`/conversations/${conversationId}/read/`);
  return data;
}

export async function messagesUnreadCount(): Promise<{ unread: number; threads: number }> {
  const { data } = await api.get("/conversations/unread_count/");
  return data;
}

export async function directory(): Promise<{ can_start: boolean; people: Person[] }> {
  const { data } = await api.get("/message-directory/");
  return data;
}

/** Nudge the sidebar badge to re-read; sending/reading doesn't change route. */
export function announceMessagesChanged() {
  window.dispatchEvent(new Event("kos:messages-changed"));
}
