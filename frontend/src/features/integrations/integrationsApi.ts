import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export type AuthScheme = "none" | "bearer" | "header";

export interface ErpConnection {
  id: number;
  name: string;
  base_url: string;
  has_secret: boolean;
  auth_scheme: AuthScheme;
  auth_header_name: string;
  subscribed_events: string[];
  is_active: boolean;
  inbound_enabled: boolean;
  mock_mode: boolean;
  max_attempts: number;
  created_by: number | null;
  created_by_name: string;
  last_delivery_at: string | null;
  created_at: string;
}

export interface ConnectionInput extends Partial<ErpConnection> {
  secret?: string;
  auth_token?: string;
}

export interface WebhookDelivery {
  id: number;
  connection: number;
  connection_name: string;
  event_type: string;
  object_type: string;
  object_id: string;
  payload: unknown;
  status: "pending" | "delivered" | "failed" | "mocked";
  attempts: number;
  response_status: number | null;
  response_body: string;
  error: string;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface InboundEvent {
  id: number;
  connection: number | null;
  connection_name: string;
  event_type: string;
  payload: unknown;
  status: string;
  result: string;
  source_ip: string | null;
  created_at: string;
}

export interface EventOption { value: string; label: string; }

export const listConnections = () =>
  api.get<Paginated<ErpConnection>>("/integrations/connections/").then((r) => unwrap(r.data));

export const createConnection = (payload: ConnectionInput) =>
  api.post<ErpConnection>("/integrations/connections/", payload).then((r) => r.data);

export const updateConnection = (id: number, payload: ConnectionInput) =>
  api.patch<ErpConnection>(`/integrations/connections/${id}/`, payload).then((r) => r.data);

export const deleteConnection = (id: number) => api.delete(`/integrations/connections/${id}/`);

export const testConnection = (id: number) =>
  api.post<WebhookDelivery>(`/integrations/connections/${id}/test/`, {}).then((r) => r.data);

export const listDeliveries = () =>
  api.get<Paginated<WebhookDelivery>>("/integrations/deliveries/").then((r) => unwrap(r.data));

export const retryDelivery = (id: number) =>
  api.post<WebhookDelivery>(`/integrations/deliveries/${id}/retry/`, {}).then((r) => r.data);

export const listInbound = () =>
  api.get<Paginated<InboundEvent>>("/integrations/inbound-events/").then((r) => unwrap(r.data));

export const listEvents = () =>
  api.get<{ events: EventOption[] }>("/integrations/events/").then((r) => r.data.events);
