import { api, fetchAll } from "../../api/client";

/**
 * Messages — private one-to-one threads (DMs) and named group chats.
 *
 * Anyone active can start a DM with anyone or create a group and add anyone.
 * `directory()` returns the people you can write to.
 */

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
  deleted: boolean;
}

export interface MessageAttachment {
  id: number;
  url: string;
  name: string;
  kind: "image" | "file" | "audio";
  content_type: string;
  size: number;
  duration_ms: number | null;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface SendExtras {
  files?: File[];
  /** Voice-note length in ms, attached to an audio upload. */
  durationMs?: number;
}

/** Build the request body: multipart when there are files, else plain JSON. */
function messagePayload(body: string, extras?: SendExtras): FormData | { body: string } {
  if (!extras?.files?.length) return { body };
  const fd = new FormData();
  if (body) fd.append("body", body);
  extras.files.forEach((f) => fd.append("files", f));
  if (extras.durationMs != null) fd.append("duration_ms", String(Math.round(extras.durationMs)));
  return fd;
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
  /** Set when the sender corrected it — the bubble is marked "edited". */
  edited_at: string | null;
  /** Retracted by its sender; `body` is empty and a tombstone is shown. */
  deleted: boolean;
  /** Whether *you* may still edit it (own message, inside the time window). */
  can_edit: boolean;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
}

export async function listConversations(): Promise<Conversation[]> {
  return fetchAll<Conversation>("/conversations/");
}

export async function listMessages(conversationId: number): Promise<DirectMessage[]> {
  const { data } = await api.get<DirectMessage[]>(`/conversations/${conversationId}/messages/`);
  return data;
}

export async function sendMessage(conversationId: number, body: string, extras?: SendExtras): Promise<DirectMessage> {
  const { data } = await api.post<DirectMessage>(
    `/conversations/${conversationId}/messages/`, messagePayload(body, extras));
  return data;
}

/** Open (or reuse) a thread with someone, optionally with its first line. */
export async function startConversation(recipient: number, body?: string): Promise<Conversation> {
  const { data } = await api.post<Conversation>("/conversations/", { recipient, body });
  return data;
}

/** Correct your own message. Only allowed inside the server's edit window. */
export async function editMessage(messageId: number, body: string): Promise<DirectMessage> {
  const { data } = await api.patch<DirectMessage>(`/direct-messages/${messageId}/`, { body });
  return data;
}

/** Retract your own message. Returns the tombstone that replaces it. */
export async function deleteMessage(messageId: number): Promise<DirectMessage> {
  const { data } = await api.delete<DirectMessage>(`/direct-messages/${messageId}/`);
  return data;
}

/**
 * Delete a conversation from *your* list. The other person's copy is untouched,
 * and a later message brings the thread back with only what follows.
 */
export async function deleteConversation(conversationId: number): Promise<void> {
  await api.delete(`/conversations/${conversationId}/`);
}

export async function markThreadRead(conversationId: number): Promise<{ marked: number }> {
  const { data } = await api.post(`/conversations/${conversationId}/read/`);
  return data;
}

// The sidebar badge counts DMs *and* groups together — one "you have unread
// messages" number across the whole Messages area.
export async function messagesUnreadCount(): Promise<{ unread: number; threads: number }> {
  const zero = { unread: 0, threads: 0 };
  const [dm, grp] = await Promise.all([
    api.get("/conversations/unread_count/").then((r) => r.data).catch(() => zero),
    api.get("/group-threads/unread_count/").then((r) => r.data).catch(() => zero),
  ]);
  return { unread: (dm.unread || 0) + (grp.unread || 0), threads: (dm.threads || 0) + (grp.threads || 0) };
}

export async function directory(): Promise<{ can_start: boolean; people: Person[] }> {
  const { data } = await api.get("/message-directory/");
  return data;
}

/** Nudge the sidebar badge to re-read; sending/reading doesn't change route. */
export function announceMessagesChanged() {
  window.dispatchEvent(new Event("kos:messages-changed"));
}

// --------------------------------------------------------------------------- //
// Group chats
// --------------------------------------------------------------------------- //

export interface GroupThread {
  id: number;
  name: string;
  kind: "group";
  members: Person[];
  member_count: number;
  is_admin: boolean;
  unread: number;
  last_message: (LastMessage & { sender_name?: string }) | null;
  last_message_at: string | null;
  created_at: string;
  created_by: number | null;
}

export interface GroupMessage {
  id: number;
  thread: number;
  sender: number;
  sender_name: string;
  mine: boolean;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  can_edit: boolean;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
}

export async function listGroupThreads(): Promise<GroupThread[]> {
  return fetchAll<GroupThread>("/group-threads/");
}

export async function createGroup(name: string, members: number[], body?: string): Promise<GroupThread> {
  const { data } = await api.post<GroupThread>("/group-threads/", { name, members, body });
  return data;
}

export async function listGroupMessages(id: number): Promise<GroupMessage[]> {
  const { data } = await api.get<GroupMessage[]>(`/group-threads/${id}/messages/`);
  return data;
}

export async function sendGroupMessage(id: number, body: string, extras?: SendExtras): Promise<GroupMessage> {
  const { data } = await api.post<GroupMessage>(
    `/group-threads/${id}/messages/`, messagePayload(body, extras));
  return data;
}

export async function markGroupRead(id: number): Promise<{ marked: number }> {
  const { data } = await api.post(`/group-threads/${id}/read/`);
  return data;
}

export async function addGroupMembers(id: number, members: number[]): Promise<GroupThread> {
  const { data } = await api.post<GroupThread>(`/group-threads/${id}/members/`, { members });
  return data;
}

export async function leaveGroup(id: number): Promise<void> {
  await api.post(`/group-threads/${id}/leave/`);
}

export async function renameGroup(id: number, name: string): Promise<GroupThread> {
  const { data } = await api.patch<GroupThread>(`/group-threads/${id}/`, { name });
  return data;
}

export async function editGroupMessage(messageId: number, body: string): Promise<GroupMessage> {
  const { data } = await api.patch<GroupMessage>(`/group-messages/${messageId}/`, { body });
  return data;
}

export async function reactToDirectMessage(id: number, emoji: string): Promise<DirectMessage> {
  const { data } = await api.post<DirectMessage>(`/direct-messages/${id}/react/`, { emoji });
  return data;
}

export async function reactToGroupMessage(id: number, emoji: string): Promise<GroupMessage> {
  const { data } = await api.post<GroupMessage>(`/group-messages/${id}/react/`, { emoji });
  return data;
}

export async function deleteGroupMessage(messageId: number): Promise<GroupMessage> {
  const { data } = await api.delete<GroupMessage>(`/group-messages/${messageId}/`);
  return data;
}
